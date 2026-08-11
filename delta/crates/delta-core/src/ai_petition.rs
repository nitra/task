//! ШІ-петиція — порт `delta/src/ai-petition.js` (M3): headless tool
//! `ai_petition`, СИМУЛЮЄ модель. Формує draft-розширення власного мандата
//! з evidence (`track_record`), підписує ЛИШЕ петицію (не зміну) модельним
//! ключем, кладе ту саму change-proposal (`change_proposal.rs`) у чергу
//! людини-делегатора.
//!
//! **Інваріант (буквально з задачі):** «Модельний ключ підписує ЛИШЕ
//! петицію-пропозицію (не зміну) — підпис зміни завжди людський.» Тут
//! підписується РІВНО ОДИН артефакт модельним ключем — сама петиція
//! (`0001-petition.json`). Сам decision-request НЕ підписаний, доки
//! людина не пройде квіз-гейт (`decision_flow`); мутація
//! `.mt/mandates.yaml` (`change_proposal::apply_mandate_change_proposal`)
//! вимагає ЛЮДСЬКОГО ключа безумовно («остання константа»,
//! `mandate_change.rs`/`mt_mandates::change`) — цей шлях і далі підписує
//! петицію тим самим канонікалізованим JSON-підписом, що `ApprovalResponse`
//! (`signing.rs`), НЕ через `mt_mandates::change` (петиція — не мутація
//! мандата, окремий крипто-шлях, той самий, що JS-оригінал).

use serde_json::{json, Value};

use crate::change_proposal::{
    change_proposal_decisions_dir, write_change_proposal, WrittenChangeProposal,
};
use crate::io::Io;
use crate::signing::{sign_payload, verify_payload, DeviceKeypair, PublicKeySource};
use crate::track_record::TrackRecord;

/// Людиночитабельний evidence-текст із трек-рекорду моделі — «ЧЕСНІСТЬ»:
/// «активність і послідовність», не «якість» (`ai-petition.js:
/// buildEvidenceText`).
pub fn build_evidence_text(track_record: &TrackRecord) -> String {
    if track_record.total_decisions == 0 {
        return "Немає підписаних рішень цього мандата ще — evidence відсутній (петиція спирається лише на заявлений намір).".to_string();
    }
    let by_type = track_record
        .by_decision_type
        .iter()
        .map(|t| format!("{}: {}", t.decision_type, t.count))
        .collect::<Vec<_>>()
        .join(", ");
    let rate_text = track_record
        .override_free_rate
        .map(|r| format!("{}%", (r * 100.0).round()))
        .unwrap_or_else(|| "н/д".to_string());
    format!(
        "{} підписаних рішень у межах поточного мандата ({by_type}); {}/{} без наступного людського override ({rate_text}). Це активність і послідовність, НЕ оцінка якості рішень — audit-механіки для цього ще немає.",
        track_record.total_decisions, track_record.override_free_count, track_record.total_decisions
    )
}

/// Canonical payload петиції — підписується ЛИШЕ модельним ключем
/// (`ai-petition.js: buildPetitionPayload`).
pub fn build_petition_payload(
    model_handle: &str,
    owner_handle: &str,
    old_generation: u64,
    new_generation: u64,
    evidence_text: &str,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Value {
    json!({
        "schema_version": 1,
        "type": "ai-petition",
        "model_handle": model_handle,
        "owner_handle": owner_handle,
        "old_generation": old_generation,
        "new_generation": new_generation,
        "evidence": evidence_text,
        "proposed_at": now.unwrap_or_else(chrono::Utc::now).to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    })
}

/// Підписує петицію модельним ключем пристрою (`ai-petition.js:
/// signPetition`).
pub fn sign_petition(payload: &Value, device_key: &DeviceKeypair) -> Option<Value> {
    let signature = sign_payload(&device_key.private_key_jwk, payload)?;
    let mut petition = payload.clone();
    petition["pubkey"] = json!(device_key.public_key_base64);
    petition["signature"] = json!(signature);
    Some(petition)
}

/// Перевіряє підписану петицію проти власного `pubkey` (`ai-petition.js:
/// verifyPetition`).
pub fn verify_petition(petition: &Value) -> bool {
    let Some(obj) = petition.as_object() else {
        return false;
    };
    let Some(pubkey) = obj.get("pubkey").and_then(|v| v.as_str()) else {
        return false;
    };
    let Some(signature) = obj.get("signature").and_then(|v| v.as_str()) else {
        return false;
    };
    let mut payload = obj.clone();
    payload.remove("pubkey");
    payload.remove("signature");
    verify_payload(
        PublicKeySource::Base64(pubkey),
        &Value::Object(payload),
        signature,
    )
}

pub fn format_petition_file(petition: &Value) -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(petition).expect("Value серіалізується без помилок")
    )
}

pub struct AiPetitionResult {
    pub petition_path: String,
    pub written: WrittenChangeProposal,
    pub evidence_text: String,
    pub petition: Value,
}

/// Headless-tool `ai_petition` — `ai-petition.js: aiPetition`.
#[allow(clippy::too_many_arguments)]
pub async fn ai_petition(
    io: &dyn Io,
    mandates_dir: &str,
    change_id: &str,
    old: &mt_mandates::MandatesFile,
    new_file: &mt_mandates::MandatesFile,
    model_handle: &str,
    delegator_handle: &str,
    track_record: &TrackRecord,
    model_device_key: &DeviceKeypair,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Option<AiPetitionResult> {
    let evidence_text = build_evidence_text(track_record);
    let payload = build_petition_payload(
        model_handle,
        model_handle,
        old.generation,
        new_file.generation,
        &evidence_text,
        now,
    );
    let petition = sign_petition(&payload, model_device_key)?;

    let decisions_dir = change_proposal_decisions_dir(mandates_dir, change_id);
    let petition_path = format!("{decisions_dir}/0001-petition.json");
    io.write_file(&petition_path, &format_petition_file(&petition))
        .await;

    let reason_text =
        format!("Петиція від {model_handle} на розширення власного мандата. {evidence_text}");
    let written = write_change_proposal(
        io,
        mandates_dir,
        change_id,
        old,
        new_file,
        model_handle,
        delegator_handle,
        &format!("ai-petition-{model_handle}"),
        &reason_text,
        Some(&evidence_text),
    )
    .await;

    Some(AiPetitionResult {
        petition_path,
        written,
        evidence_text,
        petition,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemoryIo;
    use crate::signing::generate_device_keypair;
    use crate::test_support::base_file;
    use crate::track_record::{DecisionTypeCount, TrackRecord};
    use mt_mandates::AudacityLevel;

    fn track_record_with_history() -> TrackRecord {
        TrackRecord {
            handle: "fable-5".into(),
            total_decisions: 4,
            by_decision_type: vec![DecisionTypeCount {
                decision_type: "ops".into(),
                count: 4,
            }],
            recent: vec![],
            override_count: 1,
            override_free_count: 3,
            override_free_rate: Some(0.75),
        }
    }

    #[test]
    fn evidence_text_empty_track_record_is_honest_about_absence() {
        let empty = TrackRecord {
            handle: "fable-5".into(),
            total_decisions: 0,
            by_decision_type: vec![],
            recent: vec![],
            override_count: 0,
            override_free_count: 0,
            override_free_rate: None,
        };
        let text = build_evidence_text(&empty);
        assert!(text.contains("Немає підписаних рішень"));
    }

    #[test]
    fn evidence_text_with_history_mentions_activity_not_quality() {
        let text = build_evidence_text(&track_record_with_history());
        assert!(text.contains("4 підписаних рішень"));
        assert!(text.contains("3/4"));
        assert!(text.contains("75%"));
        assert!(text.contains("НЕ оцінка якості"));
    }

    #[test]
    fn sign_and_verify_petition_round_trip() {
        let keypair = generate_device_keypair();
        let payload = build_petition_payload("fable-5", "fable-5", 1, 2, "evidence", None);
        let petition = sign_petition(&payload, &keypair).unwrap();
        assert!(verify_petition(&petition));
    }

    #[test]
    fn tampered_petition_fails_verification() {
        let keypair = generate_device_keypair();
        let payload = build_petition_payload("fable-5", "fable-5", 1, 2, "evidence", None);
        let mut petition = sign_petition(&payload, &keypair).unwrap();
        petition["evidence"] = json!("tampered");
        assert!(!verify_petition(&petition));
    }

    #[tokio::test]
    async fn ai_petition_writes_petition_and_change_proposal_files() {
        let old = base_file(1);
        let mut new_file = base_file(2);
        new_file.mandates[2].thresholds.audacity = Some(AudacityLevel::High);
        let model_key = generate_device_keypair();
        let io = MemoryIo::default();
        let result = ai_petition(
            &io,
            "/ws",
            "demo-1",
            &old,
            &new_file,
            "fable-5",
            "olena",
            &track_record_with_history(),
            &model_key,
            None,
        )
        .await
        .unwrap();
        assert!(io.has(&result.petition_path));
        assert!(io.has(&result.written.decision_request_path));
        assert!(io.has(&result.written.change_json_path));
        assert!(verify_petition(&result.petition));
        let dr_text = io.get(&result.written.decision_request_path).unwrap();
        assert!(dr_text.contains("computed_owner: olena"));
        assert!(dr_text.contains("recommended_by: ai-petition-fable-5"));
    }
}
