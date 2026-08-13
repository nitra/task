//! Онбординг = перший мандат (конституція п.10, `docs/specs/260809-delta-app.md`:
//! «Новий співробітник стартує з акта делегування: підписаний мандат + квіз
//! на розуміння меж — сам вхід у систему демонструє модель»).
//!
//! Потік, коли `handle` відсутній серед `owner` у `.mt/mandates.yaml`:
//! (а) [`build_onboarding_mandate_file`] — з обраного делегатора й
//! scope-запиту (шаблон мінімального мандата, [`minimal_mandate_template`])
//! будує НОВИЙ стан `MandatesFile` з доданим записом (`computed_owner` акта
//! делегування — сам делегатор, `depth` квіз-гейта форсовано на
//! максимальний доступний — той самий механізм `change_proposal.rs`, що
//! й розширення ШІ-мандата: `ChangeKind::Added` у
//! `mt_mandates::validate_mandate_change` вимагає підпису делегатора,
//! точнісінько як `Widened`); (б)/(в) — наявний механізм: викликач пише
//! [`crate::change_proposal::write_change_proposal`] з цим станом,
//! делегатор проходить ЗВИЧАЙНИЙ M1/M2 квіз-конвеєр (`decision_flow.rs`) і
//! підписує через [`crate::change_proposal::apply_mandate_change_proposal`];
//! (г) — НОВЕ в цьому модулі: [`entry_quiz_start`]/[`entry_quiz_submit`] —
//! окремий, детермінований (без LLM — не потрібен: питання будуються
//! напряму з полів щойно отриманого мандата, не з вільного тексту)
//! квіз-гейт РОЗУМІННЯ меж отриманого мандата (пороги/`escalates_to`), який
//! проходить сам новоприбулий, у `runs/onboarding-{handle}/` — ОКРЕМИЙ
//! run від `runs/mandate-change-onboarding-{handle}/`, де живе акт
//! делегування. Спрощення відносно M2 (задокументоване рішення): усі
//! питання показуються ОДРАЗУ (batch), не по одному активному — entry-quiz
//! перевіряє розуміння вже підписаного факту, не веде через розвилку, тому
//! послідовна подача не додає цінності; фейл ≠ покарання лишається (ті самі
//! питання повертаються, лічильник `iterations` росте).

use chrono::{DateTime, SecondsFormat, Utc};
use mt_mandates::{
    AudacityLevel, Mandate, MandateKind, MandatesFile, RiskLevel, Scope, Thresholds,
};
use serde_json::{json, Value};

use crate::io::Io;
use crate::quiz::{
    format_quiz_file, parse_quiz_file, GeneratedQuestion, QuestionAttempt, QuestionState, QuizDraft,
};

/// Чи потрібен `handle`-у онбординг — відсутній серед існуючих власників
/// мандатів (`docs/specs/260809-delta-app.md`, конституція п.10).
pub fn needs_onboarding(mandates: &MandatesFile, handle: &str) -> bool {
    !mandates.mandates.iter().any(|m| m.owner == handle)
}

/// Консервативні пороги шаблону мінімального мандата — точка старту, не
/// фінальний стан: подальші розширення йдуть тим самим підписаним шляхом
/// change-proposal (`change_proposal.rs`), що й будь-яке інше розширення.
pub fn minimal_mandate_thresholds(kind: MandateKind) -> Thresholds {
    Thresholds {
        budget_eur: Some(0.0),
        risk: Some(RiskLevel::Low),
        irreversible: Some(false),
        audacity: match kind {
            MandateKind::Model => Some(AudacityLevel::Low),
            MandateKind::Person => None,
        },
    }
}

/// Шаблон мінімального мандата для запиту новоприбулого — крок (а) потоку:
/// `escalates_to` ЗАВЖДИ делегатор, пороги — мінімальні консервативні.
pub fn minimal_mandate_template(
    handle: &str,
    delegator: &str,
    kind: MandateKind,
    scope: Scope,
) -> Mandate {
    Mandate {
        owner: handle.to_string(),
        kind,
        scope,
        thresholds: minimal_mandate_thresholds(kind),
        escalates_to: Some(delegator.to_string()),
    }
}

/// Будує новий стан `.mt/mandates.yaml`, що додає `handle` як власника
/// нового запису — крок (б): готовий вхід для
/// `change_proposal::write_change_proposal`/`apply_mandate_change_proposal`
/// (той самий `ChangeKind::Added`-шлях `mt_mandates::validate_mandate_change`,
/// що розширення ШІ-мандата). Fail-closed: handle уже присутній, делегатор
/// відсутній серед існуючих власників, чи порожній scope — усе відхиляється
/// ДО того, як щось потрапляє в change-proposal.
pub fn build_onboarding_mandate_file(
    old: &MandatesFile,
    handle: &str,
    delegator: &str,
    kind: MandateKind,
    scope: Scope,
) -> Result<MandatesFile, String> {
    if old.mandates.iter().any(|m| m.owner == handle) {
        return Err(format!(
            "'{handle}' уже має мандат — онбординг лише для нових handle (для зміни наявного мандата — звичайний change-proposal)"
        ));
    }
    if !old.mandates.iter().any(|m| m.owner == delegator) {
        return Err(format!(
            "делегатор '{delegator}' відсутній серед існуючих власників мандатів — обери кореневого чи наявного власника"
        ));
    }
    if scope.refs.is_empty() || scope.decision_types.is_empty() {
        return Err(
            "scope.refs і scope.decision_types не можуть бути порожніми — шаблон мінімального мандата вимагає явного запиту, не «усе»".to_string(),
        );
    }
    let mut mandates = old.mandates.clone();
    mandates.push(minimal_mandate_template(handle, delegator, kind, scope));
    Ok(MandatesFile {
        generation: old.generation + 1,
        mandates,
    })
}

/// `change_id`, що передається в `change_proposal::write_change_proposal`
/// для акта делегування онбордингу — run опиняється в
/// `runs/mandate-change-onboarding-{handle}/decisions/` (той самий
/// `mandate-change-{change_id}`-конвеєр, що будь-яке інше розширення).
pub fn onboarding_change_id(handle: &str) -> String {
    format!("onboarding-{handle}")
}

// ---------------------------------------------------------------------
// Крок (г): entry-quiz новоприбулого — розуміння меж ЩОЙНО отриманого
// мандата. Детермінований генератор (без LLM): три питання про власні
// пороги/scope/escalates_to, побудовані напряму з полів Mandate.
// ---------------------------------------------------------------------

fn rotate_options(correct: &str, mut distractors: Vec<String>, seed: &str) -> (Vec<String>, usize) {
    distractors.retain(|d| d != correct);
    while distractors.len() < 2 {
        distractors.push("Жодне з переліченого".to_string());
    }
    let mut options = vec![correct.to_string()];
    options.extend(distractors.into_iter().take(2));
    let rotation = seed.chars().count() % options.len();
    let mut rotated = options[rotation..].to_vec();
    rotated.extend_from_slice(&options[..rotation]);
    let correct_index = rotated.iter().position(|o| o == correct).unwrap_or(0);
    (rotated, correct_index)
}

fn budget_question(mandate: &Mandate) -> GeneratedQuestion {
    let actual = match mandate.thresholds.budget_eur {
        Some(b) => format!("до {b:.0} EUR — вище йде вгору за escalates_to"),
        None => "без обмеження бюджету".to_string(),
    };
    let distractors = vec![
        "до 5000 EUR — вище йде вгору за escalates_to".to_string(),
        "без обмеження бюджету".to_string(),
        "до 200 EUR — вище йде вгору за escalates_to".to_string(),
    ];
    let (options, correct_index) = rotate_options(&actual, distractors, &mandate.owner);
    GeneratedQuestion {
        question: "Який поріг бюджету (budget_eur) у твоєму мандаті — вище нього рішення йде НЕ до тебе, а вгору?".to_string(),
        options,
        correct_index,
        microlesson: "Мікроурок: пороги мандата (thresholds) — груба сітка з mandates.yaml; рішення вище порогу автоматично маршрутизується вгору за escalates_to, не «губиться» і не виконується тихцем.".to_string(),
    }
}

fn escalation_question(mandate: &Mandate) -> GeneratedQuestion {
    let actual = mandate
        .escalates_to
        .clone()
        .unwrap_or_else(|| "нікуди — це кореневий мандат".to_string());
    let distractors = vec![
        "vitalii".to_string(),
        "нікуди — це кореневий мандат".to_string(),
        "olena".to_string(),
    ];
    let (options, correct_index) =
        rotate_options(&actual, distractors, &format!("{}-esc", mandate.owner));
    GeneratedQuestion {
        question: "Кому йде ескалація (escalates_to), коли розвилка виходить за межі твого мандата?".to_string(),
        options,
        correct_index,
        microlesson: "Мікроурок: escalates_to — адресат КОНКРЕТНОЇ нерозв'язаної розвилки, не «начальник»; власник вузла піддерева не командує виконавцями підвузлів (mandates.md, «Власник вузла ≠ начальник виконавців підвузлів»).".to_string(),
    }
}

fn scope_question(mandate: &Mandate) -> GeneratedQuestion {
    let actual = if mandate.scope.covers_all_decision_types() {
        "усі типи рішень (decision_types: [\"*\"])".to_string()
    } else {
        mandate.scope.decision_types.join(", ")
    };
    let distractors = vec![
        "усі типи рішень (decision_types: [\"*\"])".to_string(),
        "architecture, ux".to_string(),
        "ops".to_string(),
    ];
    let (options, correct_index) =
        rotate_options(&actual, distractors, &format!("{}-scope", mandate.owner));
    GeneratedQuestion {
        question: "На які типи рішень (decision_types) поширюється твій мандат?".to_string(),
        options,
        correct_index,
        microlesson: "Мікроурок: scope.decision_types (разом із scope.refs) визначає, які decision-request-и взагалі МОЖУТЬ потрапити в твою чергу «Вирішую» — решта йде повз тебе за карткою мандатів.".to_string(),
    }
}

/// Три детерміновані контрольні питання про щойно отриманий мандат — крок
/// (г) потоку, без LLM.
pub fn generate_entry_questions(mandate: &Mandate) -> Vec<GeneratedQuestion> {
    vec![
        budget_question(mandate),
        escalation_question(mandate),
        scope_question(mandate),
    ]
}

fn entry_quiz_dir(mandates_dir: &str, handle: &str) -> String {
    format!("{mandates_dir}/runs/onboarding-{handle}")
}
fn entry_quiz_path(mandates_dir: &str, handle: &str) -> String {
    format!("{}/entry-quiz.md", entry_quiz_dir(mandates_dir, handle))
}
fn entry_quiz_complete_path(mandates_dir: &str, handle: &str) -> String {
    format!(
        "{}/entry-quiz-complete.json",
        entry_quiz_dir(mandates_dir, handle)
    )
}

fn question_to_json(q: &QuestionState) -> Value {
    let a = q
        .attempts
        .last()
        .expect("щойно згенероване питання завжди має спробу");
    json!({"question": a.question, "options": a.options})
}

/// Генерує (перший виклик) або показує (повторний, без регенерації) три
/// entry-quiz-питання щойно отриманого мандата — `runs/onboarding-{handle}/entry-quiz.md`.
pub async fn entry_quiz_start(
    io: &dyn Io,
    mandates_dir: &str,
    handle: &str,
    mandate: &Mandate,
    mandate_generation: u64,
    now: Option<DateTime<Utc>>,
) -> Value {
    let path = entry_quiz_path(mandates_dir, handle);
    if let Some(existing) = io.read_file(&path).await {
        let quiz = parse_quiz_file(&existing);
        return json!({
            "quizPath": path,
            "questions": quiz.questions.iter().map(question_to_json).collect::<Vec<_>>(),
            "iterations": quiz.iterations.unwrap_or(0),
        });
    }
    let questions = generate_entry_questions(mandate);
    let question_states: Vec<QuestionState> = questions
        .iter()
        .map(|q| QuestionState {
            repetition: false,
            attempts: vec![QuestionAttempt {
                question: q.question.clone(),
                options: q.options.clone(),
                correct_answer: q.options[q.correct_index].clone(),
                microlesson: q.microlesson.clone(),
            }],
        })
        .collect();
    let shown_at = now
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Millis, true);
    let draft = QuizDraft {
        decision_ref: format!("mandate:{handle}@{mandate_generation}"),
        depth: "entry".to_string(),
        generated_by: "entry-quiz-deterministic".to_string(),
        iterations: 0,
        shown_at: Some(shown_at),
        resolved_count: Some(0),
        repetition_source: None,
        questions: question_states.clone(),
        time_to_understanding_sec: None,
        trust_simplified: false,
    };
    io.write_file(&path, &format_quiz_file(&draft)).await;
    json!({
        "quizPath": path,
        "questions": question_states.iter().map(question_to_json).collect::<Vec<_>>(),
        "iterations": 0,
    })
}

/// Проводить відповіді на ВСІ entry-quiz-питання разом (`answers[i]` —
/// 0-based індекс для `i`-того питання). Усі правильні → пише
/// `entry-quiz-complete.json` (онбординг завершено); будь-яка неправильна —
/// фейл ≠ покарання: ті самі питання лишаються, `iterations` росте,
/// відповідь показує, які саме питання не пройдені (з мікроуроком).
pub async fn entry_quiz_submit(
    io: &dyn Io,
    mandates_dir: &str,
    handle: &str,
    answers: &[i64],
    now: Option<DateTime<Utc>>,
) -> Result<Value, String> {
    let path = entry_quiz_path(mandates_dir, handle);
    let text = io.read_file(&path).await.ok_or_else(|| {
        format!("entry-quiz для '{handle}' ще не згенеровано — виклич entry_quiz_start спершу")
    })?;
    let quiz = parse_quiz_file(&text);
    if answers.len() != quiz.questions.len() {
        return Err(format!(
            "очікується {} відповідей (по одній на питання), отримано {}",
            quiz.questions.len(),
            answers.len()
        ));
    }

    let mut all_correct = true;
    let mut results = Vec::new();
    for (q, &answer_idx) in quiz.questions.iter().zip(answers) {
        let attempt = q
            .attempts
            .last()
            .expect("entry-quiz питання завжди має спробу");
        let correct_index = attempt
            .options
            .iter()
            .position(|o| o == &attempt.correct_answer)
            .map(|i| i as i64)
            .unwrap_or(-1);
        let correct = answer_idx != -1 && answer_idx == correct_index;
        if !correct {
            all_correct = false;
        }
        results.push(json!({
            "question": attempt.question,
            "correct": correct,
            "microlesson": if correct { Value::Null } else { json!(attempt.microlesson) },
        }));
    }

    let iterations = quiz.iterations.unwrap_or(0) + 1;
    let now_date = now.unwrap_or_else(Utc::now);

    if !all_correct {
        let draft = QuizDraft {
            decision_ref: quiz.decision_ref.clone().unwrap_or_default(),
            depth: "entry".to_string(),
            generated_by: quiz.generated_by.clone().unwrap_or_default(),
            iterations,
            shown_at: quiz.shown_at.clone(),
            resolved_count: Some(0),
            repetition_source: None,
            questions: quiz.questions.clone(),
            time_to_understanding_sec: None,
            trust_simplified: false,
        };
        io.write_file(&path, &format_quiz_file(&draft)).await;
        return Ok(json!({"completed": false, "iterations": iterations, "results": results}));
    }

    let final_quiz = QuizDraft {
        decision_ref: quiz.decision_ref.clone().unwrap_or_default(),
        depth: "entry".to_string(),
        generated_by: quiz.generated_by.clone().unwrap_or_default(),
        iterations,
        shown_at: None,
        resolved_count: None,
        repetition_source: None,
        questions: quiz.questions.clone(),
        time_to_understanding_sec: Some(0.0),
        trust_simplified: false,
    };
    io.write_file(&path, &format_quiz_file(&final_quiz)).await;

    let completed_at = now_date.to_rfc3339_opts(SecondsFormat::Millis, true);
    let marker = json!({"handle": handle, "completedAt": completed_at, "iterations": iterations});
    io.write_file(
        &entry_quiz_complete_path(mandates_dir, handle),
        &format!("{}\n", serde_json::to_string_pretty(&marker).unwrap()),
    )
    .await;

    Ok(json!({"completed": true, "iterations": iterations, "results": results}))
}

/// Чи новоприбулий уже пройшов entry-quiz — онбординг завершено лише коли
/// ОБИДВА кроки зроблено: акт делегування підписаний (мандат уже в
/// `mandates.yaml`, перевіряється окремо `needs_onboarding`) І цей маркер
/// існує.
pub async fn entry_quiz_completed(io: &dyn Io, mandates_dir: &str, handle: &str) -> bool {
    io.read_file(&entry_quiz_complete_path(mandates_dir, handle))
        .await
        .is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemoryIo;
    use crate::test_support::base_file;

    fn person_scope() -> Scope {
        Scope {
            refs: vec!["refs/mt/tasks/design/**".to_string()],
            decision_types: vec!["architecture".to_string()],
        }
    }

    #[test]
    fn needs_onboarding_true_for_unknown_handle_false_for_known() {
        let file = base_file(3);
        assert!(needs_onboarding(&file, "nova"));
        assert!(!needs_onboarding(&file, "olena"));
    }

    #[test]
    fn minimal_mandate_thresholds_person_has_no_audacity() {
        let t = minimal_mandate_thresholds(MandateKind::Person);
        assert_eq!(t.budget_eur, Some(0.0));
        assert_eq!(t.risk, Some(RiskLevel::Low));
        assert_eq!(t.irreversible, Some(false));
        assert_eq!(t.audacity, None);
    }

    #[test]
    fn minimal_mandate_thresholds_model_has_low_audacity() {
        let t = minimal_mandate_thresholds(MandateKind::Model);
        assert_eq!(t.audacity, Some(AudacityLevel::Low));
    }

    #[test]
    fn build_onboarding_mandate_file_appends_entry_and_bumps_generation() {
        let old = base_file(3);
        let new_file = build_onboarding_mandate_file(
            &old,
            "nova",
            "olena",
            MandateKind::Person,
            person_scope(),
        )
        .unwrap();
        assert_eq!(new_file.generation, 4);
        assert_eq!(new_file.mandates.len(), old.mandates.len() + 1);
        let added = new_file
            .mandates
            .iter()
            .find(|m| m.owner == "nova")
            .unwrap();
        assert_eq!(added.escalates_to.as_deref(), Some("olena"));
        assert_eq!(added.thresholds.budget_eur, Some(0.0));
    }

    #[test]
    fn build_onboarding_mandate_file_rejects_existing_handle() {
        let old = base_file(3);
        let err = build_onboarding_mandate_file(
            &old,
            "olena",
            "vitalii",
            MandateKind::Person,
            person_scope(),
        )
        .unwrap_err();
        assert!(err.contains("уже має мандат"));
    }

    #[test]
    fn build_onboarding_mandate_file_rejects_unknown_delegator() {
        let old = base_file(3);
        let err = build_onboarding_mandate_file(
            &old,
            "nova",
            "ghost",
            MandateKind::Person,
            person_scope(),
        )
        .unwrap_err();
        assert!(err.contains("відсутній серед існуючих власників"));
    }

    #[test]
    fn build_onboarding_mandate_file_rejects_empty_scope() {
        let old = base_file(3);
        let empty = Scope {
            refs: vec![],
            decision_types: vec![],
        };
        let err = build_onboarding_mandate_file(&old, "nova", "olena", MandateKind::Person, empty)
            .unwrap_err();
        assert!(err.contains("порожніми"));
    }

    #[test]
    fn resulting_file_passes_mt_mandates_validation_as_added_change() {
        let old = base_file(3);
        let new_file = build_onboarding_mandate_file(
            &old,
            "nova",
            "olena",
            MandateKind::Person,
            person_scope(),
        )
        .unwrap();
        let yaml = crate::mandate_change::format_mandates_yaml(&new_file);
        assert!(mt_mandates::parse_mandates_str(&yaml).is_ok());
    }

    fn nova_mandate() -> Mandate {
        minimal_mandate_template("nova", "olena", MandateKind::Person, person_scope())
    }

    #[tokio::test]
    async fn entry_quiz_start_writes_three_questions_first_call() {
        let io = MemoryIo::default();
        let result = entry_quiz_start(&io, "/ws", "nova", &nova_mandate(), 4, None).await;
        assert_eq!(result["questions"].as_array().unwrap().len(), 3);
        assert_eq!(result["iterations"], 0);
        assert!(io.has("/ws/runs/onboarding-nova/entry-quiz.md"));
    }

    #[tokio::test]
    async fn entry_quiz_start_repeat_call_does_not_regenerate() {
        let io = MemoryIo::default();
        let first = entry_quiz_start(&io, "/ws", "nova", &nova_mandate(), 4, None).await;
        let second = entry_quiz_start(&io, "/ws", "nova", &nova_mandate(), 4, None).await;
        assert_eq!(first["questions"], second["questions"]);
    }

    #[tokio::test]
    async fn entry_quiz_submit_all_correct_completes_onboarding() {
        let io = MemoryIo::default();
        entry_quiz_start(&io, "/ws", "nova", &nova_mandate(), 4, None).await;
        let text = io.get("/ws/runs/onboarding-nova/entry-quiz.md").unwrap();
        let parsed = parse_quiz_file(&text);
        let correct_answers: Vec<i64> = parsed
            .questions
            .iter()
            .map(|q| {
                let a = q.attempts.last().unwrap();
                a.options
                    .iter()
                    .position(|o| o == &a.correct_answer)
                    .unwrap() as i64
            })
            .collect();
        let result = entry_quiz_submit(&io, "/ws", "nova", &correct_answers, None)
            .await
            .unwrap();
        assert_eq!(result["completed"], true);
        assert!(entry_quiz_completed(&io, "/ws", "nova").await);
    }

    #[tokio::test]
    async fn entry_quiz_submit_wrong_answer_does_not_complete_but_keeps_same_questions() {
        let io = MemoryIo::default();
        entry_quiz_start(&io, "/ws", "nova", &nova_mandate(), 4, None).await;
        let text_before = io.get("/ws/runs/onboarding-nova/entry-quiz.md").unwrap();
        let result = entry_quiz_submit(&io, "/ws", "nova", &[-1, -1, -1], None)
            .await
            .unwrap();
        assert_eq!(result["completed"], false);
        assert_eq!(result["iterations"], 1);
        assert!(!entry_quiz_completed(&io, "/ws", "nova").await);
        let text_after = io.get("/ws/runs/onboarding-nova/entry-quiz.md").unwrap();
        let before = parse_quiz_file(&text_before);
        let after = parse_quiz_file(&text_after);
        assert_eq!(before.questions.len(), after.questions.len());
        for (b, a) in before.questions.iter().zip(after.questions.iter()) {
            assert_eq!(
                b.attempts.last().unwrap().question,
                a.attempts.last().unwrap().question
            );
        }
    }

    #[tokio::test]
    async fn entry_quiz_submit_wrong_count_of_answers_errors() {
        let io = MemoryIo::default();
        entry_quiz_start(&io, "/ws", "nova", &nova_mandate(), 4, None).await;
        let err = entry_quiz_submit(&io, "/ws", "nova", &[0, 1], None)
            .await
            .unwrap_err();
        assert!(err.contains("очікується 3"));
    }

    #[tokio::test]
    async fn entry_quiz_submit_without_start_errors() {
        let io = MemoryIo::default();
        let err = entry_quiz_submit(&io, "/ws", "nova", &[0, 0, 0], None)
            .await
            .unwrap_err();
        assert!(err.contains("ще не згенеровано"));
    }

    #[tokio::test]
    async fn entry_quiz_not_completed_before_submit() {
        let io = MemoryIo::default();
        assert!(!entry_quiz_completed(&io, "/ws", "nova").await);
    }

    /// Наскрізний потік конституційного п.10 — усі чотири кроки одним
    /// тестом: (а) шаблон мінімального мандата → (б) change-proposal тим
    /// самим механізмом, що розширення ШІ-мандата → (в) делегатор проходить
    /// ЗВИЧАЙНИЙ M1/M2 квіз-конвеєр і підписує → мандат застосовано в
    /// mandates.yaml → (г) новоприбулий проходить ВЛАСНИЙ entry-quiz на
    /// щойно отриманому мандаті — лише після цього онбординг завершено.
    #[tokio::test]
    async fn full_onboarding_flow_delegator_signs_then_entrant_passes_entry_quiz() {
        let old = base_file(3);
        let new_file = build_onboarding_mandate_file(
            &old,
            "nova",
            "olena",
            MandateKind::Person,
            person_scope(),
        )
        .unwrap();
        let io = MemoryIo::default();
        let change_id = onboarding_change_id("nova");
        assert_eq!(change_id, "onboarding-nova");

        crate::change_proposal::write_change_proposal(
            &io,
            "/ws",
            &change_id,
            &old,
            &new_file,
            "nova",
            "olena",
            "nova",
            "Новий співробітник nova запитує мандат architecture під олена.",
            None,
        )
        .await;
        let decisions_dir =
            crate::change_proposal::change_proposal_decisions_dir("/ws", &change_id);

        // Ще НЕ онбордингований — handle відсутній у старому файлі.
        assert!(needs_onboarding(&old, "nova"));

        // (в) Делегатор проходить звичайний M1/M2 квіз-конвеєр — той самий
        // decision_flow, що будь-яка інша розвилка (форс на "standard" уже
        // застосований у build_change_proposal_markdown).
        let client = reqwest::Client::new();
        let llm = crate::quiz::LlmConfig {
            base_url: "http://127.0.0.1:1".into(),
            model: "x".into(),
        };
        let keypair = crate::signing::generate_device_keypair();
        crate::decision_flow::decision_quiz(
            &io,
            &client,
            &llm,
            &decisions_dir,
            "0001",
            "A",
            None,
            None,
        )
        .await
        .unwrap();
        // change-proposal форсує leverage_facets на `standard` (2 питання,
        // не `one-tap`) — той самий конвеєр, що розширення ШІ-мандата
        // (change_proposal.rs module doc): відповідаємо на ОБИДВА питання
        // послідовно, як звичайний standard-квіз.
        let mut approve_result = json!({});
        loop {
            let quiz_text = io.get(&format!("{decisions_dir}/0001-quiz.md")).unwrap();
            let parsed = crate::quiz::parse_quiz_file(&quiz_text);
            let resolved_count = parsed.resolved_count.unwrap_or(0) as usize;
            let attempt = parsed.questions[resolved_count].attempts.last().unwrap();
            let correct_index = attempt
                .options
                .iter()
                .position(|o| o == &attempt.correct_answer)
                .unwrap() as i64;
            approve_result = crate::decision_flow::decision_approve(
                &io,
                &client,
                &llm,
                &decisions_dir,
                &change_id,
                "0001",
                "A",
                Some(crate::decision_flow::Answer::Index(correct_index)),
                None,
                &keypair,
                None,
                None,
            )
            .await
            .unwrap();
            if approve_result["done"] == json!(true) || approve_result["approved"] == json!(true) {
                break;
            }
        }
        assert_eq!(approve_result["approved"], true);

        let apply_result = crate::change_proposal::apply_mandate_change_proposal(
            &io,
            "/ws/.mt/mandates.yaml",
            &old,
            &new_file,
            &approve_result["approval"],
            "olena",
            crate::device_registry::SignerRole::Human,
            &keypair,
            vec![],
            None,
            None,
        )
        .await;
        assert_eq!(apply_result["valid"], true);
        assert!(io.has("/ws/.mt/mandates.yaml"));

        // Мандат застосовано — handle більше НЕ потребує онбордингу за
        // критерієм "відсутній у mandates.yaml", але entry-quiz ще не пройдено.
        assert!(!needs_onboarding(&new_file, "nova"));
        assert!(!entry_quiz_completed(&io, "/ws", "nova").await);

        // (г) Новоприбулий проходить СВІЙ entry-quiz на розуміння меж.
        let nova_mandate = new_file
            .mandates
            .iter()
            .find(|m| m.owner == "nova")
            .unwrap();
        entry_quiz_start(&io, "/ws", "nova", nova_mandate, new_file.generation, None).await;
        let entry_text = io.get("/ws/runs/onboarding-nova/entry-quiz.md").unwrap();
        let entry_parsed = parse_quiz_file(&entry_text);
        let correct_answers: Vec<i64> = entry_parsed
            .questions
            .iter()
            .map(|q| {
                let a = q.attempts.last().unwrap();
                a.options
                    .iter()
                    .position(|o| o == &a.correct_answer)
                    .unwrap() as i64
            })
            .collect();
        let entry_result = entry_quiz_submit(&io, "/ws", "nova", &correct_answers, None)
            .await
            .unwrap();
        assert_eq!(entry_result["completed"], true);

        // Онбординг повністю завершено: мандат у файлі + entry-quiz пройдено.
        assert!(entry_quiz_completed(&io, "/ws", "nova").await);
    }
}
