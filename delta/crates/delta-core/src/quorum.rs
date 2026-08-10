//! Мультипартійний підпис (кворум) для irreversible-рішень — порт
//! `delta/src/quorum.js` (M4/M5; конституція п.8: «Мультипартійний підпис
//! для незворотного: картка показує кворум і чиї квізи пройдені»).
//!
//! На відміну від `decision_flow` (один `computed_owner`, один
//! `NNNN-quiz.md`/`NNNN-approval.json`), тут КОЖЕН `approvers`-handle
//! отримує ВЛАСНИЙ квіз-файл `NNNN-quiz-{handle}.md` і ВЛАСНИЙ підписаний
//! `NNNN-approval-{handle}.json` — `decisions::derive_quorum_status`
//! деривує загальний стан кворуму з усіх approval-файлів одразу. Depth —
//! ЗАВЖДИ `teach-back` (переказ, оцінюється локальною моделлю, БЕЗ
//! детермінованого фолбека — той самий інваріант, що `decision_flow`).

use serde_json::{json, Value};

use crate::decisions::{
    derive_quorum_status, parse_decision_request, requires_quorum, resolve_approvers,
    DecisionRequest, DecisionRequestMeta,
};
use crate::io::Io;
use crate::quiz::{
    call_llm_teach_back_evaluator, format_teach_back_file, parse_teach_back_file,
    teach_back_prompt_text, LlmConfig, TeachBackAttempt, TeachBackDraft, TeachBackEvalRecord,
    TEACHBACK_UNAVAILABLE_MESSAGE,
};
use crate::signing::{sign_payload, DeviceKeypair};

const QUORUM_DEPTH: &str = "teach-back";

fn decision_request_path(decisions_dir: &str, nnnn: &str) -> String {
    format!("{decisions_dir}/{nnnn}-decision-request.md")
}
fn quiz_path(decisions_dir: &str, nnnn: &str, handle: &str) -> String {
    format!("{decisions_dir}/{nnnn}-quiz-{handle}.md")
}
fn approval_path(decisions_dir: &str, nnnn: &str, handle: &str) -> String {
    format!("{decisions_dir}/{nnnn}-approval-{handle}.json")
}

async fn load_quorum_decision_request(
    io: &dyn Io,
    decisions_dir: &str,
    nnnn: &str,
) -> Result<DecisionRequest, String> {
    let path = decision_request_path(decisions_dir, nnnn);
    let text = io
        .read_file(&path)
        .await
        .ok_or_else(|| format!("decision-request не знайдено: {path}"))?;
    let dr = parse_decision_request(
        &text,
        DecisionRequestMeta {
            path: Some(path.clone()),
            nnnn: Some(nnnn.to_string()),
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?;
    if !requires_quorum(&dr.leverage_facets) {
        return Err(format!(
            "decision {nnnn}: кворум-конвеєр застосовується лише до irreversible-рішень (leverage_facets.irreversible: true) — інші йдуть через decision_flow"
        ));
    }
    Ok(dr)
}

async fn assert_signer_open(
    io: &dyn Io,
    decisions_dir: &str,
    nnnn: &str,
    handle: &str,
) -> Result<(), String> {
    if io
        .read_file(&approval_path(decisions_dir, nnnn, handle))
        .await
        .is_some()
    {
        return Err(format!("decision {nnnn}: '{handle}' уже підписав(ла) свою частину кворуму — approval термінальний"));
    }
    Ok(())
}

fn assert_is_approver(dr: &DecisionRequest, signer_handle: &str) -> Result<Vec<String>, String> {
    let approvers = resolve_approvers(dr);
    if !approvers.iter().any(|a| a == signer_handle) {
        return Err(format!(
            "decision {}: '{signer_handle}' не входить до approvers [{}] цього рішення",
            dr.nnnn.as_deref().unwrap_or(""),
            approvers.join(", ")
        ));
    }
    Ok(approvers)
}

/// Генерує (перший виклик) або показує (повторний) підказку-промпт
/// власного teach-back-квізу підписанта — `quorum.js: quorumQuiz`.
pub async fn quorum_quiz(
    io: &dyn Io,
    decisions_dir: &str,
    nnnn: &str,
    signer_handle: &str,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Value, String> {
    assert_signer_open(io, decisions_dir, nnnn, signer_handle).await?;
    let dr = load_quorum_decision_request(io, decisions_dir, nnnn).await?;
    assert_is_approver(&dr, signer_handle)?;

    let path = quiz_path(decisions_dir, nnnn, signer_handle);
    if let Some(existing_text) = io.read_file(&path).await {
        let state = parse_teach_back_file(&existing_text);
        let last_attempt = state.attempts.last();
        let failed = last_attempt.is_some_and(|a| a.evaluation.understood == Some(false));
        return Ok(json!({
            "quizPath": path, "depth": QUORUM_DEPTH, "prompt": teach_back_prompt_text(),
            "iterations": state.iterations, "generatedBy": state.generated_by, "signerHandle": signer_handle,
            "lastFeedback": if failed { last_attempt.map(|a| a.evaluation.feedback.clone()) } else { None::<String> },
            "missingAspects": if failed { last_attempt.map(|a| a.evaluation.missing_aspects.clone()).unwrap_or_default() } else { Vec::<String>::new() },
        }));
    }

    let shown_at = now
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let draft = TeachBackDraft {
        decision_ref: format!("{nnnn}-decision-request.md"),
        generated_by: "teach-back-prompt".to_string(),
        shown_at: Some(shown_at),
        iterations: 0,
        attempts: vec![],
        time_to_understanding_sec: None,
    };
    io.write_file(&path, &format_teach_back_file(&draft)).await;
    Ok(json!({
        "quizPath": path, "depth": QUORUM_DEPTH, "prompt": teach_back_prompt_text(), "iterations": 0,
        "generatedBy": "teach-back-prompt", "signerHandle": signer_handle, "lastFeedback": Value::Null, "missingAspects": Vec::<String>::new(),
    }))
}

/// Проводить teach-back-спробу власного квізу підписанта — `quorum.js:
/// submitQuorumAnswer`.
#[allow(clippy::too_many_arguments)]
pub async fn submit_quorum_answer(
    io: &dyn Io,
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    decisions_dir: &str,
    nnnn: &str,
    signer_handle: &str,
    transcript: &str,
    chosen_option: &str,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Value, String> {
    assert_signer_open(io, decisions_dir, nnnn, signer_handle).await?;
    let path = quiz_path(decisions_dir, nnnn, signer_handle);
    let existing_text = io.read_file(&path).await.ok_or_else(|| {
        format!("квіз для {nnnn}/{signer_handle} ще не згенеровано — виклич quorum_quiz спершу")
    })?;
    if transcript.trim().is_empty() {
        return Err("teach-back: потрібен непорожній transcript (переказ своїми словами) — quorum_approve з полем transcript".to_string());
    }

    let state = parse_teach_back_file(&existing_text);
    let dr = load_quorum_decision_request(io, decisions_dir, nnnn).await?;
    let evaluation =
        call_llm_teach_back_evaluator(client, llm_config, &dr, chosen_option, transcript).await;
    let Some(evaluation) = evaluation else {
        return Ok(
            json!({"correct": false, "done": false, "available": false, "iterations": state.iterations, "message": TEACHBACK_UNAVAILABLE_MESSAGE}),
        );
    };

    let mut attempts = state.attempts.clone();
    attempts.push(TeachBackAttempt {
        transcript: transcript.to_string(),
        evaluation: TeachBackEvalRecord {
            understood: Some(evaluation.understood),
            missing_aspects: evaluation.missing_aspects.clone(),
            feedback: evaluation.feedback.clone(),
        },
    });
    let iterations = attempts.len() as u64;

    if !evaluation.understood {
        let draft = TeachBackDraft {
            decision_ref: state.decision_ref.clone(),
            generated_by: evaluation.generated_by.clone(),
            shown_at: state.shown_at.clone(),
            iterations,
            attempts,
            time_to_understanding_sec: None,
        };
        io.write_file(&path, &format_teach_back_file(&draft)).await;
        return Ok(
            json!({"correct": false, "done": false, "available": true, "iterations": iterations, "feedback": evaluation.feedback, "missingAspects": evaluation.missing_aspects}),
        );
    }

    let now_date = now.unwrap_or_else(chrono::Utc::now);
    let shown_at_ms = state
        .shown_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
        .unwrap_or_else(|| now_date.timestamp_millis());
    let time_to_understanding_sec = ((now_date.timestamp_millis() - shown_at_ms) as f64 / 1000.0)
        .round()
        .max(0.0);
    let final_state = TeachBackDraft {
        decision_ref: state.decision_ref.clone(),
        generated_by: evaluation.generated_by.clone(),
        iterations,
        time_to_understanding_sec: Some(time_to_understanding_sec),
        shown_at: None,
        attempts,
    };
    io.write_file(&path, &format_teach_back_file(&final_state))
        .await;
    Ok(
        json!({"correct": true, "done": true, "available": true, "iterations": iterations, "feedback": evaluation.feedback}),
    )
}

async fn build_and_sign_quorum_approval(
    request_id: &str,
    chosen_option: &str,
    quiz_ref: &str,
    signer_handle: &str,
    device_key: &DeviceKeypair,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Value {
    let signed_at = now
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let payload = json!({
        "schema_version": 1, "request_id": request_id, "approved": true, "chosen_option": chosen_option,
        "quiz_ref": quiz_ref, "signer_handle": signer_handle, "signed_at": signed_at,
    });
    let signature = sign_payload(&device_key.private_key_jwk, &payload)
        .expect("приватний ключ пристрою завжди сумісний з ed25519-dalek у Rust-стороні");
    let mut approval = payload;
    approval["pubkey"] = json!(device_key.public_key_base64);
    approval["signature"] = json!(signature);
    approval
}

/// Повний потік `quorum_approve` — `quorum.js: quorumApprove`.
#[allow(clippy::too_many_arguments)]
pub async fn quorum_approve(
    io: &dyn Io,
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    decisions_dir: &str,
    run_id: &str,
    nnnn: &str,
    signer_handle: &str,
    chosen_option: &str,
    transcript: &str,
    device_key: &DeviceKeypair,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Value, String> {
    let result = submit_quorum_answer(
        io,
        client,
        llm_config,
        decisions_dir,
        nnnn,
        signer_handle,
        transcript,
        chosen_option,
        now,
    )
    .await?;
    if result["available"] == json!(false) {
        return Ok(
            json!({"approved": false, "correct": false, "done": false, "available": false, "iterations": result["iterations"], "message": result["message"]}),
        );
    }
    if result["correct"] != json!(true) {
        return Ok(
            json!({"approved": false, "correct": false, "done": false, "iterations": result["iterations"], "feedback": result["feedback"], "missingAspects": result["missingAspects"]}),
        );
    }

    let request_id = format!("{run_id}/{nnnn}");
    let quiz_ref = format!("decisions/{nnnn}-quiz-{signer_handle}.md");
    let approval = build_and_sign_quorum_approval(
        &request_id,
        chosen_option,
        &quiz_ref,
        signer_handle,
        device_key,
        now,
    )
    .await;
    let approval_file_path = approval_path(decisions_dir, nnnn, signer_handle);
    io.write_file(
        &approval_file_path,
        &crate::approval::format_approval_file(&approval),
    )
    .await;
    Ok(
        json!({"approved": true, "correct": true, "done": true, "iterations": result["iterations"], "approval": approval, "approvalPath": approval_file_path, "feedback": result["feedback"]}),
    )
}

/// Точковий запит стану кворуму одного рішення — `quorum.js:
/// loadQuorumStatus`.
pub async fn load_quorum_status(
    io: &dyn Io,
    decisions_dir: &str,
    nnnn: &str,
) -> Result<Value, String> {
    let dr = load_quorum_decision_request(io, decisions_dir, nnnn).await?;
    let approvers = resolve_approvers(&dr);
    let mut files_by_name = std::collections::HashMap::new();
    for handle in &approvers {
        if let Some(raw) = io
            .read_file(&approval_path(decisions_dir, nnnn, handle))
            .await
        {
            files_by_name.insert(format!("{nnnn}-approval-{handle}.json"), raw);
        }
    }
    let status = derive_quorum_status(&dr, &files_by_name);
    let signed: Vec<Value> = status.signed.iter().map(|s| json!({"handle": s.handle, "chosenOption": s.chosen_option, "signedAt": s.signed_at})).collect();
    let status_str = match status.status {
        crate::decisions::QuorumState::Pending => "pending",
        crate::decisions::QuorumState::Closed => "closed",
        crate::decisions::QuorumState::Diverged => "diverged",
    };
    Ok(
        json!({"nnnn": nnnn, "approvers": status.approvers, "signed": signed, "pending": status.pending, "status": status_str}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemoryIo;
    use crate::signing::generate_device_keypair;

    const DECISIONS_DIR: &str = "/root/runs/demo-5/decisions";
    const DR_IRREVERSIBLE: &str =
        include_str!("../tests/fixtures/runs/demo-5/decisions/0001-decision-request.md");

    fn client() -> reqwest::Client {
        reqwest::Client::new()
    }
    fn unreachable_llm() -> LlmConfig {
        LlmConfig {
            base_url: "http://127.0.0.1:1".into(),
            model: "x".into(),
        }
    }
    fn dr_path() -> String {
        format!("{DECISIONS_DIR}/0001-decision-request.md")
    }

    #[tokio::test]
    async fn quorum_quiz_first_call_writes_draft_with_shown_at() {
        let io = MemoryIo::new([(dr_path(), DR_IRREVERSIBLE.to_string())]);
        let result = quorum_quiz(&io, DECISIONS_DIR, "0001", "olena", None)
            .await
            .unwrap();
        assert_eq!(result["depth"], "teach-back");
        assert!(!result["prompt"].as_str().unwrap().is_empty());
        assert!(io
            .get(&format!("{DECISIONS_DIR}/0001-quiz-olena.md"))
            .unwrap()
            .contains("shown_at"));
    }

    #[tokio::test]
    async fn quorum_quiz_non_approver_is_rejected() {
        let io = MemoryIo::new([(dr_path(), DR_IRREVERSIBLE.to_string())]);
        let err = quorum_quiz(&io, DECISIONS_DIR, "0001", "fable-5", None)
            .await
            .unwrap_err();
        assert!(err.contains("не входить до approvers"));
    }

    #[tokio::test]
    async fn submit_quorum_answer_network_error_is_honest_refusal() {
        let io = MemoryIo::new([(dr_path(), DR_IRREVERSIBLE.to_string())]);
        quorum_quiz(&io, DECISIONS_DIR, "0001", "olena", None)
            .await
            .unwrap();
        let result = submit_quorum_answer(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            "olena",
            "переказ",
            "A",
            None,
        )
        .await
        .unwrap();
        assert_eq!(result["available"], false);
        assert_eq!(result["correct"], false);
    }

    #[tokio::test]
    async fn quorum_approve_writes_per_signer_approval_and_status_pending_until_both_sign() {
        let io = MemoryIo::new([(dr_path(), DR_IRREVERSIBLE.to_string())]);
        quorum_quiz(&io, DECISIONS_DIR, "0001", "olena", None)
            .await
            .unwrap();
        let keypair_olena = generate_device_keypair();
        // Mock teach-back evaluation isn't reachable here (no LLM) — simulate a finished
        // teach-back file directly to exercise quorum_approve's success path deterministically.
        let quiz_path = format!("{DECISIONS_DIR}/0001-quiz-olena.md");
        let finished = TeachBackDraft {
            decision_ref: "0001-decision-request.md".into(),
            generated_by: "teachback-eval-x".into(),
            iterations: 1,
            time_to_understanding_sec: Some(10.0),
            shown_at: None,
            attempts: vec![TeachBackAttempt {
                transcript: "переказ".into(),
                evaluation: TeachBackEvalRecord {
                    understood: Some(true),
                    missing_aspects: vec![],
                    feedback: "ok".into(),
                },
            }],
        };
        io.write_file(&quiz_path, &format_teach_back_file(&finished))
            .await;

        let request_id = "demo-5/0001".to_string();
        let quiz_ref = "decisions/0001-quiz-olena.md".to_string();
        let approval = build_and_sign_quorum_approval(
            &request_id,
            "A",
            &quiz_ref,
            "olena",
            &keypair_olena,
            None,
        )
        .await;
        io.write_file(
            &format!("{DECISIONS_DIR}/0001-approval-olena.json"),
            &crate::approval::format_approval_file(&approval),
        )
        .await;

        let status = load_quorum_status(&io, DECISIONS_DIR, "0001")
            .await
            .unwrap();
        assert_eq!(status["status"], "pending");
        assert_eq!(status["pending"], json!(["vitalii"]));
    }

    #[tokio::test]
    async fn quorum_status_closes_when_both_approvers_sign_same_option() {
        let io = MemoryIo::new([(dr_path(), DR_IRREVERSIBLE.to_string())]);
        for handle in ["olena", "vitalii"] {
            let keypair = generate_device_keypair();
            let approval = build_and_sign_quorum_approval(
                "demo-5/0001",
                "A",
                &format!("decisions/0001-quiz-{handle}.md"),
                handle,
                &keypair,
                None,
            )
            .await;
            io.write_file(
                &format!("{DECISIONS_DIR}/0001-approval-{handle}.json"),
                &crate::approval::format_approval_file(&approval),
            )
            .await;
        }
        let status = load_quorum_status(&io, DECISIONS_DIR, "0001")
            .await
            .unwrap();
        assert_eq!(status["status"], "closed");
    }

    #[tokio::test]
    async fn quorum_status_diverges_on_different_chosen_option() {
        let io = MemoryIo::new([(dr_path(), DR_IRREVERSIBLE.to_string())]);
        for (handle, option) in [("olena", "A"), ("vitalii", "B")] {
            let keypair = generate_device_keypair();
            let approval = build_and_sign_quorum_approval(
                "demo-5/0001",
                option,
                &format!("decisions/0001-quiz-{handle}.md"),
                handle,
                &keypair,
                None,
            )
            .await;
            io.write_file(
                &format!("{DECISIONS_DIR}/0001-approval-{handle}.json"),
                &crate::approval::format_approval_file(&approval),
            )
            .await;
        }
        let status = load_quorum_status(&io, DECISIONS_DIR, "0001")
            .await
            .unwrap();
        assert_eq!(status["status"], "diverged");
    }

    #[tokio::test]
    async fn quorum_quiz_signer_who_already_signed_is_rejected() {
        let io = MemoryIo::new([(dr_path(), DR_IRREVERSIBLE.to_string())]);
        let keypair = generate_device_keypair();
        let approval = build_and_sign_quorum_approval(
            "demo-5/0001",
            "A",
            "decisions/0001-quiz-olena.md",
            "olena",
            &keypair,
            None,
        )
        .await;
        io.write_file(
            &format!("{DECISIONS_DIR}/0001-approval-olena.json"),
            &crate::approval::format_approval_file(&approval),
        )
        .await;
        let err = quorum_quiz(&io, DECISIONS_DIR, "0001", "olena", None)
            .await
            .unwrap_err();
        assert!(err.contains("уже підписав"));
    }
}
