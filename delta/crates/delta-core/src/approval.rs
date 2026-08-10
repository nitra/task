//! `ApprovalResponse` — порт `delta/src/approval.js` (mt:
//! `docs/architecture/mandates.md`, «Розширення ApprovalResponse», M6 фаза
//! 0). **Інваріант**: підпис на decision-request без `quiz_ref`, або з
//! `quiz_ref` на незавершений квіз (немає зафіксованих `iterations`/
//! `time_to_understanding_sec`), — невалідний.
//! `build_and_sign_approval` перевіряє це ДО підпису — немає шляху
//! отримати підписаний approval повз завершений квіз.

use serde_json::{json, Value};

use crate::signing::{sign_payload, verify_payload, PublicKeySource};

/// Мінімальний стан квізу, потрібний для перевірки завершеності —
/// звужено до полів, які `validateApprovalPreconditions` реально читає
/// (повний розібраний квіз-файл — відповідальність ще не портованого
/// `quiz.rs`, див. README «Фаза A Rust-порту», залишок обсягу).
#[derive(Debug, Clone, PartialEq)]
pub struct QuizCompletion {
    pub decision_ref: String,
    pub iterations: Option<u64>,
    pub time_to_understanding_sec: Option<f64>,
}

/// Квіз завершений, коли зафіксовані обидва похідні поля фіналізації
/// (mandates.md: «схема свідомо без passed/failed» — завершеність міряється
/// наявністю `iterations`/`time_to_understanding_sec`, не окремим
/// прапорцем). `iterations: 0` — НЕ завершено (жодного заходу ще не було).
pub fn quiz_is_complete(quiz: Option<&QuizCompletion>) -> bool {
    match quiz {
        Some(q) => {
            matches!(q.iterations, Some(n) if n >= 1) && q.time_to_understanding_sec.is_some()
        }
        None => false,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ApprovalPreconditionError {
    MissingQuizRef,
    QuizNotComplete,
    DecisionRefMismatch {
        quiz_decision_ref: String,
        decision_ref: String,
    },
}

impl std::fmt::Display for ApprovalPreconditionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingQuizRef => write!(
                f,
                "ApprovalResponse без quiz_ref недійсний (mandates.md, «Розширення ApprovalResponse»)"
            ),
            Self::QuizNotComplete => write!(
                f,
                "квіз не завершено (немає iterations/time_to_understanding_sec) — підпис неможливий"
            ),
            Self::DecisionRefMismatch { quiz_decision_ref, decision_ref } => write!(
                f,
                "quiz.decision_ref («{quiz_decision_ref}») не відповідає decision-request («{decision_ref}»)"
            ),
        }
    }
}

impl std::error::Error for ApprovalPreconditionError {}

/// Перевіряє переднапідписні умови — повертає помилку, якщо approval
/// писати не можна (mandates.md: «до людини не доходить run failed» — тут
/// навпаки, без квізу до git не доходить підпис).
pub fn validate_approval_preconditions(
    quiz: Option<&QuizCompletion>,
    quiz_ref: Option<&str>,
    decision_ref: &str,
) -> Result<(), ApprovalPreconditionError> {
    if quiz_ref.is_none() {
        return Err(ApprovalPreconditionError::MissingQuizRef);
    }
    if !quiz_is_complete(quiz) {
        return Err(ApprovalPreconditionError::QuizNotComplete);
    }
    let quiz = quiz.expect("quiz_is_complete(Some) гарантує Some");
    if quiz.decision_ref != decision_ref {
        return Err(ApprovalPreconditionError::DecisionRefMismatch {
            quiz_decision_ref: quiz.decision_ref.clone(),
            decision_ref: decision_ref.to_string(),
        });
    }
    Ok(())
}

/// Складає identity decision-request-а для `request_id` — власна
/// композиція `{runId}/{nnnn}` (approval.js: `buildRequestId`).
pub fn build_request_id(run_id: &str, nnnn: &str) -> String {
    format!("{run_id}/{nnnn}")
}

pub struct BuildApprovalParams<'a> {
    pub request_id: String,
    pub chosen_option: &'a str,
    pub quiz_ref: &'a str,
    pub quiz: &'a QuizCompletion,
    pub decision_ref: &'a str,
    pub private_key_jwk: &'a Value,
    pub public_key_base64: &'a str,
    /// Ін'єкція годинника для детермінованих тестів; `None` — `Utc::now()`.
    pub signed_at: Option<String>,
}

/// Будує й підписує `ApprovalResponse` — єдина функція, що перевіряє
/// інваріант «квіз завершено» ПЕРЕД підписом. Підписується канонікалізований
/// payload БЕЗ `pubkey`/`signature` (approval.js: `buildAndSignApproval`).
pub fn build_and_sign_approval(
    params: BuildApprovalParams<'_>,
) -> Result<Value, ApprovalPreconditionError> {
    validate_approval_preconditions(
        Some(params.quiz),
        Some(params.quiz_ref),
        params.decision_ref,
    )?;

    let signed_at = params
        .signed_at
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    let payload = json!({
        "schema_version": 1,
        "request_id": params.request_id,
        "approved": true,
        "chosen_option": params.chosen_option,
        "quiz_ref": params.quiz_ref,
        "signed_at": signed_at,
    });
    let signature = sign_payload(params.private_key_jwk, &payload)
        .expect("приватний ключ пристрою завжди сумісний з ed25519-dalek у Rust-стороні");

    let mut approval = payload;
    approval["pubkey"] = json!(params.public_key_base64);
    approval["signature"] = json!(signature);
    Ok(approval)
}

/// Перевіряє підписаний `ApprovalResponse` проти публічного ключа
/// (approval.js: `verifyApproval`) — round-trip перевірка того самого
/// канонічного payload, що підписувався (без `pubkey`/`signature`).
pub fn verify_approval(approval: &Value) -> bool {
    let Some(obj) = approval.as_object() else {
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

/// Серіалізує підписаний approval у канонічний JSON-текст файлу
/// (`NNNN-approval.json`) — читабельний pretty-print з кінцевим переносом
/// рядка (approval.js: `formatApprovalFile`; НЕ той самий канонічний рядок,
/// що бере участь у підписі — той лишається внутрішнім для
/// `sign_payload`/`verify_payload` через `canonicalize`).
pub fn format_approval_file(approval: &Value) -> String {
    let mut text =
        serde_json::to_string_pretty(approval).expect("Value серіалізується без помилок");
    text.push('\n');
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::signing::generate_device_keypair;

    fn completed_quiz() -> QuizCompletion {
        QuizCompletion {
            decision_ref: "0001-decision-request.md".into(),
            iterations: Some(1),
            time_to_understanding_sec: Some(47.0),
        }
    }

    fn incomplete_quiz() -> QuizCompletion {
        QuizCompletion {
            decision_ref: "0001-decision-request.md".into(),
            iterations: None,
            time_to_understanding_sec: None,
        }
    }

    #[test]
    fn quiz_is_complete_true_when_both_fields_present() {
        assert!(quiz_is_complete(Some(&completed_quiz())));
    }

    #[test]
    fn quiz_is_complete_false_when_missing_or_none() {
        assert!(!quiz_is_complete(Some(&incomplete_quiz())));
        assert!(!quiz_is_complete(None));
    }

    #[test]
    fn quiz_is_complete_false_when_iterations_zero() {
        let quiz = QuizCompletion {
            decision_ref: "x".into(),
            iterations: Some(0),
            time_to_understanding_sec: Some(5.0),
        };
        assert!(!quiz_is_complete(Some(&quiz)));
    }

    #[test]
    fn build_request_id_composes_run_id_and_nnnn() {
        assert_eq!(build_request_id("demo-1", "0001"), "demo-1/0001");
    }

    #[test]
    fn preconditions_without_quiz_ref_errors() {
        let err = validate_approval_preconditions(
            Some(&completed_quiz()),
            None,
            "0001-decision-request.md",
        )
        .unwrap_err();
        assert_eq!(err, ApprovalPreconditionError::MissingQuizRef);
    }

    #[test]
    fn preconditions_incomplete_quiz_errors() {
        let err = validate_approval_preconditions(
            Some(&incomplete_quiz()),
            Some("decisions/0001-quiz.md"),
            "0001-decision-request.md",
        )
        .unwrap_err();
        assert_eq!(err, ApprovalPreconditionError::QuizNotComplete);
    }

    #[test]
    fn preconditions_decision_ref_mismatch_errors() {
        let err = validate_approval_preconditions(
            Some(&completed_quiz()),
            Some("decisions/0001-quiz.md"),
            "0002-decision-request.md",
        )
        .unwrap_err();
        assert!(matches!(
            err,
            ApprovalPreconditionError::DecisionRefMismatch { .. }
        ));
    }

    #[test]
    fn preconditions_pass_when_all_consistent() {
        assert!(validate_approval_preconditions(
            Some(&completed_quiz()),
            Some("decisions/0001-quiz.md"),
            "0001-decision-request.md",
        )
        .is_ok());
    }

    #[test]
    fn build_and_sign_approval_returns_valid_shape() {
        let keypair = generate_device_keypair();
        let quiz = completed_quiz();
        let approval = build_and_sign_approval(BuildApprovalParams {
            request_id: "demo-1/0001".into(),
            chosen_option: "B",
            quiz_ref: "decisions/0001-quiz.md",
            quiz: &quiz,
            decision_ref: "0001-decision-request.md",
            private_key_jwk: &keypair.private_key_jwk,
            public_key_base64: &keypair.public_key_base64,
            signed_at: Some("2026-08-10T12:00:00.000Z".into()),
        })
        .expect("valid preconditions");
        assert_eq!(approval["schema_version"], 1);
        assert_eq!(approval["request_id"], "demo-1/0001");
        assert_eq!(approval["approved"], true);
        assert_eq!(approval["chosen_option"], "B");
        assert_eq!(approval["quiz_ref"], "decisions/0001-quiz.md");
        assert_eq!(approval["pubkey"], keypair.public_key_base64);
        assert!(approval["signature"].is_string());
    }

    #[test]
    fn signed_approval_passes_verify_approval() {
        let keypair = generate_device_keypair();
        let quiz = completed_quiz();
        let approval = build_and_sign_approval(BuildApprovalParams {
            request_id: "demo-1/0001".into(),
            chosen_option: "B",
            quiz_ref: "decisions/0001-quiz.md",
            quiz: &quiz,
            decision_ref: "0001-decision-request.md",
            private_key_jwk: &keypair.private_key_jwk,
            public_key_base64: &keypair.public_key_base64,
            signed_at: None,
        })
        .unwrap();
        assert!(verify_approval(&approval));
    }

    #[test]
    fn incomplete_quiz_errors_before_signing() {
        let keypair = generate_device_keypair();
        let quiz = incomplete_quiz();
        let err = build_and_sign_approval(BuildApprovalParams {
            request_id: "demo-1/0001".into(),
            chosen_option: "B",
            quiz_ref: "decisions/0001-quiz.md",
            quiz: &quiz,
            decision_ref: "0001-decision-request.md",
            private_key_jwk: &keypair.private_key_jwk,
            public_key_base64: &keypair.public_key_base64,
            signed_at: None,
        })
        .unwrap_err();
        assert_eq!(err, ApprovalPreconditionError::QuizNotComplete);
    }

    #[test]
    fn forged_approval_with_foreign_pubkey_fails_verify() {
        let legit = generate_device_keypair();
        let impostor = generate_device_keypair();
        let quiz = completed_quiz();
        let approval = build_and_sign_approval(BuildApprovalParams {
            request_id: "demo-1/0001".into(),
            chosen_option: "B",
            quiz_ref: "decisions/0001-quiz.md",
            quiz: &quiz,
            decision_ref: "0001-decision-request.md",
            private_key_jwk: &legit.private_key_jwk,
            public_key_base64: &legit.public_key_base64,
            signed_at: None,
        })
        .unwrap();
        let mut tampered = approval.clone();
        tampered["pubkey"] = json!(impostor.public_key_base64);
        assert!(!verify_approval(&tampered));
    }

    #[test]
    fn format_approval_file_pretty_prints_with_trailing_newline() {
        let text = format_approval_file(&json!({"schema_version": 1, "request_id": "demo-1/0001"}));
        assert!(text.ends_with('\n'));
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["schema_version"], 1);
        assert_eq!(parsed["request_id"], "demo-1/0001");
    }
}
