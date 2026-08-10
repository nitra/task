//! Трек-рекорд ШІ-мандата — порт `delta/src/track-record.js` (M3).
//! Дериваційний зріз history `decisions/` для ОДНОГО `handle` (моделі) —
//! скільки рішень якого `decision_type`, останні N з розгорткою, і частка
//! рішень без наступного людського override.
//!
//! **ЧЕСНІСТЬ** (задокументовано за прямою вимогою задачі): ці числа —
//! «активність і послідовність» моделі, НЕ «success rate»/«якість».
//! Атрибуція підписанта — виключно через `device_registry` (схема
//! `ApprovalResponse` несе лише `pubkey`, не `handle`/`role`).

use serde::Serialize;

use crate::decisions::{parse_decision_request, DecisionRequestMeta};
use crate::device_registry::{find_by_pubkey, DeviceRegistryEntry, SignerRole};

const DEFAULT_RECENT_LIMIT: usize = 5;

struct Pair {
    run_id: Option<String>,
    nnnn: String,
    path: String,
    decision_type: String,
    chosen_option: Option<String>,
    signed_at: Option<String>,
    pubkey: Option<String>,
}

fn decision_request_nnnn(file_name: &str) -> Option<String> {
    let re = regex::Regex::new(r"^(\d{4})-decision-request\.md$").unwrap();
    re.captures(file_name).map(|c| c[1].to_string())
}

pub struct DecisionsDirScan<'a> {
    pub dir: &'a str,
    pub files: &'a [(String, String)],
}

fn pairs_in_dir(scan: &DecisionsDirScan<'_>) -> Vec<Pair> {
    let files_by_name: std::collections::HashMap<&str, &str> = scan
        .files
        .iter()
        .map(|(n, c)| (n.as_str(), c.as_str()))
        .collect();
    let run_id = scan
        .dir
        .split('/')
        .filter(|s| !s.is_empty())
        .rev()
        .nth(1)
        .map(str::to_string);
    let mut pairs = Vec::new();
    for (name, content) in scan.files {
        let Some(nnnn) = decision_request_nnnn(name) else {
            continue;
        };
        let Some(approval_text) = files_by_name.get(format!("{nnnn}-approval.json").as_str())
        else {
            continue;
        };
        let Ok(approval) = serde_json::from_str::<serde_json::Value>(approval_text) else {
            continue;
        };
        let Ok(dr) = parse_decision_request(
            content,
            DecisionRequestMeta {
                path: Some(format!("{}/{}", scan.dir, name)),
                run_id: run_id.clone(),
                nnnn: Some(nnnn.clone()),
            },
        ) else {
            continue;
        };
        pairs.push(Pair {
            run_id: run_id.clone(),
            nnnn: nnnn.clone(),
            path: format!("{}/{}-approval.json", scan.dir, nnnn),
            decision_type: dr.decision_type.unwrap_or_else(|| "general".to_string()),
            chosen_option: approval
                .get("chosen_option")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            signed_at: approval
                .get("signed_at")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            pubkey: approval
                .get("pubkey")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        });
    }
    pairs
}

fn signer_of<'a>(
    pair: &Pair,
    registry: &'a [DeviceRegistryEntry],
) -> Option<&'a DeviceRegistryEntry> {
    find_by_pubkey(registry, pair.pubkey.as_deref()?)
}

fn is_overridden(model_pair: &Pair, run_pairs: &[&Pair], registry: &[DeviceRegistryEntry]) -> bool {
    let Some(model_signed_at) = model_pair
        .signed_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    else {
        return false;
    };
    run_pairs.iter().any(|other| {
        if std::ptr::eq(*other, model_pair) {
            return false;
        }
        let Some(signer) = signer_of(other, registry) else {
            return false;
        };
        if signer.role != SignerRole::Human {
            return false;
        }
        if other.chosen_option == model_pair.chosen_option {
            return false;
        }
        other
            .signed_at
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .is_some_and(|t| t > model_signed_at)
    })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DecisionTypeCount {
    #[serde(rename = "decisionType")]
    pub decision_type: String,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RecentDecision {
    #[serde(rename = "runId")]
    pub run_id: Option<String>,
    pub nnnn: String,
    #[serde(rename = "decisionType")]
    pub decision_type: String,
    #[serde(rename = "chosenOption")]
    pub chosen_option: Option<String>,
    #[serde(rename = "signedAt")]
    pub signed_at: Option<String>,
    pub path: String,
    pub r#override: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TrackRecord {
    pub handle: String,
    #[serde(rename = "totalDecisions")]
    pub total_decisions: usize,
    #[serde(rename = "byDecisionType")]
    pub by_decision_type: Vec<DecisionTypeCount>,
    pub recent: Vec<RecentDecision>,
    #[serde(rename = "overrideCount")]
    pub override_count: usize,
    #[serde(rename = "overrideFreeCount")]
    pub override_free_count: usize,
    #[serde(rename = "overrideFreeRate")]
    pub override_free_rate: Option<f64>,
}

/// Дериваційний трек-рекорд одного `handle` (моделі) — `track-record.js:
/// deriveTrackRecord`.
pub fn derive_track_record(
    decisions_dirs: &[DecisionsDirScan<'_>],
    device_registry: &[DeviceRegistryEntry],
    handle: &str,
    recent_limit: Option<usize>,
) -> TrackRecord {
    let recent_limit = recent_limit.unwrap_or(DEFAULT_RECENT_LIMIT);
    let mut entries = Vec::new();
    for scan in decisions_dirs {
        let run_pairs = pairs_in_dir(scan);
        let run_pairs_ref: Vec<&Pair> = run_pairs.iter().collect();
        for pair in &run_pairs {
            let Some(signer) = signer_of(pair, device_registry) else {
                continue;
            };
            if signer.role != SignerRole::Model || signer.handle != handle {
                continue;
            }
            entries.push(RecentDecision {
                run_id: pair.run_id.clone(),
                nnnn: pair.nnnn.clone(),
                decision_type: pair.decision_type.clone(),
                chosen_option: pair.chosen_option.clone(),
                signed_at: pair.signed_at.clone(),
                path: pair.path.clone(),
                r#override: is_overridden(pair, &run_pairs_ref, device_registry),
            });
        }
    }

    let mut sorted_by_recency = entries.clone();
    sorted_by_recency.sort_by(|a, b| b.signed_at.cmp(&a.signed_at));
    let override_count = entries.iter().filter(|e| e.r#override).count();
    let override_free_count = entries.len() - override_count;

    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for e in &entries {
        *counts.entry(e.decision_type.clone()).or_insert(0) += 1;
    }
    let mut by_decision_type: Vec<DecisionTypeCount> = counts
        .into_iter()
        .map(|(decision_type, count)| DecisionTypeCount {
            decision_type,
            count,
        })
        .collect();
    by_decision_type.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.decision_type.cmp(&b.decision_type))
    });

    TrackRecord {
        handle: handle.to_string(),
        total_decisions: entries.len(),
        by_decision_type,
        recent: sorted_by_recency.into_iter().take(recent_limit).collect(),
        override_count,
        override_free_count,
        override_free_rate: if entries.is_empty() {
            None
        } else {
            Some(override_free_count as f64 / entries.len() as f64)
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device_registry::upsert_device;
    use chrono::TimeZone;

    fn now() -> chrono::DateTime<chrono::Utc> {
        chrono::Utc.with_ymd_and_hms(2026, 8, 9, 10, 0, 0).unwrap()
    }

    const DR_0001: &str =
        include_str!("../tests/fixtures/runs/demo-1/decisions/0001-decision-request.md");

    fn registry_with_model_and_human() -> Vec<DeviceRegistryEntry> {
        let r = upsert_device(&[], "fable-5", SignerRole::Model, "model-pk", now());
        upsert_device(&r, "olena", SignerRole::Human, "human-pk", now())
    }

    #[test]
    fn counts_only_decisions_signed_by_this_model_handle() {
        let files = vec![
            ("0001-decision-request.md".to_string(), DR_0001.to_string()),
            ("0001-approval.json".to_string(), r#"{"chosen_option":"B","signed_at":"2026-08-01T00:00:00.000Z","pubkey":"model-pk"}"#.to_string()),
        ];
        let dirs = vec![DecisionsDirScan {
            dir: "/root/runs/demo-1/decisions",
            files: &files,
        }];
        let registry = registry_with_model_and_human();
        let track = derive_track_record(&dirs, &registry, "fable-5", None);
        assert_eq!(track.total_decisions, 1);
        assert_eq!(
            track.by_decision_type,
            vec![DecisionTypeCount {
                decision_type: "architecture".into(),
                count: 1
            }]
        );
    }

    #[test]
    fn unregistered_pubkey_not_counted() {
        let files = vec![
            ("0001-decision-request.md".to_string(), DR_0001.to_string()),
            ("0001-approval.json".to_string(), r#"{"chosen_option":"B","signed_at":"2026-08-01T00:00:00.000Z","pubkey":"unknown"}"#.to_string()),
        ];
        let dirs = vec![DecisionsDirScan {
            dir: "/root/runs/demo-1/decisions",
            files: &files,
        }];
        let registry = registry_with_model_and_human();
        let track = derive_track_record(&dirs, &registry, "fable-5", None);
        assert_eq!(track.total_decisions, 0);
        assert_eq!(track.override_free_rate, None);
    }

    #[test]
    fn later_opposing_human_signature_in_same_run_counts_as_override() {
        let files = vec![
            ("0001-decision-request.md".to_string(), DR_0001.to_string()),
            ("0001-approval.json".to_string(), r#"{"chosen_option":"B","signed_at":"2026-08-01T00:00:00.000Z","pubkey":"model-pk"}"#.to_string()),
            ("0002-decision-request.md".to_string(), DR_0001.replace("0001", "0002")),
            ("0002-approval.json".to_string(), r#"{"chosen_option":"A","signed_at":"2026-08-02T00:00:00.000Z","pubkey":"human-pk"}"#.to_string()),
        ];
        let dirs = vec![DecisionsDirScan {
            dir: "/root/runs/demo-1/decisions",
            files: &files,
        }];
        let registry = registry_with_model_and_human();
        let track = derive_track_record(&dirs, &registry, "fable-5", None);
        assert_eq!(track.total_decisions, 1);
        assert_eq!(track.override_count, 1);
        assert_eq!(track.override_free_count, 0);
    }
}
