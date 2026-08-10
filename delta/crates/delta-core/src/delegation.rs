//! Черга відкладених дій + делегування одним квізом — порт
//! `delta/src/delegation.js` (M5). Квіз делегування — детермінований, БЕЗ
//! LLM (одне фіксоване мета-питання). `computed_owner` decision-request
//! НЕ переписується — `NNNN-delegation.json` пишеться ПОРУЧ, деривований
//! сигнал для `decisions::derive_queue`.

use mt_mandates::Mandate;
use serde_json::{json, Value};

use crate::approval::build_request_id;
use crate::decisions::{parse_decision_request, DecisionRequestMeta};
use crate::io::Io;
use crate::mandates::model_mandates;
use crate::quiz::{format_quiz_file, parse_quiz_file, QuestionAttempt, QuestionState, QuizDraft};
use crate::signing::{sign_payload, DeviceKeypair};

fn delegation_quiz_path(decisions_dir: &str, nnnn: &str) -> String {
    format!("{decisions_dir}/{nnnn}-delegation-quiz.md")
}

fn delegation_path(decisions_dir: &str, nnnn: &str) -> String {
    format!("{decisions_dir}/{nnnn}-delegation.json")
}

/// Модель з мандатом, чий scope покриває `decisionType`, серед моделей ПІД
/// відповідальністю `delegatorHandle` (`delegation.js: findEligibleModel`).
pub fn find_eligible_model<'a>(
    mandates: &'a [Mandate],
    decision_type: &str,
    delegator_handle: &str,
) -> Option<&'a Mandate> {
    model_mandates(mandates)
        .into_iter()
        .filter(|m| m.escalates_to.as_deref() == Some(delegator_handle))
        .find(|m| {
            m.scope
                .decision_types
                .iter()
                .any(|t| t == decision_type || t == "*")
        })
}

struct DelegationQuestion {
    question: String,
    options: Vec<String>,
    correct_index: usize,
}

fn build_delegation_question(
    dr: &crate::decisions::DecisionRequest,
    model_handle: &str,
) -> DelegationQuestion {
    let domain = dr
        .decision_type
        .clone()
        .unwrap_or_else(|| "general".to_string());
    let nnnn = dr.nnnn.clone().unwrap_or_default();
    let correct = format!("Модель {model_handle} отримає розвилку {nnnn} ({domain}) і вирішить її САМА в межах свого мандата — підпис на наслідковому рішенні лишиться за моделлю, не за тобою.");
    let distractors = vec![
        "Розвилку буде автоматично видалено без жодного рішення.".to_string(),
        format!("Модель {model_handle} лише запропонує варіант — підписантом і далі лишишся ти."),
    ];
    let mut options = vec![correct.clone()];
    options.extend(distractors);
    let rotation = nnnn.chars().count() % options.len();
    let mut rotated = options[rotation..].to_vec();
    rotated.extend_from_slice(&options[..rotation]);
    let correct_index = rotated.iter().position(|o| o == &correct).unwrap_or(0);
    DelegationQuestion {
        question: format!(
            "Що саме станеться, якщо делегувати розвилку {nnnn} моделі {model_handle}?"
        ),
        options: rotated,
        correct_index,
    }
}

/// Генерує (перший виклик) або показує (повторний) активне one-tap
/// мета-питання делегування — `delegation.js: delegationQuiz`.
pub async fn delegation_quiz(
    io: &dyn Io,
    decisions_dir: &str,
    nnnn: &str,
    model_handle: &str,
    decision_request_text: &str,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Value, String> {
    let path = delegation_quiz_path(decisions_dir, nnnn);
    if let Some(existing_text) = io.read_file(&path).await {
        let quiz = parse_quiz_file(&existing_text);
        let attempt = quiz.questions[0]
            .attempts
            .last()
            .ok_or("делегація-квіз без спроб")?;
        return Ok(
            json!({"quizPath": path, "question": attempt.question, "options": attempt.options, "iterations": quiz.iterations, "modelHandle": model_handle}),
        );
    }

    let dr = parse_decision_request(
        decision_request_text,
        DecisionRequestMeta {
            nnnn: Some(nnnn.to_string()),
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?;
    let generated = build_delegation_question(&dr, model_handle);
    let shown_at = now
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let attempt = QuestionAttempt {
        question: generated.question,
        options: generated.options.clone(),
        correct_answer: generated.options[generated.correct_index].clone(),
        microlesson: format!("Делегування — деривація, не мутація: computed_owner у decision-request НЕ переписується, черга моделі деривується з сусіднього {nnnn}-delegation.json (docs/specs/260809-delta-app.md, «Обсяг M5», п.5)."),
    };
    let draft = QuizDraft {
        decision_ref: format!("{nnnn}-decision-request.md"),
        depth: "one-tap".into(),
        generated_by: "delegation-quiz-deterministic".into(),
        shown_at: Some(shown_at),
        resolved_count: Some(0),
        iterations: 1,
        questions: vec![QuestionState {
            repetition: false,
            attempts: vec![attempt.clone()],
        }],
        ..Default::default()
    };
    io.write_file(&path, &format_quiz_file(&draft)).await;
    Ok(
        json!({"quizPath": path, "question": attempt.question, "options": attempt.options, "iterations": 1, "modelHandle": model_handle}),
    )
}

/// Проводить спробу one-tap мета-квізу делегування — «фейл ≠ покарання»
/// (`delegation.js: submitDelegationAnswer`).
pub async fn submit_delegation_answer(
    io: &dyn Io,
    decisions_dir: &str,
    nnnn: &str,
    answer: crate::decision_flow::Answer<'_>,
) -> Result<Value, String> {
    let path = delegation_quiz_path(decisions_dir, nnnn);
    let existing_text = io.read_file(&path).await.ok_or_else(|| {
        format!("квіз делегування для {nnnn} ще не згенеровано — виклич delegation_quiz спершу")
    })?;

    let quiz = parse_quiz_file(&existing_text);
    let attempt = quiz.questions[0]
        .attempts
        .last()
        .ok_or("делегація-квіз без спроб")?
        .clone();
    let answer_index = match answer {
        crate::decision_flow::Answer::Index(n) => n,
        crate::decision_flow::Answer::Text(s) => attempt
            .options
            .iter()
            .position(|o| o == s)
            .map(|i| i as i64)
            .unwrap_or(-1),
    };
    let correct_index = attempt
        .options
        .iter()
        .position(|o| o == &attempt.correct_answer)
        .map(|i| i as i64)
        .unwrap_or(-1);
    let correct = answer_index != -1 && answer_index == correct_index;

    if !correct {
        let mut attempts = quiz.questions[0].attempts.clone();
        attempts.push(attempt);
        let iterations = quiz.iterations.unwrap_or(0) + 1;
        let draft = QuizDraft {
            decision_ref: quiz.decision_ref.clone().unwrap_or_default(),
            depth: quiz.depth.clone().unwrap_or_default(),
            generated_by: quiz.generated_by.clone().unwrap_or_default(),
            shown_at: quiz.shown_at.clone(),
            resolved_count: Some(0),
            iterations,
            questions: vec![QuestionState {
                repetition: false,
                attempts,
            }],
            ..Default::default()
        };
        io.write_file(&path, &format_quiz_file(&draft)).await;
        return Ok(json!({"correct": false, "iterations": iterations}));
    }

    Ok(
        json!({"correct": true, "iterations": quiz.iterations, "quizRef": format!("decisions/{nnnn}-delegation-quiz.md")}),
    )
}

/// Будує й підписує делегація-запис — `{delegated_to, delegated_by,
/// signed_at, pubkey, signature, quiz_ref}` (`delegation.js:
/// buildAndSignDelegation`).
pub fn build_and_sign_delegation(
    request_id: &str,
    decision_ref: &str,
    delegated_to: &str,
    delegated_by: &str,
    quiz_ref: Option<&str>,
    device_key: &DeviceKeypair,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Value {
    let signed_at = now
        .unwrap_or_else(chrono::Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let payload = json!({
        "schema_version": 1, "request_id": request_id, "decision_ref": decision_ref,
        "delegated_to": delegated_to, "delegated_by": delegated_by, "quiz_ref": quiz_ref, "signed_at": signed_at,
    });
    let signature = sign_payload(&device_key.private_key_jwk, &payload)
        .expect("приватний ключ пристрою завжди сумісний з ed25519-dalek у Rust-стороні");
    let mut record = payload;
    record["pubkey"] = json!(device_key.public_key_base64);
    record["signature"] = json!(signature);
    record
}

pub fn format_delegation_file(record: &Value) -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(record).expect("Value серіалізується без помилок")
    )
}

/// Повний потік `decision_delegate`: проводить one-tap мета-квіз, і лише
/// коли здано правильно — підписує й пише `NNNN-delegation.json`
/// (`delegation.js: delegateDecision`).
#[allow(clippy::too_many_arguments)]
pub async fn delegate_decision(
    io: &dyn Io,
    decisions_dir: &str,
    run_id: &str,
    nnnn: &str,
    model_handle: &str,
    delegated_by_handle: &str,
    answer: crate::decision_flow::Answer<'_>,
    device_key: &DeviceKeypair,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Value, String> {
    if io
        .read_file(&format!("{decisions_dir}/{nnnn}-approval.json"))
        .await
        .is_some()
    {
        return Err(format!(
            "decision {nnnn}: рішення вже закрите підписаним approval — делегувати нікуди"
        ));
    }
    if io
        .read_file(&delegation_path(decisions_dir, nnnn))
        .await
        .is_some()
    {
        return Err(format!(
            "decision {nnnn}: уже делеговано — повторне делегування недоступне"
        ));
    }

    let result = submit_delegation_answer(io, decisions_dir, nnnn, answer).await?;
    if result["correct"] != json!(true) {
        return Ok(
            json!({"delegated": false, "correct": false, "iterations": result["iterations"]}),
        );
    }

    let request_id = build_request_id(run_id, nnnn);
    let decision_ref = format!("{nnnn}-decision-request.md");
    let record = build_and_sign_delegation(
        &request_id,
        &decision_ref,
        model_handle,
        delegated_by_handle,
        result["quizRef"].as_str(),
        device_key,
        now,
    );
    let path = delegation_path(decisions_dir, nnnn);
    io.write_file(&path, &format_delegation_file(&record)).await;
    Ok(
        json!({"delegated": true, "correct": true, "iterations": result["iterations"], "delegation": record, "delegationPath": path}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decision_flow::Answer;
    use crate::io::MemoryIo;
    use crate::signing::{generate_device_keypair, verify_payload, PublicKeySource};
    use mt_mandates::{MandateKind, Scope, Thresholds};

    const DR_OPS_TEXT: &str =
        include_str!("../tests/fixtures/runs/demo-1/decisions/0004-decision-request.md");
    const DECISIONS_DIR: &str = "/root/runs/demo-1/decisions";

    fn mandates_fixture() -> Vec<Mandate> {
        vec![
            Mandate {
                owner: "fable-5".into(),
                kind: MandateKind::Model,
                scope: Scope {
                    refs: vec!["refs/mt/tasks/routine/**".into()],
                    decision_types: vec!["ops".into()],
                },
                thresholds: Thresholds::default(),
                escalates_to: Some("olena".into()),
            },
            Mandate {
                owner: "olena".into(),
                kind: MandateKind::Person,
                scope: Scope {
                    refs: vec!["refs/mt/tasks/design/**".into()],
                    decision_types: vec!["architecture".into()],
                },
                thresholds: Thresholds::default(),
                escalates_to: Some("vitalii".into()),
            },
        ]
    }

    #[test]
    fn find_eligible_model_matches_scope_and_delegator() {
        let mandates = mandates_fixture();
        let model = find_eligible_model(&mandates, "ops", "olena");
        assert_eq!(model.map(|m| m.owner.as_str()), Some("fable-5"));
    }

    #[test]
    fn find_eligible_model_no_coverage_is_none() {
        let mandates = mandates_fixture();
        assert!(find_eligible_model(&mandates, "architecture", "olena").is_none());
    }

    #[test]
    fn find_eligible_model_other_delegator_is_none() {
        let mandates = mandates_fixture();
        assert!(find_eligible_model(&mandates, "ops", "vitalii").is_none());
    }

    #[test]
    fn build_and_sign_delegation_canonical_payload_verifies() {
        let key = generate_device_keypair();
        let now = chrono::DateTime::parse_from_rfc3339("2026-08-09T10:00:00.000Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let record = build_and_sign_delegation(
            "demo-1/0004",
            "0004-decision-request.md",
            "fable-5",
            "olena",
            Some("decisions/0004-delegation-quiz.md"),
            &key,
            Some(now),
        );
        assert_eq!(record["delegated_to"], "fable-5");
        assert_eq!(record["delegated_by"], "olena");
        assert_eq!(record["quiz_ref"], "decisions/0004-delegation-quiz.md");
        assert_eq!(record["signed_at"], "2026-08-09T10:00:00.000Z");
        assert_eq!(record["pubkey"], key.public_key_base64.clone());

        let mut payload = record.clone();
        let pubkey = payload["pubkey"].as_str().unwrap().to_string();
        let signature = payload["signature"].as_str().unwrap().to_string();
        payload.as_object_mut().unwrap().remove("pubkey");
        payload.as_object_mut().unwrap().remove("signature");
        assert!(verify_payload(
            PublicKeySource::Base64(&pubkey),
            &payload,
            &signature
        ));
    }

    #[tokio::test]
    async fn delegation_quiz_first_call_writes_one_tap_file() {
        let io = MemoryIo::default();
        let result = delegation_quiz(&io, DECISIONS_DIR, "0004", "fable-5", DR_OPS_TEXT, None)
            .await
            .unwrap();
        assert_eq!(result["options"].as_array().unwrap().len(), 3);
        assert!(io
            .get(&format!("{DECISIONS_DIR}/0004-delegation-quiz.md"))
            .unwrap()
            .contains("depth: one-tap"));
    }

    #[tokio::test]
    async fn delegation_quiz_repeat_call_same_question() {
        let io = MemoryIo::default();
        let first = delegation_quiz(&io, DECISIONS_DIR, "0004", "fable-5", DR_OPS_TEXT, None)
            .await
            .unwrap();
        let second = delegation_quiz(&io, DECISIONS_DIR, "0004", "fable-5", DR_OPS_TEXT, None)
            .await
            .unwrap();
        assert_eq!(second["question"], first["question"]);
        assert_eq!(second["options"], first["options"]);
    }

    async fn options_and_correct(io: &MemoryIo) -> (Vec<String>, String) {
        let text = io
            .get(&format!("{DECISIONS_DIR}/0004-delegation-quiz.md"))
            .unwrap();
        let parsed = parse_quiz_file(&text);
        let attempt = parsed.questions[0].attempts.last().unwrap().clone();
        (attempt.options, attempt.correct_answer)
    }

    #[tokio::test]
    async fn wrong_answer_increments_iterations() {
        let io = MemoryIo::default();
        delegation_quiz(&io, DECISIONS_DIR, "0004", "fable-5", DR_OPS_TEXT, None)
            .await
            .unwrap();
        let (options, correct) = options_and_correct(&io).await;
        let wrong_index = options.iter().position(|o| o != &correct).unwrap() as i64;
        let result =
            submit_delegation_answer(&io, DECISIONS_DIR, "0004", Answer::Index(wrong_index))
                .await
                .unwrap();
        assert_eq!(result["correct"], false);
        assert_eq!(result["iterations"], 2);
    }

    #[tokio::test]
    async fn submit_without_generated_quiz_errors() {
        let io = MemoryIo::default();
        let err = submit_delegation_answer(&io, DECISIONS_DIR, "0004", Answer::Index(0))
            .await
            .unwrap_err();
        assert!(err.contains("ще не згенеровано"));
    }

    #[tokio::test]
    async fn delegate_decision_correct_answer_writes_signed_delegation_without_mutating_request() {
        let io = MemoryIo::new([(
            format!("{DECISIONS_DIR}/0004-decision-request.md"),
            DR_OPS_TEXT.to_string(),
        )]);
        delegation_quiz(&io, DECISIONS_DIR, "0004", "fable-5", DR_OPS_TEXT, None)
            .await
            .unwrap();
        let (_, correct) = options_and_correct(&io).await;
        let key = generate_device_keypair();
        let result = delegate_decision(
            &io,
            DECISIONS_DIR,
            "demo-1",
            "0004",
            "fable-5",
            "olena",
            Answer::Text(&correct),
            &key,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result["delegated"], true);
        assert_eq!(result["delegation"]["delegated_to"], "fable-5");
        assert_eq!(
            io.get(&format!("{DECISIONS_DIR}/0004-decision-request.md"))
                .unwrap(),
            DR_OPS_TEXT
        );
    }

    #[tokio::test]
    async fn deriving_queue_moves_card_from_delegator_to_model() {
        let io = MemoryIo::new([(
            format!("{DECISIONS_DIR}/0004-decision-request.md"),
            DR_OPS_TEXT.to_string(),
        )]);
        delegation_quiz(&io, DECISIONS_DIR, "0004", "fable-5", DR_OPS_TEXT, None)
            .await
            .unwrap();
        let (_, correct) = options_and_correct(&io).await;
        let key = generate_device_keypair();
        delegate_decision(
            &io,
            DECISIONS_DIR,
            "demo-1",
            "0004",
            "fable-5",
            "olena",
            Answer::Text(&correct),
            &key,
            None,
        )
        .await
        .unwrap();

        let dirs = vec![crate::decisions::DecisionsDir {
            dir: DECISIONS_DIR.to_string(),
            files: vec![
                (
                    "0004-decision-request.md".into(),
                    io.get(&format!("{DECISIONS_DIR}/0004-decision-request.md"))
                        .unwrap(),
                ),
                (
                    "0004-delegation.json".into(),
                    io.get(&format!("{DECISIONS_DIR}/0004-delegation.json"))
                        .unwrap(),
                ),
            ],
        }];
        assert!(crate::decisions::derive_queue(&dirs, Some("olena"), None).is_empty());
        let queue = crate::decisions::derive_queue(&dirs, Some("fable-5"), None);
        assert_eq!(queue[0].request.nnnn.as_deref(), Some("0004"));
        assert_eq!(queue[0].delegated_to.as_deref(), Some("fable-5"));
        assert_eq!(queue[0].delegated_by.as_deref(), Some("olena"));
    }

    #[tokio::test]
    async fn already_delegated_errors() {
        let io = MemoryIo::new([
            (
                format!("{DECISIONS_DIR}/0004-decision-request.md"),
                DR_OPS_TEXT.to_string(),
            ),
            (
                format!("{DECISIONS_DIR}/0004-delegation.json"),
                format_delegation_file(&json!({"delegated_to": "fable-5"})),
            ),
        ]);
        let key = generate_device_keypair();
        let err = delegate_decision(
            &io,
            DECISIONS_DIR,
            "demo-1",
            "0004",
            "fable-5",
            "olena",
            Answer::Index(0),
            &key,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("уже делеговано"));
    }

    #[tokio::test]
    async fn already_closed_errors() {
        let io = MemoryIo::new([
            (
                format!("{DECISIONS_DIR}/0004-decision-request.md"),
                DR_OPS_TEXT.to_string(),
            ),
            (
                format!("{DECISIONS_DIR}/0004-approval.json"),
                r#"{"approved":true}"#.to_string(),
            ),
        ]);
        let key = generate_device_keypair();
        let err = delegate_decision(
            &io,
            DECISIONS_DIR,
            "demo-1",
            "0004",
            "fable-5",
            "olena",
            Answer::Index(0),
            &key,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("вже закрите"));
    }
}
