//! Kill-switch — порт `delta/src/kill-switch.js` (M6, п.3). SUSPENSION-шар,
//! НЕ мутація мандата — активний kill-switch лише змінює деривацію черг
//! (`decisions::derive_queue`) і множину пригнічення watcher-а. Панічна
//! кнопка — БЕЗ квізу, БЕЗ підтвердження (задокументоване рішення M6).

use std::collections::{HashMap, HashSet};

use mt_mandates::{Mandate, MandateKind};
use serde_json::{json, Value};

use crate::io::Io;
use crate::signing::{sign_payload, DeviceKeypair};

pub fn kill_switch_path(mandates_dir: &str, handle: &str) -> String {
    format!("{mandates_dir}/.mt/kill-switch/{handle}.json")
}

/// Спільний append-only лог активацій/деактивацій — ОДИН файл на воркспейс
/// (`kill-switch.js: killSwitchLogPath`).
pub fn kill_switch_log_path(mandates_dir: &str) -> String {
    format!("{mandates_dir}/.mt/kill-switch/log.jsonl")
}

/// `kill-switch.js: isKillSwitchActive` — відсутній/порожній/битий вміст —
/// неактивний.
pub fn is_kill_switch_active(text: Option<&str>) -> bool {
    let Some(text) = text else { return false };
    if text.trim().is_empty() {
        return false;
    }
    serde_json::from_str::<Value>(text).is_ok()
}

async fn build_and_sign_record(
    handle: &str,
    action: &str,
    device_key: &DeviceKeypair,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Value {
    let at = now
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let payload = json!({"schema_version": 1, "type": "kill-switch", "handle": handle, "action": action, "at": at});
    let signature = sign_payload(&device_key.private_key_jwk, &payload)
        .expect("приватний ключ пристрою завжди сумісний з ed25519-dalek у Rust-стороні");
    let mut record = payload;
    record["pubkey"] = json!(device_key.public_key_base64);
    record["signature"] = json!(signature);
    record
}

async fn append_log(io: &dyn Io, path: &str, record: &Value) {
    let existing = io.read_file(path).await.unwrap_or_default();
    let prefix = if !existing.is_empty() && !existing.ends_with('\n') {
        format!("{existing}\n")
    } else {
        existing
    };
    io.write_file(path, &format!("{prefix}{}\n", record)).await;
}

/// `kill_switch_on` — пише активний маркер + дописує лог, БЕЗ квізу
/// (`kill-switch.js: killSwitchOn`).
pub async fn kill_switch_on(
    io: &dyn Io,
    mandates_dir: &str,
    handle: &str,
    device_key: &DeviceKeypair,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Value {
    let record = build_and_sign_record(handle, "on", device_key, now).await;
    let marker = json!({"activated_at": record["at"], "pubkey": record["pubkey"], "signature": record["signature"]});
    io.write_file(
        &kill_switch_path(mandates_dir, handle),
        &format!("{}\n", serde_json::to_string_pretty(&marker).unwrap()),
    )
    .await;
    append_log(io, &kill_switch_log_path(mandates_dir), &record).await;
    json!({"active": true, "activatedAt": record["at"]})
}

/// `kill_switch_off` — перезаписує маркер порожнім (реверсивність),
/// дописує лог НОВИМ підписом (`kill-switch.js: killSwitchOff`).
pub async fn kill_switch_off(
    io: &dyn Io,
    mandates_dir: &str,
    handle: &str,
    device_key: &DeviceKeypair,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Value {
    let record = build_and_sign_record(handle, "off", device_key, now).await;
    io.write_file(&kill_switch_path(mandates_dir, handle), "")
        .await;
    append_log(io, &kill_switch_log_path(mandates_dir), &record).await;
    json!({"active": false, "deactivatedAt": record["at"]})
}

/// `kill_switch_status` — читає ПОТОЧНИЙ стан маркера (`kill-switch.js:
/// killSwitchStatus`).
pub async fn kill_switch_status(io: &dyn Io, mandates_dir: &str, handle: &str) -> Value {
    let text = io.read_file(&kill_switch_path(mandates_dir, handle)).await;
    json!({"active": is_kill_switch_active(text.as_deref())})
}

pub struct KillSwitchContext {
    pub redirect: HashMap<String, String>,
    pub active_handles: HashSet<String>,
}

/// Будує деривовану карту перенаправлення черги + множину пригнічених для
/// watcher-а — ОДИН прохід по person-owner карти мандатів (`kill-switch.js:
/// buildKillSwitchRedirect`).
pub async fn build_kill_switch_redirect(
    io: &dyn Io,
    mandates_dir: &str,
    mandates: &[Mandate],
) -> KillSwitchContext {
    let people: Vec<&Mandate> = mandates
        .iter()
        .filter(|m| m.kind != MandateKind::Model)
        .collect();
    let mut active_handles = HashSet::new();
    for person in &people {
        let status = kill_switch_status(io, mandates_dir, &person.owner).await;
        if status["active"] == json!(true) {
            active_handles.insert(person.owner.clone());
        }
    }
    let mut redirect = HashMap::new();
    for model in mandates.iter().filter(|m| m.kind == MandateKind::Model) {
        if let Some(delegator) = &model.escalates_to {
            if active_handles.contains(delegator) {
                redirect.insert(model.owner.clone(), delegator.clone());
            }
        }
    }
    KillSwitchContext {
        redirect,
        active_handles,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemoryIo;
    use crate::signing::generate_device_keypair;
    use mt_mandates::{AudacityLevel, Scope, Thresholds};

    fn mandates_fixture() -> Vec<Mandate> {
        vec![
            Mandate {
                owner: "olena".into(),
                kind: MandateKind::Person,
                scope: Scope {
                    refs: vec!["refs/mt/tasks/design/**".into()],
                    decision_types: vec!["architecture".into()],
                },
                thresholds: Thresholds {
                    budget_eur: Some(2000.0),
                    risk: None,
                    irreversible: Some(false),
                    audacity: None,
                },
                escalates_to: Some("vitalii".into()),
            },
            Mandate {
                owner: "fable-5".into(),
                kind: MandateKind::Model,
                scope: Scope {
                    refs: vec!["refs/mt/tasks/routine/**".into()],
                    decision_types: vec!["ops".into()],
                },
                thresholds: Thresholds {
                    budget_eur: Some(200.0),
                    risk: None,
                    irreversible: Some(false),
                    audacity: Some(AudacityLevel::Medium),
                },
                escalates_to: Some("olena".into()),
            },
            Mandate {
                owner: "vitalii".into(),
                kind: MandateKind::Person,
                scope: Scope {
                    refs: vec!["refs/mt/**".into()],
                    decision_types: vec!["*".into()],
                },
                thresholds: Thresholds::default(),
                escalates_to: None,
            },
        ]
    }

    #[test]
    fn paths() {
        assert_eq!(
            kill_switch_path("/root", "olena"),
            "/root/.mt/kill-switch/olena.json"
        );
        assert_eq!(
            kill_switch_log_path("/root"),
            "/root/.mt/kill-switch/log.jsonl"
        );
    }

    #[test]
    fn is_active_missing_empty_or_corrupt_is_false() {
        assert!(!is_kill_switch_active(None));
        assert!(!is_kill_switch_active(Some("")));
        assert!(!is_kill_switch_active(Some("   ")));
        assert!(!is_kill_switch_active(Some("not json")));
    }

    #[test]
    fn is_active_valid_json_is_true() {
        assert!(is_kill_switch_active(Some(
            r#"{"activated_at":"2026-08-09T10:00:00.000Z"}"#
        )));
    }

    #[tokio::test]
    async fn on_writes_active_marker_and_appends_log() {
        let io = MemoryIo::default();
        let key = generate_device_keypair();
        let now = chrono::DateTime::parse_from_rfc3339("2026-08-09T10:00:00.000Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let result = kill_switch_on(&io, "/root", "olena", &key, Some(now)).await;
        assert_eq!(result["active"], true);
        assert_eq!(result["activatedAt"], "2026-08-09T10:00:00.000Z");
        let status = kill_switch_status(&io, "/root", "olena").await;
        assert_eq!(status["active"], true);
        let log = io.get("/root/.mt/kill-switch/log.jsonl").unwrap();
        let entries: Vec<Value> = log
            .trim()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["handle"], "olena");
        assert_eq!(entries[0]["action"], "on");
    }

    #[tokio::test]
    async fn off_empties_marker_appends_new_signature() {
        let io = MemoryIo::default();
        let key = generate_device_keypair();
        let now1 = chrono::DateTime::parse_from_rfc3339("2026-08-09T10:00:00.000Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let now2 = chrono::DateTime::parse_from_rfc3339("2026-08-09T11:00:00.000Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        kill_switch_on(&io, "/root", "olena", &key, Some(now1)).await;
        let result = kill_switch_off(&io, "/root", "olena", &key, Some(now2)).await;
        assert_eq!(result["active"], false);
        let status = kill_switch_status(&io, "/root", "olena").await;
        assert_eq!(status["active"], false);
        let log = io.get("/root/.mt/kill-switch/log.jsonl").unwrap();
        let entries: Vec<Value> = log
            .trim()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1]["action"], "off");
        assert_ne!(entries[1]["signature"], entries[0]["signature"]);
    }

    #[tokio::test]
    async fn status_without_activation_is_inactive() {
        let io = MemoryIo::default();
        let status = kill_switch_status(&io, "/root", "olena").await;
        assert_eq!(status["active"], false);
    }

    #[tokio::test]
    async fn redirect_active_owner_redirects_their_model() {
        let io = MemoryIo::default();
        let key = generate_device_keypair();
        kill_switch_on(&io, "/root", "olena", &key, None).await;
        let ctx = build_kill_switch_redirect(&io, "/root", &mandates_fixture()).await;
        assert_eq!(ctx.active_handles, HashSet::from(["olena".to_string()]));
        assert_eq!(ctx.redirect.get("fable-5"), Some(&"olena".to_string()));
    }

    #[tokio::test]
    async fn redirect_nobody_active_is_empty() {
        let io = MemoryIo::default();
        let ctx = build_kill_switch_redirect(&io, "/root", &mandates_fixture()).await;
        assert!(ctx.redirect.is_empty());
        assert!(ctx.active_handles.is_empty());
    }
}
