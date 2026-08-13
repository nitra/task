//! «Що про мене знає система» — профспілковий режим за замовчуванням —
//! порт `delta/src/what-system-knows.js` (M4). Чистий агрегатор, БЕЗ
//! нових зборів даних — кожне поле дзеркалить уже наявне джерело
//! (`knowledge`, `watcher`-нотифікації, `device_registry`). Не читає диск
//! сам — приймає вже завантажені дані (`trust::derive_trust_view`-стиль).

use serde_json::{json, Value};

use crate::device_registry::DeviceRegistryEntry;
use crate::knowledge::{domain_digest, time_to_understanding_trend, KnowledgeEntry};

fn role_str(role: crate::device_registry::SignerRole) -> &'static str {
    match role {
        crate::device_registry::SignerRole::Human => "human",
        crate::device_registry::SignerRole::Model => "model",
    }
}

/// Агрегує усі джерела «що система знає про мене» в один зріз для одного
/// `handle` — лише МОЇ записи скрізь (`what-system-knows.js:
/// buildWhatSystemKnows`).
pub fn build_what_system_knows(
    handle: Option<&str>,
    knowledge_entries: &[KnowledgeEntry],
    notifications: &[Value],
    device_registry: &[DeviceRegistryEntry],
) -> Value {
    let my_notifications: Vec<&Value> = notifications
        .iter()
        .filter(|n| n["to"].as_str() == handle)
        .collect();
    let registry_entry = handle.and_then(|h| device_registry.iter().find(|e| e.handle == h));

    let pings_to_me: Vec<&&Value> = my_notifications
        .iter()
        .filter(|n| n["kind"] == "sla-ping-executor")
        .collect();
    let escalated_from_me: Vec<&&Value> = my_notifications
        .iter()
        .filter(|n| n["kind"] == "sla-escalated-notice")
        .collect();
    let batched_now: Vec<&&Value> = my_notifications
        .iter()
        .filter(|n| n["batched"] == json!(true))
        .collect();

    json!({
        "handle": handle,
        "knowledge": {
            "entryCount": knowledge_entries.len(),
            "digest": domain_digest(knowledge_entries),
            "trend": time_to_understanding_trend(knowledge_entries),
        },
        "notifications": {
            "total": my_notifications.len(),
            "pingsToMe": pings_to_me,
            "escalatedFromMe": escalated_from_me,
            "batchedNow": batched_now,
        },
        "registry": {
            "role": registry_entry.map(|e| role_str(e.role)),
            "pubkeyBase64": registry_entry.map(|e| e.pubkey_base64.as_str()),
            "registeredAt": registry_entry.map(|e| e.registered_at.as_str()),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device_registry::SignerRole;

    fn knowledge_entries() -> Vec<KnowledgeEntry> {
        vec![
            KnowledgeEntry {
                id: "1".into(),
                decision_ref: "0001-decision-request.md".into(),
                domain: "architecture".into(),
                question: "q1".into(),
                options: None,
                correct_answer: None,
                microlesson: "m1".into(),
                iterations: 1,
                time_to_understanding_sec: 60.0,
                completed_at: "2026-08-01T00:00:00.000Z".into(),
                interval_days: 1,
                last_repeated_at: None,
                mandate_generation: None,
            },
            KnowledgeEntry {
                id: "2".into(),
                decision_ref: "0002-decision-request.md".into(),
                domain: "architecture".into(),
                question: "q2".into(),
                options: None,
                correct_answer: None,
                microlesson: "m2".into(),
                iterations: 1,
                time_to_understanding_sec: 30.0,
                completed_at: "2026-08-05T00:00:00.000Z".into(),
                interval_days: 1,
                last_repeated_at: None,
                mandate_generation: None,
            },
        ]
    }

    fn notifications() -> Vec<Value> {
        vec![
            json!({"kind": "sla-ping-executor", "to": "olena", "nnnn": "0001", "message": "ping"}),
            json!({"kind": "sla-escalated-notice", "to": "olena", "nnnn": "0001", "escalatedTo": "vitalii", "message": "escalated"}),
            json!({"kind": "sla-escalate-owner", "to": "vitalii", "nnnn": "0001", "executorHandle": "olena", "message": "stuck"}),
            json!({"kind": "sla-ping-executor", "to": "olena", "nnnn": "0002", "message": "ping2", "batched": true}),
        ]
    }

    fn device_registry() -> Vec<DeviceRegistryEntry> {
        vec![
            DeviceRegistryEntry {
                handle: "olena".into(),
                role: SignerRole::Human,
                pubkey_base64: "pk-olena".into(),
                registered_at: "2026-08-01T00:00:00.000Z".into(),
            },
            DeviceRegistryEntry {
                handle: "fable-5".into(),
                role: SignerRole::Model,
                pubkey_base64: "pk-fable-5".into(),
                registered_at: "2026-08-01T00:00:00.000Z".into(),
            },
        ]
    }

    #[test]
    fn empty_inputs_do_not_throw() {
        let result = build_what_system_knows(Some("olena"), &[], &[], &[]);
        assert_eq!(result["handle"], "olena");
        assert_eq!(result["knowledge"]["entryCount"], 0);
        assert_eq!(result["notifications"]["total"], 0);
        assert!(result["registry"]["pubkeyBase64"].is_null());
    }

    #[test]
    fn knowledge_digest_and_trend_via_same_logic() {
        let entries = knowledge_entries();
        let result = build_what_system_knows(Some("olena"), &entries, &[], &[]);
        assert_eq!(result["knowledge"]["entryCount"], 2);
        assert_eq!(result["knowledge"]["digest"].as_array().unwrap().len(), 1);
        assert_eq!(result["knowledge"]["digest"][0]["domain"], "architecture");
        assert_eq!(result["knowledge"]["trend"][0]["trend"], "down");
    }

    #[test]
    fn notifications_filtered_to_mine_and_split() {
        let n = notifications();
        let result = build_what_system_knows(Some("olena"), &[], &n, &[]);
        assert_eq!(result["notifications"]["total"], 3);
        assert_eq!(
            result["notifications"]["pingsToMe"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            result["notifications"]["escalatedFromMe"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            result["notifications"]["escalatedFromMe"][0]["escalatedTo"],
            "vitalii"
        );
        assert_eq!(
            result["notifications"]["batchedNow"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn foreign_notifications_never_leak_into_my_slice() {
        let n = notifications();
        let result = build_what_system_knows(Some("olena"), &[], &n, &[]);
        assert!(result["notifications"]["pingsToMe"]
            .as_array()
            .unwrap()
            .iter()
            .all(|x| x["to"] == "olena"));
        assert!(result["notifications"]["escalatedFromMe"]
            .as_array()
            .unwrap()
            .iter()
            .all(|x| x["to"] == "olena"));
    }

    #[test]
    fn registry_is_mine_only_unknown_handle_is_null() {
        let registry = device_registry();
        let olena = build_what_system_knows(Some("olena"), &[], &[], &registry);
        assert_eq!(
            olena["registry"],
            json!({"role": "human", "pubkeyBase64": "pk-olena", "registeredAt": "2026-08-01T00:00:00.000Z"})
        );
        let unknown = build_what_system_knows(Some("someone-else"), &[], &[], &registry);
        assert_eq!(
            unknown["registry"],
            json!({"role": null, "pubkeyBase64": null, "registeredAt": null})
        );
    }

    #[test]
    fn missing_handle_is_null_rest_stays_empty_safely() {
        let n = notifications();
        let result = build_what_system_knows(None, &[], &n, &[]);
        assert!(result["handle"].is_null());
        assert_eq!(result["notifications"]["total"], 0);
    }
}
