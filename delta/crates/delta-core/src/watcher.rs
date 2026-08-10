//! Process watcher — порт `delta/src/watcher.js` (M4). Headless-актор
//! ПРОЦЕСУ, не людей: SLA-пінг виконавцю, потім, за grace, ескалація
//! власнику + прозора копія виконавцю. Нотифікації — файловий JSONL-лог,
//! не push (`.mt/notifications/{handle}.jsonl`, append-only). Тиха
//! година — ЗАТРИМКА доставки некритичних нотифікацій, не фільтр.

use std::collections::HashMap;

use regex::Regex;
use serde_json::{json, Value};

use crate::decisions::{
    derive_quorum_status, parse_decision_request, requires_quorum, DecisionRequestMeta, QuorumState,
};
use crate::io::Io;

const DEFAULT_SLA_HOURS: f64 = 24.0;
const DEFAULT_GRACE_HOURS: f64 = 24.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WatcherConfig {
    pub sla_hours: f64,
    pub grace_hours: f64,
}

pub fn default_watcher_config() -> WatcherConfig {
    WatcherConfig {
        sla_hours: DEFAULT_SLA_HOURS,
        grace_hours: DEFAULT_GRACE_HOURS,
    }
}

fn hours_since(opened_at_iso: &str, now: chrono::DateTime<chrono::Utc>) -> Option<f64> {
    let opened = chrono::DateTime::parse_from_rfc3339(opened_at_iso).ok()?;
    Some((now.timestamp_millis() - opened.timestamp_millis()) as f64 / (60.0 * 60.0 * 1000.0))
}

/// Виконавці/підписанти, чиєї реакції ще бракує — `watcher.js:
/// pendingSignersFor`. M6: kill-switch-пригнічені handle-и НЕ повертаються.
fn pending_signers_for(
    dr: &crate::decisions::DecisionRequest,
    files_by_name: &HashMap<String, String>,
    kill_switch_suppressed: Option<&std::collections::HashSet<String>>,
) -> Vec<String> {
    if requires_quorum(&dr.leverage_facets) {
        let quorum = derive_quorum_status(dr, files_by_name);
        if quorum.status != QuorumState::Pending {
            return Vec::new();
        }
        return quorum
            .pending
            .into_iter()
            .filter(|s| !kill_switch_suppressed.is_some_and(|set| set.contains(s)))
            .collect();
    }
    let Some(owner) = &dr.computed_owner else {
        return Vec::new();
    };
    if kill_switch_suppressed.is_some_and(|set| set.contains(owner)) {
        return Vec::new();
    }
    let nnnn = dr.nnnn.clone().unwrap_or_default();
    if files_by_name.contains_key(&format!("{nnnn}-approval.json")) {
        Vec::new()
    } else {
        vec![owner.clone()]
    }
}

fn owner_above(escalation_chain: &[String], signer: &str) -> Option<String> {
    let idx = escalation_chain.iter().position(|s| s == signer)?;
    escalation_chain.get(idx + 1).cloned()
}

#[allow(clippy::too_many_arguments)]
fn notifications_for_decision(
    parsed: &crate::decisions::DecisionRequest,
    run_id: Option<&str>,
    files_by_name: &HashMap<String, String>,
    config: &WatcherConfig,
    now: chrono::DateTime<chrono::Utc>,
    kill_switch_suppressed: Option<&std::collections::HashSet<String>>,
) -> Vec<Value> {
    let signers = pending_signers_for(parsed, files_by_name, kill_switch_suppressed);
    let Some(opened_at) = &parsed.opened_at else {
        return Vec::new();
    };
    if signers.is_empty() {
        return Vec::new();
    }
    let Some(age_hours) = hours_since(opened_at, now) else {
        return Vec::new();
    };
    if age_hours < config.sla_hours {
        return Vec::new();
    }

    let critical = parsed.leverage_facets.irreversible
        && parsed
            .deadline_cost
            .as_deref()
            .is_some_and(|s| !s.is_empty());
    let nnnn = parsed.nnnn.clone().unwrap_or_default();
    let decision_ref = format!("{nnnn}-decision-request.md");
    let mut notifications: Vec<Value> = signers
        .iter()
        .map(|signer| {
            json!({
                "kind": "sla-ping-executor", "to": signer, "runId": run_id, "nnnn": nnnn, "decisionRef": decision_ref,
                "ageHours": age_hours.round(), "critical": critical,
                "message": format!("у тебе висить {}/{} — допомогти?", run_id.unwrap_or(""), nnnn),
            })
        })
        .collect();

    if age_hours < config.sla_hours + config.grace_hours {
        return notifications;
    }

    for signer in &signers {
        let Some(owner) = owner_above(&parsed.escalation_chain, signer) else {
            continue;
        };
        notifications.push(json!({
            "kind": "sla-escalate-owner", "to": owner, "runId": run_id, "nnnn": nnnn, "decisionRef": decision_ref,
            "ageHours": age_hours.round(), "critical": critical, "executorHandle": signer,
            "message": format!("{}/{} застрягло, {} в курсі з {}", run_id.unwrap_or(""), nnnn, signer, opened_at),
        }));
        notifications.push(json!({
            "kind": "sla-escalated-notice", "to": signer, "runId": run_id, "nnnn": nnnn, "decisionRef": decision_ref,
            "ageHours": age_hours.round(), "critical": critical, "escalatedTo": owner,
            "message": format!("{}/{} пішло вгору до {} (grace-період вичерпано)", run_id.unwrap_or(""), nnnn, owner),
        }));
    }
    notifications
}

/// Сканує усі decisions-директорії й будує список нотифікацій за SLA/grace
/// — pure-функція (`watcher.js: scanForNotifications`).
pub fn scan_for_notifications(
    decisions_dirs: &[crate::decisions::DecisionsDir],
    config: Option<WatcherConfig>,
    now: chrono::DateTime<chrono::Utc>,
    kill_switch_suppressed: Option<&std::collections::HashSet<String>>,
) -> Vec<Value> {
    let resolved_config = config.unwrap_or_else(default_watcher_config);
    let re = Regex::new(r"^(\d{4})-decision-request\.md$").unwrap();
    let mut notifications = Vec::new();
    for d in decisions_dirs {
        let files_by_name: HashMap<String, String> = d.files.iter().cloned().collect();
        for (name, content) in &d.files {
            let Some(caps) = re.captures(name) else {
                continue;
            };
            let nnnn = caps[1].to_string();
            let run_id = d
                .dir
                .split('/')
                .filter(|s| !s.is_empty())
                .rev()
                .nth(1)
                .map(str::to_string);
            let Ok(parsed) = parse_decision_request(
                content,
                DecisionRequestMeta {
                    path: Some(format!("{}/{}", d.dir, name)),
                    run_id: run_id.clone(),
                    nnnn: Some(nnnn),
                },
            ) else {
                continue;
            };
            notifications.extend(notifications_for_decision(
                &parsed,
                run_id.as_deref(),
                &files_by_name,
                &resolved_config,
                now,
                kill_switch_suppressed,
            ));
        }
    }
    notifications
}

fn to_minutes(value: &str) -> Option<i64> {
    let re = Regex::new(r"^(\d{1,2}):(\d{2})$").unwrap();
    let caps = re.captures(value)?;
    Some(caps[1].parse::<i64>().ok()? * 60 + caps[2].parse::<i64>().ok()?)
}

#[derive(Debug, Clone, PartialEq)]
pub struct QuietHours {
    pub start: String,
    pub end: String,
}

/// Чи `now` потрапляє у вікно тихої години — `watcher.js: isQuietHours`
/// (підтримує нічне вікно, що перетинає північ).
pub fn is_quiet_hours(
    now: chrono::DateTime<chrono::Local>,
    quiet_hours: Option<&QuietHours>,
) -> bool {
    let Some(qh) = quiet_hours else { return false };
    let (Some(start_min), Some(end_min)) = (to_minutes(&qh.start), to_minutes(&qh.end)) else {
        return false;
    };
    if start_min == end_min {
        return false;
    }
    let now_min = now.hour() as i64 * 60 + now.minute() as i64;
    if start_min < end_min {
        now_min >= start_min && now_min < end_min
    } else {
        now_min >= start_min || now_min < end_min
    }
}

use chrono::Timelike;

fn next_occurrence_of(
    time_str: &str,
    now: chrono::DateTime<chrono::Local>,
) -> chrono::DateTime<chrono::Local> {
    let minutes = to_minutes(time_str).unwrap_or(0);
    let candidate = now
        .date_naive()
        .and_hms_opt((minutes / 60) as u32, (minutes % 60) as u32, 0)
        .unwrap();
    let candidate = candidate
        .and_local_timezone(now.timezone())
        .single()
        .unwrap_or(now);
    if candidate <= now {
        candidate + chrono::Duration::days(1)
    } else {
        candidate
    }
}

/// Проставляє `deliverAt` на кожну нотифікацію за правилом тихої години —
/// `watcher.js: applyQuietHours`.
pub fn apply_quiet_hours(
    notifications: Vec<Value>,
    quiet_hours: Option<&QuietHours>,
    now: chrono::DateTime<chrono::Local>,
) -> Vec<Value> {
    let quiet = is_quiet_hours(now, quiet_hours);
    notifications
        .into_iter()
        .map(|mut n| {
            let critical = n.get("critical").and_then(|v| v.as_bool()).unwrap_or(false);
            let deferred = quiet && !critical;
            let deliver_at = if deferred {
                next_occurrence_of(&quiet_hours.unwrap().end, now)
            } else {
                now
            };
            n["deliverAt"] = json!(deliver_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
            n["batched"] = json!(deferred);
            n
        })
        .collect()
}

pub fn notifications_log_path(mandates_dir: &str, handle: &str) -> String {
    format!("{mandates_dir}/.mt/notifications/{handle}.jsonl")
}

/// Розбирає JSONL-лог нотифікацій — биті рядки мовчки пропускаються
/// (`watcher.js: parseNotificationsLog`).
pub fn parse_notifications_log(text: Option<&str>) -> Vec<Value> {
    let Some(text) = text else { return Vec::new() };
    text.split('\n')
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                None
            } else {
                serde_json::from_str(trimmed).ok()
            }
        })
        .collect()
}

/// Дописує нотифікації в JSONL-лог `handle` — read-append-write
/// (`watcher.js: appendNotifications`).
pub async fn append_notifications(io: &dyn Io, path: &str, notifications: &[Value]) {
    if notifications.is_empty() {
        return;
    }
    let existing = io.read_file(path).await.unwrap_or_default();
    let lines: Vec<String> = notifications.iter().map(|n| n.to_string()).collect();
    let prefix = if !existing.is_empty() && !existing.ends_with('\n') {
        format!("{existing}\n")
    } else {
        existing
    };
    io.write_file(path, &format!("{prefix}{}\n", lines.join("\n")))
        .await;
}

/// Повний прогін watcher-а — скан → тиха година → дописування в лог
/// КОЖНОГО адресата (`watcher.js: runWatcherScan`).
#[allow(clippy::too_many_arguments)]
pub async fn run_watcher_scan(
    io: &dyn Io,
    mandates_dir: &str,
    decisions_dirs: &[crate::decisions::DecisionsDir],
    config: Option<WatcherConfig>,
    quiet_hours: Option<&QuietHours>,
    kill_switch_suppressed: Option<&std::collections::HashSet<String>>,
    now_utc: chrono::DateTime<chrono::Utc>,
    now_local: chrono::DateTime<chrono::Local>,
) -> Value {
    let scanned = scan_for_notifications(decisions_dirs, config, now_utc, kill_switch_suppressed);
    let with_delivery = apply_quiet_hours(scanned, quiet_hours, now_local);

    let mut by_handle: HashMap<String, Vec<Value>> = HashMap::new();
    for n in &with_delivery {
        let to = n["to"].as_str().unwrap_or_default().to_string();
        by_handle.entry(to).or_default().push(n.clone());
    }
    for (handle, entries) in &by_handle {
        append_notifications(io, &notifications_log_path(mandates_dir, handle), entries).await;
    }

    let delivered = with_delivery
        .iter()
        .filter(|n| n["batched"] != json!(true))
        .count();
    let batched = with_delivery
        .iter()
        .filter(|n| n["batched"] == json!(true))
        .count();
    json!({"notifications": with_delivery, "delivered": delivered, "batched": batched})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemoryIo;

    fn solo_dr(opened_at: &str) -> String {
        format!(
            "---\ncomputed_owner: olena\nescalation_chain: [olena, vitalii]\nleverage_facets: {{ irreversible: false, blast_radius: node }}\nopened_at: \"{opened_at}\"\n---\n\n## Контекст\nx\n"
        )
    }

    fn quorum_dr(opened_at: &str, extra: &str) -> String {
        format!(
            "---\ncomputed_owner: olena\nescalation_chain: [olena, oksana]\nleverage_facets: {{ irreversible: true, blast_radius: repo }}\napprovers: [olena, vitalii]\nopened_at: \"{opened_at}\"\n{extra}---\n\n## Контекст\nx\n"
        )
    }

    fn now() -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339("2026-08-03T00:00:00.000Z")
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    #[test]
    fn fresh_decision_below_sla_no_notifications() {
        let dr = solo_dr("2026-08-02T23:00:00.000Z");
        let dirs = vec![crate::decisions::DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![("0001-decision-request.md".into(), dr)],
        }];
        assert!(scan_for_notifications(&dirs, None, now(), None).is_empty());
    }

    #[test]
    fn older_than_sla_younger_than_grace_pings_executor_only() {
        let dr = solo_dr("2026-08-02T00:00:00.000Z");
        let dirs = vec![crate::decisions::DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![("0001-decision-request.md".into(), dr)],
        }];
        let notifications = scan_for_notifications(&dirs, None, now(), None);
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0]["kind"], "sla-ping-executor");
        assert_eq!(notifications[0]["to"], "olena");
    }

    #[test]
    fn older_than_sla_plus_grace_escalates_with_transparent_copy() {
        let dr = solo_dr("2026-08-01T00:00:00.000Z");
        let dirs = vec![crate::decisions::DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![("0001-decision-request.md".into(), dr)],
        }];
        let notifications = scan_for_notifications(&dirs, None, now(), None);
        let kinds: Vec<&str> = notifications
            .iter()
            .map(|n| n["kind"].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            vec![
                "sla-ping-executor",
                "sla-escalate-owner",
                "sla-escalated-notice"
            ]
        );
        assert_eq!(notifications[0]["to"], "olena");
        assert_eq!(notifications[1]["to"], "vitalii");
        assert_eq!(notifications[1]["executorHandle"], "olena");
        assert_eq!(notifications[2]["to"], "olena");
        assert_eq!(notifications[2]["escalatedTo"], "vitalii");
    }

    #[test]
    fn already_closed_no_notifications() {
        let dr = solo_dr("2026-08-01T00:00:00.000Z");
        let dirs = vec![crate::decisions::DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![
                ("0001-decision-request.md".into(), dr),
                ("0001-approval.json".into(), "{}".into()),
            ],
        }];
        assert!(scan_for_notifications(&dirs, None, now(), None).is_empty());
    }

    #[test]
    fn missing_opened_at_never_pings() {
        let dr = "---\ncomputed_owner: olena\nescalation_chain: [olena]\nleverage_facets: { irreversible: false, blast_radius: node }\n---\n\n## Контекст\nx\n".to_string();
        let dirs = vec![crate::decisions::DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![("0001-decision-request.md".into(), dr)],
        }];
        assert!(scan_for_notifications(&dirs, None, now(), None).is_empty());
    }

    #[test]
    fn quorum_pings_all_pending_approvers() {
        let dr = quorum_dr("2026-08-02T00:00:00.000Z", "");
        let dirs = vec![crate::decisions::DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![("0001-decision-request.md".into(), dr)],
        }];
        let notifications = scan_for_notifications(&dirs, None, now(), None);
        let to: Vec<&str> = notifications
            .iter()
            .map(|n| n["to"].as_str().unwrap())
            .collect();
        assert_eq!(to, vec!["olena", "vitalii"]);
    }

    #[test]
    fn quorum_closed_no_more_pings() {
        let dr = quorum_dr("2026-08-01T00:00:00.000Z", "");
        let dirs = vec![crate::decisions::DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![
                ("0001-decision-request.md".into(), dr),
                (
                    "0001-approval-olena.json".into(),
                    r#"{"chosen_option":"A"}"#.into(),
                ),
                (
                    "0001-approval-vitalii.json".into(),
                    r#"{"chosen_option":"A"}"#.into(),
                ),
            ],
        }];
        assert!(scan_for_notifications(&dirs, None, now(), None).is_empty());
    }

    #[test]
    fn is_quiet_hours_day_window() {
        let mk = |s: &str| {
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
                .unwrap()
                .and_local_timezone(chrono::Local)
                .unwrap()
        };
        let qh = QuietHours {
            start: "09:00".into(),
            end: "18:00".into(),
        };
        assert!(is_quiet_hours(mk("2026-08-03T12:00:00"), Some(&qh)));
        assert!(!is_quiet_hours(mk("2026-08-03T08:59:00"), Some(&qh)));
    }

    #[test]
    fn is_quiet_hours_overnight_window() {
        let mk = |s: &str| {
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
                .unwrap()
                .and_local_timezone(chrono::Local)
                .unwrap()
        };
        let qh = QuietHours {
            start: "20:00".into(),
            end: "09:00".into(),
        };
        assert!(is_quiet_hours(mk("2026-08-03T23:00:00"), Some(&qh)));
        assert!(is_quiet_hours(mk("2026-08-03T05:00:00"), Some(&qh)));
        assert!(!is_quiet_hours(mk("2026-08-03T12:00:00"), Some(&qh)));
    }

    #[test]
    fn apply_quiet_hours_defers_non_critical_delivers_critical() {
        let qh = QuietHours {
            start: "20:00".into(),
            end: "09:00".into(),
        };
        let in_quiet =
            chrono::NaiveDateTime::parse_from_str("2026-08-03T23:00:00", "%Y-%m-%dT%H:%M:%S")
                .unwrap()
                .and_local_timezone(chrono::Local)
                .unwrap();
        let non_critical = vec![json!({"kind": "x", "to": "olena", "critical": false})];
        let result = apply_quiet_hours(non_critical, Some(&qh), in_quiet);
        assert_eq!(result[0]["batched"], true);

        let critical = vec![json!({"kind": "x", "to": "olena", "critical": true})];
        let result2 = apply_quiet_hours(critical, Some(&qh), in_quiet);
        assert_eq!(result2[0]["batched"], false);
    }

    #[test]
    fn parse_and_append_notifications_round_trip() {
        assert!(parse_notifications_log(None).is_empty());
        let parsed = parse_notifications_log(Some("{\"a\":1}\nnot json\n{\"b\":2}\n"));
        assert_eq!(parsed, vec![json!({"a": 1}), json!({"b": 2})]);
    }

    #[tokio::test]
    async fn append_notifications_appends_to_existing() {
        let io = MemoryIo::new([(
            "/root/.mt/notifications/olena.jsonl".to_string(),
            "{\"a\":1}\n".to_string(),
        )]);
        append_notifications(
            &io,
            "/root/.mt/notifications/olena.jsonl",
            &[json!({"b": 2}), json!({"c": 3})],
        )
        .await;
        let parsed =
            parse_notifications_log(io.get("/root/.mt/notifications/olena.jsonl").as_deref());
        assert_eq!(
            parsed,
            vec![json!({"a": 1}), json!({"b": 2}), json!({"c": 3})]
        );
    }

    #[tokio::test]
    async fn append_notifications_empty_is_noop() {
        let io = MemoryIo::default();
        append_notifications(&io, "/x.jsonl", &[]).await;
        assert!(!io.has("/x.jsonl"));
    }

    #[tokio::test]
    async fn run_watcher_scan_writes_per_recipient_logs_in_order() {
        let dr = solo_dr("2026-08-01T00:00:00.000Z");
        let dirs = vec![crate::decisions::DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![("0001-decision-request.md".into(), dr)],
        }];
        let io = MemoryIo::default();
        let now_local: chrono::DateTime<chrono::Local> = now().with_timezone(&chrono::Local);
        let summary =
            run_watcher_scan(&io, "/root", &dirs, None, None, None, now(), now_local).await;
        assert_eq!(summary["delivered"], 3);
        assert_eq!(summary["batched"], 0);
        let olena_log =
            parse_notifications_log(io.get(&notifications_log_path("/root", "olena")).as_deref());
        let kinds: Vec<&str> = olena_log
            .iter()
            .map(|n| n["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, vec!["sla-ping-executor", "sla-escalated-notice"]);
    }
}
