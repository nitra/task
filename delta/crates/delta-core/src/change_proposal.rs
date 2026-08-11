//! Change-proposal flow — порт `delta/src/change-proposal.js` (M3,
//! конституція п.4: «кнопка розширення ШІ-мандата завжди веде до
//! людського підпису з квізом найвищої глибини»). Розширення мандата
//! НІКОЛИ не пише `.mt/mandates.yaml` напряму: матеріалізується як
//! звичайний `decision-request` у черзі делегатора
//! (`runs/mandate-change-{id}/decisions/0001-decision-request.md`), що
//! проходить ТОЙ САМИЙ M1/M2-конвеєр (`decision_flow`), що будь-яка інша
//! розвилка — лише після цього застосовується
//! `mandate_change::apply_mandate_change_if_valid`.
//!
//! **Форс глибини квізу — задокументоване рішення, успадковане з JS
//! (за прямою вимогою задачі M3).** `leverage_facets` НЕ описують реальний
//! ризик зміни мандата — СВІДОМО форсують `irreversible: false` +
//! `blast_radius: subtree`, щоб `depth_for_facets` мапила на `standard`
//! (найвищу глибину, яку `decision_flow` реалізує; `teach-back` лишається
//! наступним кроком).

use mt_mandates::{Mandate, MandatesFile};
use serde_json::{json, Value};

use crate::device_registry::SignerRole;
use crate::io::Io;
use crate::mandate_change::{
    apply_mandate_change_if_valid, mandate_signer, sign_mandate_change_act,
};
use crate::signing::DeviceKeypair;

fn format_axis_value(value: &Value) -> String {
    match value {
        Value::Null => "—".to_string(),
        Value::Array(arr) => {
            if arr.is_empty() {
                "—".to_string()
            } else {
                arr.iter()
                    .map(|v| v.as_str().unwrap_or_default().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            }
        }
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Людиночитабельний перелік осей, що змінились між `old`/`new` мандатом —
/// `change-proposal.js: describeMandateDiffLines`.
pub fn describe_mandate_diff_lines(old: &Mandate, new: &Mandate) -> Vec<String> {
    let mut lines = Vec::new();
    if old.scope.refs != new.scope.refs {
        lines.push(format!(
            "scope.refs: {} → {}",
            format_axis_value(&json!(old.scope.refs)),
            format_axis_value(&json!(new.scope.refs))
        ));
    }
    if old.scope.decision_types != new.scope.decision_types {
        lines.push(format!(
            "scope.decision_types: {} → {}",
            format_axis_value(&json!(old.scope.decision_types)),
            format_axis_value(&json!(new.scope.decision_types))
        ));
    }
    if old.thresholds.budget_eur != new.thresholds.budget_eur {
        lines.push(format!(
            "thresholds.budget_eur: {} → {}",
            format_axis_value(&json!(old.thresholds.budget_eur)),
            format_axis_value(&json!(new.thresholds.budget_eur))
        ));
    }
    if old.thresholds.risk != new.thresholds.risk {
        lines.push(format!(
            "thresholds.risk: {} → {}",
            format_axis_value(&json!(old.thresholds.risk)),
            format_axis_value(&json!(new.thresholds.risk))
        ));
    }
    if old.thresholds.irreversible != new.thresholds.irreversible {
        lines.push(format!(
            "thresholds.irreversible: {} → {}",
            format_axis_value(&json!(old.thresholds.irreversible)),
            format_axis_value(&json!(new.thresholds.irreversible))
        ));
    }
    if old.thresholds.audacity != new.thresholds.audacity {
        lines.push(format!(
            "thresholds.audacity: {} → {}",
            format_axis_value(&json!(old.thresholds.audacity)),
            format_axis_value(&json!(new.thresholds.audacity))
        ));
    }
    lines
}

/// Будує markdown-текст change-proposal decision-request — `computed_owner`
/// ЗАВЖДИ делегатор (`change-proposal.js: buildChangeProposalMarkdown`).
#[allow(clippy::too_many_arguments)]
pub fn build_change_proposal_markdown(
    old: &MandatesFile,
    new_file: &MandatesFile,
    owner_handle: &str,
    delegator_handle: &str,
    initiated_by: &str,
    reason_text: &str,
    evidence_text: Option<&str>,
) -> String {
    let old_mandate = old.mandates.iter().find(|m| m.owner == owner_handle);
    let new_mandate = new_file.mandates.iter().find(|m| m.owner == owner_handle);
    let diff_lines: Vec<String> = match (old_mandate, new_mandate) {
        (Some(o), Some(n)) => describe_mandate_diff_lines(o, n),
        _ => Vec::new(),
    };

    let frontmatter = [
        "---".to_string(),
        "type: decision-request".to_string(),
        format!("mandate_generation: {}", old.generation),
        format!("computed_owner: {delegator_handle}"),
        format!("escalation_chain: [{delegator_handle}]"),
        "retry_history: []".to_string(),
        "leverage_facets: { irreversible: false, blast_radius: subtree, divergence: high }"
            .to_string(),
        "deadline_cost: \"мандат лишається у старих межах, доки не підписано\"".to_string(),
        format!("recommended_by: {initiated_by}"),
        "decision_type: mandate-change".to_string(),
        "---".to_string(),
        String::new(),
    ]
    .join("\n");

    let mut context_lines = vec![
        format!(
            "Запропоновано зміну мандата власника `{owner_handle}` (generation {} → {}).",
            old.generation, new_file.generation
        ),
        String::new(),
        "Зміни по осях:".to_string(),
    ];
    context_lines.extend(diff_lines.iter().map(|l| format!("- {l}")));
    if let Some(evidence) = evidence_text {
        context_lines.push(String::new());
        context_lines.push("Evidence:".to_string());
        context_lines.push(evidence.to_string());
    }

    let body = [
        "## Контекст".to_string(),
        String::new(),
        context_lines.join("\n"),
        String::new(),
        "## Варіанти".to_string(),
        String::new(),
        "### A. Застосувати зміну".to_string(),
        String::new(),
        format!("Наслідки: `.mt/mandates.yaml` оновлюється (generation {}), мандат `{owner_handle}` діє за новими межами негайно.", new_file.generation),
        String::new(),
        "### B. Відхилити".to_string(),
        String::new(),
        format!("Наслідки: `.mt/mandates.yaml` лишається без змін (generation {}), мандат `{owner_handle}` діє за старими межами.", old.generation),
        String::new(),
        "## Рекомендація агента".to_string(),
        String::new(),
        reason_text.to_string(),
    ]
    .join("\n");

    format!("{frontmatter}{body}\n")
}

pub fn change_proposal_run_id(change_id: &str) -> String {
    format!("mandate-change-{change_id}")
}

pub fn change_proposal_decisions_dir(mandates_dir: &str, change_id: &str) -> String {
    format!(
        "{mandates_dir}/runs/{}/decisions",
        change_proposal_run_id(change_id)
    )
}

pub struct WrittenChangeProposal {
    pub decision_request_path: String,
    pub change_json_path: String,
}

/// Пише decision-request + сусідній `0001-change.json` — `change-proposal.js:
/// writeChangeProposal`.
#[allow(clippy::too_many_arguments)]
pub async fn write_change_proposal(
    io: &dyn Io,
    mandates_dir: &str,
    change_id: &str,
    old: &MandatesFile,
    new_file: &MandatesFile,
    owner_handle: &str,
    delegator_handle: &str,
    initiated_by: &str,
    reason_text: &str,
    evidence_text: Option<&str>,
) -> WrittenChangeProposal {
    let decisions_dir = change_proposal_decisions_dir(mandates_dir, change_id);
    let decision_request_path = format!("{decisions_dir}/0001-decision-request.md");
    let change_json_path = format!("{decisions_dir}/0001-change.json");
    let markdown = build_change_proposal_markdown(
        old,
        new_file,
        owner_handle,
        delegator_handle,
        initiated_by,
        reason_text,
        evidence_text,
    );
    io.write_file(&decision_request_path, &markdown).await;
    let change_json = serde_json::to_string_pretty(&json!({"old": old, "new": new_file}))
        .expect("MandatesFile серіалізується без помилок");
    io.write_file(&change_json_path, &format!("{change_json}\n"))
        .await;
    WrittenChangeProposal {
        decision_request_path,
        change_json_path,
    }
}

/// Читає `0001-change.json` — `change-proposal.js: readChangeProposal`.
pub async fn read_change_proposal(
    io: &dyn Io,
    mandates_dir: &str,
    change_id: &str,
) -> Option<(MandatesFile, MandatesFile)> {
    let path = format!(
        "{}/0001-change.json",
        change_proposal_decisions_dir(mandates_dir, change_id)
    );
    let text = io.read_file(&path).await?;
    let parsed: Value = serde_json::from_str(&text).ok()?;
    let old: MandatesFile = serde_json::from_value(parsed.get("old")?.clone()).ok()?;
    let new_file: MandatesFile = serde_json::from_value(parsed.get("new")?.clone()).ok()?;
    Some((old, new_file))
}

/// Застосовує change-proposal ПІСЛЯ того, як людина пройшла звичайний
/// M1/M2-конвеєр і підписала `ApprovalResponse` на decision-request —
/// `change-proposal.js: applyMandateChangeProposal`. Той самий фізичний
/// ключ пристрою підписує ОБИДВА незалежні акти (квіз-approval через
/// `approval.rs`, мутація мандата через `mandate_change.rs`).
#[allow(clippy::too_many_arguments)]
pub async fn apply_mandate_change_proposal(
    io: &dyn Io,
    mandates_yaml_path: &str,
    old: &MandatesFile,
    new_file: &MandatesFile,
    approval: &Value,
    handle: &str,
    role: SignerRole,
    device_key: &DeviceKeypair,
    extra_signatures: Vec<mt_mandates::MandateChangeSignature>,
    applied_marker_path: Option<&str>,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Value {
    let approved = approval
        .get("approved")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let chosen_option = approval.get("chosen_option").and_then(|v| v.as_str());
    if !approved || chosen_option != Some("A") {
        return json!({"valid": false, "reason": "change-proposal не підписано варіантом A (застосувати) — mandates.yaml не змінюється"});
    }
    let Some(sig_bytes) = sign_mandate_change_act(device_key, old.generation, new_file) else {
        return json!({"valid": false, "reason": "ключ пристрою несумісний з ed25519-dalek — підпис mandate-change неможливий"});
    };
    let Some(signer) = mandate_signer(handle, role, device_key) else {
        return json!({"valid": false, "reason": "ключ пристрою несумісний з ed25519-dalek — підпис mandate-change неможливий"});
    };
    let mut signatures = extra_signatures;
    signatures.push(mt_mandates::MandateChangeSignature {
        signer,
        signature: sig_bytes,
    });
    let verdict =
        apply_mandate_change_if_valid(io, mandates_yaml_path, old, new_file, &signatures).await;
    if verdict["valid"] == json!(true) {
        if let Some(marker_path) = applied_marker_path {
            let applied_at = now
                .unwrap_or_else(chrono::Utc::now)
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            let role_str = match role {
                SignerRole::Human => "human",
                SignerRole::Model => "model",
            };
            let marker = json!({"appliedAt": applied_at, "handle": handle, "role": role_str});
            io.write_file(
                marker_path,
                &format!("{}\n", serde_json::to_string_pretty(&marker).unwrap()),
            )
            .await;
        }
    }
    verdict
}

/// Звуження ШІ-мандата — самопідпис, миттєво, БЕЗ квіз-конвеєра —
/// `change-proposal.js: applyMandateNarrow`.
pub async fn apply_mandate_narrow(
    io: &dyn Io,
    mandates_yaml_path: &str,
    old: &MandatesFile,
    new_file: &MandatesFile,
    handle: &str,
    role: SignerRole,
    device_key: &DeviceKeypair,
) -> Value {
    let Some(sig_bytes) = sign_mandate_change_act(device_key, old.generation, new_file) else {
        return json!({"valid": false, "reason": "ключ пристрою несумісний з ed25519-dalek — підпис mandate-change неможливий"});
    };
    let Some(signer) = mandate_signer(handle, role, device_key) else {
        return json!({"valid": false, "reason": "ключ пристрою несумісний з ed25519-dalek — підпис mandate-change неможливий"});
    };
    apply_mandate_change_if_valid(
        io,
        mandates_yaml_path,
        old,
        new_file,
        &[mt_mandates::MandateChangeSignature {
            signer,
            signature: sig_bytes,
        }],
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemoryIo;
    use crate::signing::generate_device_keypair;
    use crate::test_support::base_file;
    use mt_mandates::AudacityLevel;

    #[test]
    fn describe_diff_lines_lists_only_changed_axes() {
        let old = base_file(1);
        let mut new_mandate = old.mandates[2].clone();
        new_mandate.thresholds.audacity = Some(AudacityLevel::High);
        let lines = describe_mandate_diff_lines(&old.mandates[2], &new_mandate);
        assert_eq!(lines, vec!["thresholds.audacity: medium → high"]);
    }

    #[test]
    fn markdown_forces_standard_depth_facets() {
        let old = base_file(1);
        let mut new_file = base_file(2);
        new_file.mandates[2].thresholds.audacity = Some(AudacityLevel::High);
        let md = build_change_proposal_markdown(
            &old,
            &new_file,
            "fable-5",
            "olena",
            "ai-petition-fable-5",
            "petition reason",
            Some("evidence text"),
        );
        assert!(md.contains("computed_owner: olena"));
        assert!(md.contains("irreversible: false, blast_radius: subtree"));
        assert!(md.contains("decision_type: mandate-change"));
        assert!(md.contains("### A. Застосувати зміну"));
        assert!(md.contains("evidence text"));
    }

    #[tokio::test]
    async fn write_and_read_change_proposal_round_trips() {
        let old = base_file(1);
        let new_file = base_file(2);
        let io = MemoryIo::default();
        let written = write_change_proposal(
            &io, "/ws", "demo-1", &old, &new_file, "fable-5", "olena", "olena", "reason", None,
        )
        .await;
        assert!(io.has(&written.decision_request_path));
        let (read_old, read_new) = read_change_proposal(&io, "/ws", "demo-1").await.unwrap();
        assert_eq!(read_old, old);
        assert_eq!(read_new, new_file);
    }

    #[tokio::test]
    async fn apply_change_proposal_rejects_non_a_chosen_option() {
        let old = base_file(1);
        let mut new_file = base_file(2);
        new_file.mandates[2].thresholds.audacity = Some(AudacityLevel::High);
        let keypair = generate_device_keypair();
        let io = MemoryIo::default();
        let approval = json!({"approved": true, "chosen_option": "B"});
        let result = apply_mandate_change_proposal(
            &io,
            "/x/.mt/mandates.yaml",
            &old,
            &new_file,
            &approval,
            "olena",
            SignerRole::Human,
            &keypair,
            vec![],
            None,
            None,
        )
        .await;
        assert_eq!(result["valid"], false);
        assert!(!io.has("/x/.mt/mandates.yaml"));
    }

    #[tokio::test]
    async fn apply_change_proposal_valid_a_writes_file_and_marker() {
        let old = base_file(1);
        let mut new_file = base_file(2);
        new_file.mandates[2].thresholds.audacity = Some(AudacityLevel::High);
        let keypair = generate_device_keypair();
        let io = MemoryIo::default();
        let approval = json!({"approved": true, "chosen_option": "A"});
        let result = apply_mandate_change_proposal(
            &io,
            "/x/.mt/mandates.yaml",
            &old,
            &new_file,
            &approval,
            "olena",
            SignerRole::Human,
            &keypair,
            vec![],
            Some("/x/applied.json"),
            None,
        )
        .await;
        assert_eq!(result["valid"], true);
        assert!(io.has("/x/.mt/mandates.yaml"));
        assert!(io.has("/x/applied.json"));
    }

    #[tokio::test]
    async fn apply_mandate_narrow_self_signed_no_quiz_needed() {
        let old = base_file(1);
        let mut new_file = base_file(2);
        new_file.mandates[2].thresholds.audacity = Some(AudacityLevel::Low); // narrow
        let keypair = generate_device_keypair();
        let io = MemoryIo::default();
        let result = apply_mandate_narrow(
            &io,
            "/x/.mt/mandates.yaml",
            &old,
            &new_file,
            "fable-5",
            SignerRole::Model,
            &keypair,
        )
        .await;
        assert_eq!(result["valid"], true);
        assert!(io.has("/x/.mt/mandates.yaml"));
    }
}
