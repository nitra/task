//! Детектор соціального дрейфу — приватне дзеркало, порт `delta/src/drift.js`
//! (M5). Headless-actor патерн, той самий, що `watcher`: `detect_drift` —
//! pure-функція над сканованими `decisionsDirs`, `run_drift_scan` —
//! оркеструє скан + персист. Картки — ЛОКАЛЬНО поза git (`drift.json`),
//! НЕ в спільний `.mt/notifications`.

use regex::Regex;
use serde::Serialize;

use crate::decisions::{parse_decision_request, DecisionsDir};
use crate::io::KnowledgeIo;

const DEFAULT_STALE_DAYS: f64 = 7.0;
const DEFAULT_ITERATIONS_THRESHOLD: u64 = 3;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DriftConfig {
    pub stale_days: f64,
    pub iterations_threshold: u64,
}

pub fn default_drift_config() -> DriftConfig {
    DriftConfig {
        stale_days: DEFAULT_STALE_DAYS,
        iterations_threshold: DEFAULT_ITERATIONS_THRESHOLD,
    }
}

fn age_days_of(opened_at_iso: Option<&str>, now: chrono::DateTime<chrono::Utc>) -> Option<f64> {
    let opened = chrono::DateTime::parse_from_rfc3339(opened_at_iso?).ok()?;
    Some(
        (now.timestamp_millis() - opened.timestamp_millis()) as f64 / (24.0 * 60.0 * 60.0 * 1000.0),
    )
}

/// `iterations` квіз-чернетки, якщо файл є — читає сирий `iterations:`
/// рядок фронтматера напряму (`drift.js: quizIterations`).
fn quiz_iterations(quiz_text: Option<&str>) -> u64 {
    let Some(text) = quiz_text else { return 0 };
    let re = Regex::new(r"(?m)^iterations: (\d+)$").unwrap();
    re.captures(text)
        .and_then(|c| c[1].parse().ok())
        .unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DriftSignal {
    Stale,
    RepeatedIterations,
    Both,
}

#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
pub struct DriftItem {
    pub nnnn: String,
    #[serde(rename = "runId")]
    pub run_id: Option<String>,
    #[serde(rename = "ageDays")]
    pub age_days: Option<i64>,
    pub iterations: u64,
    #[serde(rename = "deadlineCost")]
    pub deadline_cost: Option<String>,
    pub signal: DriftSignal,
}

#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
pub struct DriftCard {
    #[serde(rename = "decisionType")]
    pub decision_type: String,
    pub count: usize,
    #[serde(rename = "oldestAgeDays")]
    pub oldest_age_days: i64,
    #[serde(rename = "deadlineCostSample")]
    pub deadline_cost_sample: Option<String>,
    pub items: Vec<DriftItem>,
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
}

struct RawItem {
    decision_type: String,
    item: DriftItem,
}

fn drift_signal(stale: bool, repeated: bool) -> DriftSignal {
    if stale && repeated {
        DriftSignal::Both
    } else if stale {
        DriftSignal::Stale
    } else {
        DriftSignal::RepeatedIterations
    }
}

#[allow(clippy::too_many_arguments)]
fn drift_item_or_none(
    name: &str,
    content: &str,
    files_by_name: &std::collections::HashMap<String, String>,
    nnnn: &str,
    dir: &str,
    handle: &str,
    now: chrono::DateTime<chrono::Utc>,
    config: &DriftConfig,
) -> Option<RawItem> {
    let parsed = parse_decision_request(
        content,
        crate::decisions::DecisionRequestMeta {
            path: Some(format!("{dir}/{name}")),
            nnnn: Some(nnnn.to_string()),
            ..Default::default()
        },
    )
    .ok()?;
    if parsed.computed_owner.as_deref() != Some(handle) {
        return None;
    }
    if parsed.leverage_facets.irreversible {
        return None;
    }
    if files_by_name.contains_key(&format!("{nnnn}-approval.json")) {
        return None;
    }

    let age = age_days_of(parsed.opened_at.as_deref(), now);
    let iterations = quiz_iterations(
        files_by_name
            .get(&format!("{nnnn}-quiz.md"))
            .map(|s| s.as_str()),
    );
    let stale = age.is_some_and(|a| a >= config.stale_days);
    let repeated = iterations >= config.iterations_threshold;
    if !stale && !repeated {
        return None;
    }

    let run_id = dir
        .split('/')
        .filter(|s| !s.is_empty())
        .rev()
        .nth(1)
        .map(str::to_string);
    Some(RawItem {
        decision_type: parsed
            .decision_type
            .unwrap_or_else(|| "general".to_string()),
        item: DriftItem {
            nnnn: nnnn.to_string(),
            run_id,
            age_days: age.map(|a| a.round() as i64),
            iterations,
            deadline_cost: parsed.deadline_cost,
            signal: drift_signal(stale, repeated),
        },
    })
}

/// Деривує дрейф-картки одного власника — pure-функція (`drift.js:
/// detectDrift`).
pub fn detect_drift(
    decisions_dirs: &[DecisionsDir],
    handle: Option<&str>,
    now: chrono::DateTime<chrono::Utc>,
    config: Option<DriftConfig>,
) -> Vec<DriftCard> {
    let Some(handle) = handle else {
        return Vec::new();
    };
    let config = config.unwrap_or_else(default_drift_config);
    let re = Regex::new(r"^(\d{4})-decision-request\.md$").unwrap();

    let mut items: Vec<RawItem> = Vec::new();
    for d in decisions_dirs {
        let files_by_name: std::collections::HashMap<String, String> =
            d.files.iter().cloned().collect();
        for (name, content) in &d.files {
            let Some(caps) = re.captures(name) else {
                continue;
            };
            let nnnn = &caps[1];
            if let Some(item) = drift_item_or_none(
                name,
                content,
                &files_by_name,
                nnnn,
                &d.dir,
                handle,
                now,
                &config,
            ) {
                items.push(item);
            }
        }
    }

    let mut by_type: std::collections::HashMap<String, Vec<DriftItem>> =
        std::collections::HashMap::new();
    for raw in items {
        by_type.entry(raw.decision_type).or_default().push(raw.item);
    }

    let mut cards: Vec<DriftCard> = by_type
        .into_iter()
        .map(|(decision_type, mut typed_items)| {
            typed_items.sort_by_key(|b| std::cmp::Reverse(b.age_days.unwrap_or(0)));
            let oldest = typed_items
                .iter()
                .map(|i| i.age_days.unwrap_or(0))
                .max()
                .unwrap_or(0);
            let sample = typed_items.iter().find_map(|i| i.deadline_cost.clone());
            DriftCard {
                decision_type,
                count: typed_items.len(),
                oldest_age_days: oldest,
                deadline_cost_sample: sample,
                items: typed_items,
                generated_at: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            }
        })
        .collect();
    cards.sort_by_key(|b| std::cmp::Reverse(b.oldest_age_days));
    cards
}

/// Розбирає локальний файл дрейф-карток — fail-safe (`drift.js:
/// parseDriftFile`).
pub fn parse_drift_file(text: Option<&str>) -> Vec<DriftCard> {
    let Some(text) = text else { return Vec::new() };
    serde_json::from_str(text).unwrap_or_default()
}

pub fn format_drift_file(cards: &[DriftCard]) -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(cards).expect("Vec<DriftCard> серіалізується без помилок")
    )
}

pub async fn load_drift_cards(drift_io: Option<&dyn KnowledgeIo>) -> Vec<DriftCard> {
    let Some(io) = drift_io else {
        return Vec::new();
    };
    parse_drift_file(io.read().await.as_deref())
}

pub async fn save_drift_cards(drift_io: Option<&dyn KnowledgeIo>, cards: &[DriftCard]) {
    let Some(io) = drift_io else { return };
    io.write(&format_drift_file(cards)).await;
}

/// Повний потік `drift_scan`: деривує картки і ПЕРЕЗАПИСУЄ локальний файл
/// (не append — застаріла картка зникає сама, коли клас закрито) —
/// `drift.js: runDriftScan`.
pub async fn run_drift_scan(
    decisions_dirs: &[DecisionsDir],
    handle: Option<&str>,
    drift_io: Option<&dyn KnowledgeIo>,
    config: Option<DriftConfig>,
    now: chrono::DateTime<chrono::Utc>,
) -> Vec<DriftCard> {
    let cards = detect_drift(decisions_dirs, handle, now, config);
    save_drift_cards(drift_io, &cards).await;
    cards
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemoryKnowledgeIo;

    const DR_0004: &str =
        include_str!("../tests/fixtures/runs/demo-1/decisions/0004-decision-request.md");
    const DR_0001: &str =
        include_str!("../tests/fixtures/runs/demo-1/decisions/0001-decision-request.md");
    const DR_IRREVERSIBLE: &str =
        include_str!("../tests/fixtures/runs/demo-5/decisions/0001-decision-request.md");

    fn now() -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339("2026-08-09T10:00:00.000Z")
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    #[test]
    fn default_config_matches_spec() {
        let c = default_drift_config();
        assert_eq!(c.stale_days, 7.0);
        assert_eq!(c.iterations_threshold, 3);
    }

    #[test]
    fn no_handle_is_empty() {
        assert!(detect_drift(&[], None, now(), None).is_empty());
    }

    #[test]
    fn stale_ops_decision_is_one_card() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![("0004-decision-request.md".into(), DR_0004.into())],
        }];
        let cards = detect_drift(&dirs, Some("olena"), now(), None);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].decision_type, "ops");
        assert_eq!(cards[0].count, 1);
        assert_eq!(cards[0].items[0].signal, DriftSignal::Stale);
        assert!(cards[0].items[0].age_days.unwrap() >= 39);
        assert_eq!(
            cards[0].deadline_cost_sample.as_deref(),
            Some("немає залежних задач")
        );
    }

    #[test]
    fn fresh_open_decision_not_drift() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![("0001-decision-request.md".into(), DR_0001.into())],
        }];
        assert!(detect_drift(&dirs, Some("olena"), now(), None).is_empty());
    }

    #[test]
    fn closed_decision_not_drift_even_if_stale() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                ("0004-decision-request.md".into(), DR_0004.into()),
                ("0004-approval.json".into(), r#"{"approved":true}"#.into()),
            ],
        }];
        assert!(detect_drift(&dirs, Some("olena"), now(), None).is_empty());
    }

    #[test]
    fn other_owner_not_drift() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![("0004-decision-request.md".into(), DR_0004.into())],
        }];
        assert!(detect_drift(&dirs, Some("vitalii"), now(), None).is_empty());
    }

    #[test]
    fn irreversible_not_drift() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-5/decisions".into(),
            files: vec![("0001-decision-request.md".into(), DR_IRREVERSIBLE.into())],
        }];
        assert!(detect_drift(&dirs, Some("vitalii"), now(), None).is_empty());
    }

    #[test]
    fn repeated_iterations_signal_even_if_fresh() {
        let quiz_text = "---\nschema_version: 1\ndepth: one-tap\niterations: 5\n---\n";
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                ("0001-decision-request.md".into(), DR_0001.into()),
                ("0001-quiz.md".into(), quiz_text.into()),
            ],
        }];
        let cards = detect_drift(&dirs, Some("olena"), now(), None);
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].items[0].signal, DriftSignal::RepeatedIterations);
        assert_eq!(cards[0].items[0].iterations, 5);
    }

    #[test]
    fn custom_thresholds_apply() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![("0004-decision-request.md".into(), DR_0004.into())],
        }];
        let config = DriftConfig {
            stale_days: 1000.0,
            iterations_threshold: 3,
        };
        assert!(detect_drift(&dirs, Some("olena"), now(), Some(config)).is_empty());
    }

    #[test]
    fn format_parse_round_trip() {
        let cards = vec![DriftCard {
            decision_type: "ops".into(),
            count: 1,
            oldest_age_days: 39,
            deadline_cost_sample: None,
            items: vec![],
            generated_at: now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        }];
        assert_eq!(parse_drift_file(Some(&format_drift_file(&cards))), cards);
    }

    #[test]
    fn parse_missing_or_corrupt_is_empty() {
        assert!(parse_drift_file(None).is_empty());
        assert!(parse_drift_file(Some("not json")).is_empty());
    }

    #[tokio::test]
    async fn load_save_without_io_are_noop() {
        assert!(load_drift_cards(None).await.is_empty());
        save_drift_cards(None, &[]).await;
    }

    #[tokio::test]
    async fn run_drift_scan_overwrites_not_appends() {
        let stale_card = DriftCard {
            decision_type: "stale-class".into(),
            count: 99,
            oldest_age_days: 999,
            deadline_cost_sample: None,
            items: vec![],
            generated_at: "2020-01-01T00:00:00.000Z".into(),
        };
        let io = MemoryKnowledgeIo::new(Some(format_drift_file(&[stale_card])));
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![("0004-decision-request.md".into(), DR_0004.into())],
        }];
        let cards = run_drift_scan(&dirs, Some("olena"), Some(&io), None, now()).await;
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].decision_type, "ops");
        let persisted = load_drift_cards(Some(&io)).await;
        assert_eq!(persisted, cards);
        assert!(!persisted.iter().any(|c| c.decision_type == "stale-class"));
    }
}
