//! Оркестрація квіз-гейта: generate → answer (fail ≠ покарання, шар за
//! шаром розгортання контексту, iterations++) → sign — порт
//! `delta/src/decision-flow.js`. Транспорт-незалежна: приймає `&dyn Io`
//! (`decisions/`) і `&dyn KnowledgeIo` (`knowledge.json`) — той самий
//! інваріант, що CLI/GUI поверхні M0/M1: сирі байти читає/пише транспорт,
//! уся логіка — тут, спільна для обох.
//!
//! **Форма виходу — `serde_json::Value`, не строго типізовані структури.**
//! Архітектурне рішення фази A (не буквальний порт): JS-оригінал повертає
//! ФОРМУ, що різниться за `depth`/`correct`/`done` (union-подібні обʼєкти —
//! природно для JS, незручно для Rust enum без втрати відповідності
//! JSON-контракту, який CLI/Tauri зрештою серіалізує назад у той самий
//! envelope). Внутрішня логіка (io-виклики, генерація квізу через
//! `crate::quiz`, підпис через `crate::approval`, база знань через
//! `crate::knowledge`) лишається строго типізованою — лише зовнішня форма
//! результату tool-виклику будується як `Value`, дзеркалячи JS-об'єкт
//! поле-в-поле.

use serde_json::{json, Value};

use crate::approval::{
    build_and_sign_approval, build_request_id, BuildApprovalParams, QuizCompletion,
};
use crate::decisions::{
    depth_for_facets, parse_decision_request, DecisionRequest, DecisionRequestMeta,
};
use crate::io::{Io, KnowledgeIo};
use crate::knowledge::{
    append_knowledge_entry, due_repetition, format_knowledge_file, parse_knowledge_file,
    record_repetition_answer, CompletedQuiz,
};
use crate::quiz::{
    format_quiz_file, format_teach_back_file, generate_quiz, generate_standard_quiz,
    parse_quiz_file, parse_teach_back_file, rephrase_question, teach_back_prompt_text,
    GeneratedQuestion, LlmConfig, QuestionAttempt, QuestionState, QuizDraft, TeachBackDraft,
    TEACHBACK_UNAVAILABLE_MESSAGE,
};
use crate::signing::DeviceKeypair;

const SUPPORTED_DEPTHS: [&str; 3] = ["one-tap", "standard", "teach-back"];
const REPETITION_ELIGIBLE_DEPTHS: [&str; 1] = ["one-tap"];

fn decision_request_path(decisions_dir: &str, nnnn: &str) -> String {
    format!("{decisions_dir}/{nnnn}-decision-request.md")
}
fn quiz_path(decisions_dir: &str, nnnn: &str) -> String {
    format!("{decisions_dir}/{nnnn}-quiz.md")
}
fn approval_path(decisions_dir: &str, nnnn: &str) -> String {
    format!("{decisions_dir}/{nnnn}-approval.json")
}

/// Кидає, якщо `nnnn` уже закритий підписаним `NNNN-approval.json` —
/// підписаний `ApprovalResponse` термінальний, жодна дія після нього не
/// пише файли (`decision-flow.js: assertDecisionOpen`).
async fn assert_decision_open(io: &dyn Io, decisions_dir: &str, nnnn: &str) -> Result<(), String> {
    if io
        .read_file(&approval_path(decisions_dir, nnnn))
        .await
        .is_some()
    {
        return Err(format!(
            "decision {nnnn}: рішення вже закрите підписаним approval — квіз більше не мутується (mandates.md: підписаний ApprovalResponse — термінальний акт)"
        ));
    }
    Ok(())
}

async fn load_supported_decision_request(
    io: &dyn Io,
    decisions_dir: &str,
    nnnn: &str,
) -> Result<(DecisionRequest, String), String> {
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
    let depth = depth_for_facets(&dr.leverage_facets).to_string();
    if !SUPPORTED_DEPTHS.contains(&depth.as_str()) {
        return Err(format!(
            "decision {nnnn}: глибина «{depth}» ще не реалізована (лише one-tap/standard/teach-back)"
        ));
    }
    Ok((dr, depth))
}

fn domain_of(dr: &DecisionRequest) -> String {
    dr.decision_type
        .clone()
        .unwrap_or_else(|| "general".to_string())
}

fn layered_explain(dr: &DecisionRequest, fail_number: u64) -> Vec<Value> {
    let max_layer = fail_number.min(3);
    let mut layers = Vec::new();
    if max_layer >= 1 {
        layers.push(json!({"layer": 1, "heading": "Контекст", "content": dr.context}));
    }
    if max_layer >= 2 {
        let content = dr
            .options
            .iter()
            .map(|o| format!("{}. {}\n{}", o.label, o.title, o.body))
            .collect::<Vec<_>>()
            .join("\n\n");
        layers.push(json!({"layer": 2, "heading": "Наслідки варіантів", "content": content}));
    }
    if max_layer >= 3 {
        layers.push(
            json!({"layer": 3, "heading": "Рекомендація агента", "content": dr.recommendation}),
        );
    }
    layers
}

fn to_question_state(generated: &GeneratedQuestion, repetition: bool) -> QuestionState {
    QuestionState {
        repetition,
        attempts: vec![QuestionAttempt {
            question: generated.question.clone(),
            options: generated.options.clone(),
            correct_answer: generated.options[generated.correct_index].clone(),
            microlesson: generated.microlesson.clone(),
        }],
    }
}

fn now_iso(now: Option<chrono::DateTime<chrono::Utc>>) -> String {
    now.unwrap_or_else(chrono::Utc::now)
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

async fn decision_quiz_teach_back(
    io: &dyn Io,
    path: &str,
    nnnn: &str,
    domain: &str,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Value {
    if let Some(existing_text) = io.read_file(path).await {
        let state = parse_teach_back_file(&existing_text);
        let last_attempt = state.attempts.last();
        let failed = last_attempt.is_some_and(|a| a.evaluation.understood == Some(false));
        return json!({
            "quizPath": path,
            "depth": "teach-back",
            "prompt": teach_back_prompt_text(),
            "iterations": state.iterations,
            "generatedBy": state.generated_by,
            "domain": domain,
            "lastFeedback": if failed { last_attempt.map(|a| a.evaluation.feedback.clone()) } else { None::<String> },
            "missingAspects": if failed { last_attempt.map(|a| a.evaluation.missing_aspects.clone()).unwrap_or_default() } else { Vec::<String>::new() },
        });
    }

    let shown_at = now_iso(now);
    let draft = TeachBackDraft {
        decision_ref: format!("{nnnn}-decision-request.md"),
        generated_by: "teach-back-prompt".to_string(),
        shown_at: Some(shown_at),
        iterations: 0,
        attempts: vec![],
        time_to_understanding_sec: None,
    };
    io.write_file(path, &format_teach_back_file(&draft)).await;
    json!({
        "quizPath": path,
        "depth": "teach-back",
        "prompt": teach_back_prompt_text(),
        "iterations": 0,
        "generatedBy": "teach-back-prompt",
        "domain": domain,
        "lastFeedback": Value::Null,
        "missingAspects": Vec::<String>::new(),
    })
}

/// Генерує (перший виклик) або показує (повторний) активне питання квізу
/// (`decision-flow.js: decisionQuiz`).
#[allow(clippy::too_many_arguments)]
pub async fn decision_quiz(
    io: &dyn Io,
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    decisions_dir: &str,
    nnnn: &str,
    chosen_option: &str,
    knowledge_io: Option<&dyn KnowledgeIo>,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Value, String> {
    assert_decision_open(io, decisions_dir, nnnn).await?;
    let (dr, depth) = load_supported_decision_request(io, decisions_dir, nnnn).await?;
    let domain = domain_of(&dr);
    let path = quiz_path(decisions_dir, nnnn);
    if depth == "teach-back" {
        return Ok(decision_quiz_teach_back(io, &path, nnnn, &domain, now).await);
    }

    if let Some(existing_text) = io.read_file(&path).await {
        let quiz = parse_quiz_file(&existing_text);
        let resolved_count = quiz.resolved_count.unwrap_or(0) as usize;
        let active_question = quiz
            .questions
            .get(resolved_count)
            .or_else(|| quiz.questions.last())
            .ok_or("квіз-файл без питань")?;
        let active_attempt = active_question
            .attempts
            .last()
            .ok_or("питання квізу без жодної спроби")?;
        let question_index = quiz
            .questions
            .iter()
            .position(|q| std::ptr::eq(q, active_question))
            .unwrap_or(0)
            + 1;
        return Ok(json!({
            "quizPath": path,
            "question": active_attempt.question,
            "options": active_attempt.options,
            "depth": quiz.depth,
            "iterations": quiz.iterations,
            "generatedBy": quiz.generated_by,
            "questionIndex": question_index,
            "questionCount": quiz.questions.len(),
            "repetition": active_question.repetition,
            "domain": domain,
        }));
    }

    let shown_at = now_iso(now);
    let (generated_by, mut questions): (String, Vec<QuestionState>) = if depth == "standard" {
        let generated = generate_standard_quiz(client, llm_config, &dr, chosen_option).await?;
        (
            generated.generated_by,
            generated
                .questions
                .iter()
                .map(|q| to_question_state(q, false))
                .collect(),
        )
    } else {
        let generated = generate_quiz(client, llm_config, &dr, chosen_option).await?;
        (
            generated.generated_by,
            vec![to_question_state(&generated.question, false)],
        )
    };

    let mut repetition_source: Option<String> = None;
    if REPETITION_ELIGIBLE_DEPTHS.contains(&depth.as_str()) {
        if let Some(kio) = knowledge_io {
            let entries = parse_knowledge_file(kio.read().await.as_deref());
            let now_date = now.unwrap_or_else(chrono::Utc::now);
            if let Some(due) = due_repetition(&entries, &domain, now_date) {
                questions.push(QuestionState {
                    repetition: true,
                    attempts: vec![QuestionAttempt {
                        question: due.question.clone(),
                        options: due.options.clone().unwrap_or_default(),
                        correct_answer: due.correct_answer.clone().unwrap_or_default(),
                        microlesson: due.microlesson.clone(),
                    }],
                });
                repetition_source = Some(due.id.clone());
            }
        }
    }

    let iterations: u64 = questions.iter().map(|q| q.attempts.len() as u64).sum();
    let draft = QuizDraft {
        decision_ref: format!("{nnnn}-decision-request.md"),
        depth: depth.clone(),
        generated_by: generated_by.clone(),
        iterations,
        shown_at: Some(shown_at),
        resolved_count: Some(0),
        repetition_source,
        questions,
        time_to_understanding_sec: None,
    };
    io.write_file(&path, &format_quiz_file(&draft)).await;
    let active_attempt = &draft.questions[0].attempts[0];
    Ok(json!({
        "quizPath": path,
        "question": active_attempt.question,
        "options": active_attempt.options,
        "depth": depth,
        "iterations": draft.iterations,
        "generatedBy": generated_by,
        "questionIndex": 1,
        "questionCount": draft.questions.len(),
        "repetition": false,
        "domain": domain,
    }))
}

#[allow(clippy::too_many_arguments)]
async fn submit_teach_back(
    io: &dyn Io,
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    path: &str,
    dr: &DecisionRequest,
    chosen_option: &str,
    transcript: Option<&str>,
    knowledge_io: Option<&dyn KnowledgeIo>,
    now: Option<chrono::DateTime<chrono::Utc>>,
    existing_text: &str,
) -> Result<Value, String> {
    let transcript = transcript
        .filter(|t| !t.trim().is_empty())
        .ok_or_else(|| "teach-back: потрібен непорожній transcript (переказ своїми словами) — decision_approve з полем transcript".to_string())?;

    let domain = domain_of(dr);
    let state = parse_teach_back_file(existing_text);
    let evaluation = crate::quiz::call_llm_teach_back_evaluator(
        client,
        llm_config,
        dr,
        chosen_option,
        transcript,
    )
    .await;
    let Some(evaluation) = evaluation else {
        return Ok(
            json!({"correct": false, "done": false, "available": false, "iterations": state.iterations, "message": TEACHBACK_UNAVAILABLE_MESSAGE, "domain": domain}),
        );
    };

    let mut attempts = state.attempts.clone();
    attempts.push(crate::quiz::TeachBackAttempt {
        transcript: transcript.to_string(),
        evaluation: crate::quiz::TeachBackEvalRecord {
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
        io.write_file(path, &format_teach_back_file(&draft)).await;
        return Ok(json!({
            "correct": false, "done": false, "available": true, "iterations": iterations,
            "feedback": evaluation.feedback, "missingAspects": evaluation.missing_aspects,
            "explain": layered_explain(dr, iterations), "domain": domain,
        }));
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
    io.write_file(path, &format_teach_back_file(&final_state))
        .await;

    if let Some(kio) = knowledge_io {
        let base_entries = parse_knowledge_file(kio.read().await.as_deref());
        let with_new = append_knowledge_entry(
            &base_entries,
            CompletedQuiz {
                decision_ref: &state.decision_ref,
                domain: Some(&domain),
                question: "teach-back: переказ рішення власними словами",
                options: None,
                correct_answer: None,
                microlesson: &evaluation.feedback,
                iterations,
                time_to_understanding_sec,
                completed_at: &now_date.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            },
        );
        kio.write(&format_knowledge_file(&with_new)).await;
    }

    Ok(
        json!({"correct": true, "done": true, "available": true, "iterations": iterations, "feedback": evaluation.feedback, "domain": domain}),
    )
}

/// Обране (0-based індекс, або точний текст) — той самий вхід, що JS
/// `answer: number|string`.
pub enum Answer<'a> {
    Index(i64),
    Text(&'a str),
}

fn answer_index(answer: &Answer<'_>, options: &[String]) -> i64 {
    match answer {
        Answer::Index(i) => *i,
        Answer::Text(t) => options
            .iter()
            .position(|o| o == t)
            .map(|i| i as i64)
            .unwrap_or(-1),
    }
}

/// Проводить квіз-відповідь на активне питання — `decision-flow.js:
/// submitQuizAnswer`.
#[allow(clippy::too_many_arguments)]
pub async fn submit_quiz_answer(
    io: &dyn Io,
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    decisions_dir: &str,
    nnnn: &str,
    answer: Option<Answer<'_>>,
    transcript: Option<&str>,
    chosen_option: Option<&str>,
    knowledge_io: Option<&dyn KnowledgeIo>,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Value, String> {
    assert_decision_open(io, decisions_dir, nnnn).await?;
    let path = quiz_path(decisions_dir, nnnn);
    let existing_text = io.read_file(&path).await.ok_or_else(|| {
        format!("квіз для {nnnn} ще не згенеровано — виклич decision_quiz спершу")
    })?;

    let (dr, depth) = load_supported_decision_request(io, decisions_dir, nnnn).await?;
    if depth == "teach-back" {
        return submit_teach_back(
            io,
            client,
            llm_config,
            &path,
            &dr,
            chosen_option.unwrap_or(""),
            transcript,
            knowledge_io,
            now,
            &existing_text,
        )
        .await;
    }

    let quiz = parse_quiz_file(&existing_text);
    let domain = domain_of(&dr);
    let resolved_count = quiz.resolved_count.unwrap_or(0) as usize;
    let mut questions = quiz.questions.clone();
    let active_question = questions
        .get(resolved_count)
        .cloned()
        .ok_or("активне питання поза межами квізу")?;
    let last_attempt = active_question
        .attempts
        .last()
        .cloned()
        .ok_or("питання без спроб")?;
    let answer = answer.ok_or("submitQuizAnswer: потрібне поле answer (індекс або текст)")?;
    let answer_idx = answer_index(&answer, &last_attempt.options);
    let correct_index = last_attempt
        .options
        .iter()
        .position(|o| o == &last_attempt.correct_answer)
        .map(|i| i as i64)
        .unwrap_or(-1);
    let correct = answer_idx != -1 && answer_idx == correct_index;
    let total_attempts_so_far: u64 = questions.iter().map(|q| q.attempts.len() as u64).sum();

    if !correct {
        let fail_number = active_question.attempts.len() as u64;
        let mut question_text = last_attempt.question.clone();
        if !active_question.repetition {
            if let Some(chosen) = chosen_option {
                if let Some(rephrased) =
                    rephrase_question(client, llm_config, &dr, chosen, &last_attempt.question).await
                {
                    question_text = rephrased;
                }
            }
        }
        questions[resolved_count].attempts.push(QuestionAttempt {
            question: question_text,
            options: last_attempt.options.clone(),
            correct_answer: last_attempt.correct_answer.clone(),
            microlesson: last_attempt.microlesson.clone(),
        });
        let draft = QuizDraft {
            decision_ref: quiz.decision_ref.clone().unwrap_or_default(),
            depth: quiz.depth.clone().unwrap_or_default(),
            generated_by: quiz.generated_by.clone().unwrap_or_default(),
            shown_at: quiz.shown_at.clone(),
            repetition_source: quiz.repetition_source.clone(),
            resolved_count: Some(resolved_count as u64),
            iterations: total_attempts_so_far + 1,
            questions: questions.clone(),
            time_to_understanding_sec: None,
        };
        io.write_file(&path, &format_quiz_file(&draft)).await;
        return Ok(json!({
            "correct": false, "done": false, "iterations": draft.iterations, "microlesson": last_attempt.microlesson,
            "explain": if active_question.repetition { Value::Null } else { Value::Array(layered_explain(&dr, fail_number)) },
            "domain": domain, "questionIndex": resolved_count + 1, "questionCount": questions.len(), "repetition": active_question.repetition,
        }));
    }

    let now_date = now.unwrap_or_else(chrono::Utc::now);
    if active_question.repetition {
        if let (Some(kio), Some(src)) = (knowledge_io, quiz.repetition_source.as_deref()) {
            let entries = parse_knowledge_file(kio.read().await.as_deref());
            let updated = record_repetition_answer(&entries, src, true, now_date);
            kio.write(&format_knowledge_file(&updated)).await;
        }
    }

    let new_resolved_count = resolved_count + 1;
    if new_resolved_count < questions.len() {
        let draft = QuizDraft {
            decision_ref: quiz.decision_ref.clone().unwrap_or_default(),
            depth: quiz.depth.clone().unwrap_or_default(),
            generated_by: quiz.generated_by.clone().unwrap_or_default(),
            shown_at: quiz.shown_at.clone(),
            repetition_source: quiz.repetition_source.clone(),
            resolved_count: Some(new_resolved_count as u64),
            iterations: total_attempts_so_far,
            questions: questions.clone(),
            time_to_understanding_sec: None,
        };
        io.write_file(&path, &format_quiz_file(&draft)).await;
        let next_question = &questions[new_resolved_count];
        let next_attempt = next_question.attempts.last().unwrap();
        return Ok(json!({
            "correct": true, "done": false, "iterations": draft.iterations, "microlesson": last_attempt.microlesson, "domain": domain,
            "nextQuestion": {"question": next_attempt.question, "options": next_attempt.options, "questionIndex": new_resolved_count + 1, "questionCount": questions.len(), "repetition": next_question.repetition},
        }));
    }

    let shown_at_ms = quiz
        .shown_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
        .unwrap_or_else(|| now_date.timestamp_millis());
    let time_to_understanding_sec = ((now_date.timestamp_millis() - shown_at_ms) as f64 / 1000.0)
        .round()
        .max(0.0);
    let final_quiz = QuizDraft {
        decision_ref: quiz.decision_ref.clone().unwrap_or_default(),
        depth: quiz.depth.clone().unwrap_or_default(),
        generated_by: quiz.generated_by.clone().unwrap_or_default(),
        iterations: total_attempts_so_far,
        time_to_understanding_sec: Some(time_to_understanding_sec),
        shown_at: None,
        repetition_source: None,
        resolved_count: None,
        questions: questions.clone(),
    };
    io.write_file(&path, &format_quiz_file(&final_quiz)).await;

    let primary_attempt = questions[0].attempts.last().unwrap().clone();
    if let Some(kio) = knowledge_io {
        let base_entries = parse_knowledge_file(kio.read().await.as_deref());
        let with_new = append_knowledge_entry(
            &base_entries,
            CompletedQuiz {
                decision_ref: &final_quiz.decision_ref,
                domain: Some(&domain),
                question: &primary_attempt.question,
                options: Some(primary_attempt.options.clone()),
                correct_answer: Some(primary_attempt.correct_answer.clone()),
                microlesson: &primary_attempt.microlesson,
                iterations: final_quiz.iterations,
                time_to_understanding_sec,
                completed_at: &now_date.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            },
        );
        kio.write(&format_knowledge_file(&with_new)).await;
    }

    Ok(json!({
        "correct": true, "done": true, "iterations": final_quiz.iterations,
        "quizDecisionRef": final_quiz.decision_ref, "quizIterations": final_quiz.iterations, "quizTimeToUnderstandingSec": time_to_understanding_sec,
        "microlesson": last_attempt.microlesson, "domain": domain,
    }))
}

/// Повний потік `decision_approve`: проводить квіз-відповідь, підписує
/// лише коли ВСІ питання здано правильно — `decision-flow.js:
/// decisionApprove`.
#[allow(clippy::too_many_arguments)]
pub async fn decision_approve(
    io: &dyn Io,
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    decisions_dir: &str,
    run_id: &str,
    nnnn: &str,
    chosen_option: &str,
    answer: Option<Answer<'_>>,
    transcript: Option<&str>,
    device_key: &DeviceKeypair,
    knowledge_io: Option<&dyn KnowledgeIo>,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Value, String> {
    let result = submit_quiz_answer(
        io,
        client,
        llm_config,
        decisions_dir,
        nnnn,
        answer,
        transcript,
        Some(chosen_option),
        knowledge_io,
        now,
    )
    .await?;

    if result["available"] == json!(false) {
        return Ok(
            json!({"approved": false, "correct": false, "done": false, "available": false, "iterations": result["iterations"], "message": result["message"], "domain": result["domain"]}),
        );
    }
    if result["correct"] != json!(true) {
        return Ok(json!({
            "approved": false, "correct": false, "done": false, "iterations": result["iterations"], "microlesson": result["microlesson"],
            "explain": result["explain"], "domain": result["domain"], "questionIndex": result["questionIndex"], "questionCount": result["questionCount"], "repetition": result["repetition"],
        }));
    }
    if result["done"] != json!(true) {
        return Ok(
            json!({"approved": false, "correct": true, "done": false, "iterations": result["iterations"], "microlesson": result["microlesson"], "domain": result["domain"], "nextQuestion": result["nextQuestion"]}),
        );
    }

    let request_id = build_request_id(run_id, nnnn);
    let quiz_ref = format!("decisions/{nnnn}-quiz.md");
    let decision_ref = format!("{nnnn}-decision-request.md");
    let quiz_completion = QuizCompletion {
        decision_ref: result["quizDecisionRef"]
            .as_str()
            .unwrap_or(&decision_ref)
            .to_string(),
        iterations: result["quizIterations"].as_u64(),
        time_to_understanding_sec: result["quizTimeToUnderstandingSec"].as_f64(),
    };
    let approval = build_and_sign_approval(BuildApprovalParams {
        request_id,
        chosen_option,
        quiz_ref: &quiz_ref,
        quiz: &quiz_completion,
        decision_ref: &decision_ref,
        private_key_jwk: &device_key.private_key_jwk,
        public_key_base64: &device_key.public_key_base64,
        signed_at: None,
    })
    .map_err(|e| e.to_string())?;
    let approval_file_path = approval_path(decisions_dir, nnnn);
    io.write_file(
        &approval_file_path,
        &crate::approval::format_approval_file(&approval),
    )
    .await;
    Ok(json!({
        "approved": true, "correct": true, "done": true, "iterations": result["iterations"], "approval": approval,
        "approvalPath": approval_file_path, "microlesson": result["microlesson"], "domain": result["domain"],
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemoryIo;
    use crate::signing::generate_device_keypair;

    const DECISIONS_DIR: &str = "/root/runs/demo-1/decisions";
    const DR_0001: &str =
        include_str!("../tests/fixtures/runs/demo-1/decisions/0001-decision-request.md");

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
    async fn decision_quiz_first_call_writes_draft_with_shown_at() {
        let io = MemoryIo::new([(dr_path(), DR_0001.to_string())]);
        let result = decision_quiz(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            "B",
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result["options"].as_array().unwrap().len(), 3);
        assert_eq!(result["depth"], "one-tap");
        assert_eq!(result["generatedBy"], "quiz-gen-fallback");
        let quiz_text = io.get(&format!("{DECISIONS_DIR}/0001-quiz.md")).unwrap();
        assert!(quiz_text.contains("shown_at:"));
    }

    #[tokio::test]
    async fn decision_quiz_repeat_call_returns_same_question_without_regenerating() {
        let io = MemoryIo::new([(dr_path(), DR_0001.to_string())]);
        let first = decision_quiz(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            "B",
            None,
            None,
        )
        .await
        .unwrap();
        let second = decision_quiz(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            "B",
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(second["question"], first["question"]);
        assert_eq!(second["options"], first["options"]);
    }

    #[tokio::test]
    async fn decision_quiz_missing_decision_request_errors() {
        let io = MemoryIo::default();
        let err = decision_quiz(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "9999",
            "B",
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("не знайдено"));
    }

    async fn quiz_options_and_correct(io: &MemoryIo) -> (Vec<String>, String) {
        let text = io.get(&format!("{DECISIONS_DIR}/0001-quiz.md")).unwrap();
        let parsed = parse_quiz_file(&text);
        let attempt = parsed.questions[0].attempts.last().unwrap().clone();
        (attempt.options, attempt.correct_answer)
    }

    #[tokio::test]
    async fn wrong_answer_increments_iterations_no_approval_written() {
        let io = MemoryIo::new([(dr_path(), DR_0001.to_string())]);
        decision_quiz(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            "B",
            None,
            None,
        )
        .await
        .unwrap();
        let (options, correct) = quiz_options_and_correct(&io).await;
        let wrong_index = options.iter().position(|o| o != &correct).unwrap() as i64;
        let result = submit_quiz_answer(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            Some(Answer::Index(wrong_index)),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result["correct"], false);
        assert_eq!(result["iterations"], 2);
        assert!(result["microlesson"]
            .as_str()
            .unwrap()
            .contains("Мікроурок"));
        assert!(!io.has(&format!("{DECISIONS_DIR}/0001-approval.json")));
    }

    #[tokio::test]
    async fn correct_answer_finalizes_quiz_and_computes_time_to_understanding() {
        let io = MemoryIo::new([(dr_path(), DR_0001.to_string())]);
        let shown = chrono::DateTime::parse_from_rfc3339("2026-08-09T10:00:00.000Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        decision_quiz(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            "B",
            None,
            Some(shown),
        )
        .await
        .unwrap();
        let (options, correct) = quiz_options_and_correct(&io).await;
        let correct_index = options.iter().position(|o| o == &correct).unwrap() as i64;
        let later = shown + chrono::Duration::seconds(47);
        let result = submit_quiz_answer(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            Some(Answer::Index(correct_index)),
            None,
            None,
            None,
            Some(later),
        )
        .await
        .unwrap();
        assert_eq!(result["correct"], true);
        assert_eq!(result["iterations"], 1);
        let final_text = io.get(&format!("{DECISIONS_DIR}/0001-quiz.md")).unwrap();
        assert!(!final_text.contains("shown_at"));
        assert!(final_text.contains("time_to_understanding_sec: 47"));
    }

    #[tokio::test]
    async fn decision_already_closed_quiz_does_not_mutate() {
        let io = MemoryIo::new([
            (dr_path(), DR_0001.to_string()),
            (
                format!("{DECISIONS_DIR}/0001-approval.json"),
                "{\"approved\":true}".to_string(),
            ),
        ]);
        let err = decision_quiz(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            "B",
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("вже закрите"));
        assert!(!io.has(&format!("{DECISIONS_DIR}/0001-quiz.md")));
    }

    #[tokio::test]
    async fn decision_approve_wrong_answer_does_not_write_approval() {
        let io = MemoryIo::new([(dr_path(), DR_0001.to_string())]);
        let keypair = generate_device_keypair();
        decision_quiz(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            "B",
            None,
            None,
        )
        .await
        .unwrap();
        let (options, correct) = quiz_options_and_correct(&io).await;
        let wrong_index = options.iter().position(|o| o != &correct).unwrap() as i64;
        let result = decision_approve(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "demo-1",
            "0001",
            "B",
            Some(Answer::Index(wrong_index)),
            None,
            &keypair,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result["approved"], false);
        assert!(!io.has(&format!("{DECISIONS_DIR}/0001-approval.json")));
    }

    #[tokio::test]
    async fn decision_approve_correct_answer_writes_verifiable_approval() {
        let io = MemoryIo::new([(dr_path(), DR_0001.to_string())]);
        let keypair = generate_device_keypair();
        decision_quiz(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            "B",
            None,
            None,
        )
        .await
        .unwrap();
        let (options, correct) = quiz_options_and_correct(&io).await;
        let correct_index = options.iter().position(|o| o == &correct).unwrap() as i64;
        let result = decision_approve(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "demo-1",
            "0001",
            "B",
            Some(Answer::Index(correct_index)),
            None,
            &keypair,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result["approved"], true);
        assert_eq!(result["approval"]["chosen_option"], "B");
        assert_eq!(result["approval"]["quiz_ref"], "decisions/0001-quiz.md");
        assert_eq!(result["approval"]["request_id"], "demo-1/0001");
        assert!(crate::approval::verify_approval(&result["approval"]));
        assert!(io.has(&format!("{DECISIONS_DIR}/0001-approval.json")));
    }

    #[tokio::test]
    async fn layered_explain_grows_cumulatively_with_repeated_fails() {
        let io = MemoryIo::new([(dr_path(), DR_0001.to_string())]);
        decision_quiz(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            "B",
            None,
            None,
        )
        .await
        .unwrap();
        let (options, correct) = quiz_options_and_correct(&io).await;
        let wrong_index = options.iter().position(|o| o != &correct).unwrap() as i64;

        let r1 = submit_quiz_answer(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            Some(Answer::Index(wrong_index)),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(r1["explain"].as_array().unwrap().len(), 1);
        assert_eq!(r1["explain"][0]["heading"], "Контекст");

        let r2 = submit_quiz_answer(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            Some(Answer::Index(wrong_index)),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(r2["explain"].as_array().unwrap().len(), 2);
        assert_eq!(r2["explain"][1]["heading"], "Наслідки варіантів");

        let r3 = submit_quiz_answer(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            Some(Answer::Index(wrong_index)),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(r3["explain"].as_array().unwrap().len(), 3);
        assert_eq!(r3["explain"][2]["heading"], "Рекомендація агента");

        let r4 = submit_quiz_answer(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            Some(Answer::Index(wrong_index)),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(r4["explain"].as_array().unwrap().len(), 3); // стеля на 3
    }

    #[tokio::test]
    async fn knowledge_base_entry_written_only_on_full_completion() {
        let io = MemoryIo::new([(dr_path(), DR_0001.to_string())]);
        let kio = crate::io::MemoryKnowledgeIo::default();
        let keypair = generate_device_keypair();
        decision_quiz(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "0001",
            "B",
            Some(&kio),
            None,
        )
        .await
        .unwrap();
        let (options, correct) = quiz_options_and_correct(&io).await;
        let correct_index = options.iter().position(|o| o == &correct).unwrap() as i64;
        let result = decision_approve(
            &io,
            &client(),
            &unreachable_llm(),
            DECISIONS_DIR,
            "demo-1",
            "0001",
            "B",
            Some(Answer::Index(correct_index)),
            None,
            &keypair,
            Some(&kio),
            Some(chrono::Utc::now()),
        )
        .await
        .unwrap();
        assert_eq!(result["approved"], true);
        assert_eq!(result["domain"], "architecture");
        let entries = crate::knowledge::parse_knowledge_file(kio.read().await.as_deref());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].decision_ref, "0001-decision-request.md");
        assert_eq!(entries[0].domain, "architecture");
    }
}
