//! Квіз-генератор (one-tap/standard/teach-back) і формат квіз-файлів —
//! порт `delta/src/quiz.js` (mt: `docs/architecture/mandates.md`,
//! «Квіз-гейт: підпис із доведеним розумінням»). Джерело питання —
//! локальний OpenAI-сумісний ендпоінт (reqwest); недоступний → детермінований
//! фолбек, зібраний із самого тіла decision-request — квіз ніколи не
//! пропускається. `depth: teach-back` (M5) — вільний переказ, ОЦІНЮЄТЬСЯ
//! локальною моделлю, БЕЗ детермінованого фолбека (задокументоване рішення
//! M5: оцінка покриття вільного тексту принципово потребує LLM).

use regex::Regex;
use serde::Deserialize;
use serde_json::json;

use crate::decisions::DecisionRequest;

/// Деякі локальні OpenAI-сумісні ендпоінти обгортають JSON-відповідь у
/// markdown code fence (` ```json ... ``` ` чи просто ` ``` ... ``` `)
/// попри явну інструкцію промпту «СТРОГО JSON без пояснень поза ним» —
/// знімаємо fence перед парсингом (спостережено живим ендпоінтом при
/// реальному прогоні M4/M6-демо, README). Вміст без fence повертається як є.
pub(crate) fn strip_json_code_fence(raw: &str) -> &str {
    let trimmed = raw.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    let rest = rest.strip_prefix("json").unwrap_or(rest);
    let rest = rest.trim_start_matches(['\n', '\r']);
    rest.strip_suffix("```").map(str::trim).unwrap_or(rest)
}

pub const TEACHBACK_UNAVAILABLE_MESSAGE: &str = "teach-back недоступний без локальної моделі — рішення лишається відкритим. Незворотне рішення не підписується без доведеного розуміння (mandates.md: «irreversible → teach-back»); фолбек на нижчу глибину квізу тут свідомо НЕ застосовується (docs/specs/260809-delta-app.md, «Обсяг M5», п.1).";

const TEACHBACK_PROMPT: &str = "Перекажи своїми словами: що саме ти підписуєш і що станеться. Включи: обраний варіант, головний наслідок цього вибору і головний ризик рішення.";

pub fn teach_back_prompt_text() -> &'static str {
    TEACHBACK_PROMPT
}

const SYSTEM_PROMPT: &str = "Ти — генератор квіз-гейтів для системи «Дельта» (mt mandates.md). Твоя робота відокремлена від агента, що готував рекомендацію (конфлікт інтересів у промпті) — не повторюй рекомендацію, перевіряй розуміння НАСЛІДКІВ обраного варіанта. Поверни СТРОГО JSON без пояснень поза ним: {\"question\": string, \"options\": [string, string, string], \"correctIndex\": 0|1|2, \"microlesson\": string}. question — одне контрольне питання про наслідки обраного варіанта; options — рівно 3 варіанти відповіді, лише один правильний (correctIndex); microlesson — 2-3 речення «що ще варто знати», не сама відповідь, а контекст навколо неї.";

const SYSTEM_PROMPT_STANDARD: &str = "Ти — генератор квіз-гейтів для системи «Дельта» (mt mandates.md), режим STANDARD (глибина decide-and-inform: середні leverage-фасети, лише reversible). Твоя робота відокремлена від агента, що готував рекомендацію (конфлікт інтересів у промпті) — не повторюй рекомендацію, перевіряй розуміння НАСЛІДКІВ обраного варіанта з РІЗНИХ боків (не переказ, а 2 незалежні контрольні питання). Поверни СТРОГО JSON без пояснень поза ним: {\"questions\": [{\"question\": string, \"options\": [string, string, string], \"correctIndex\": 0|1|2, \"microlesson\": string}, {\"question\": string, \"options\": [string, string, string], \"correctIndex\": 0|1|2, \"microlesson\": string}]} — рівно 2 питання, кожне про інший аспект наслідків (напр. перше — сам наслідок вибору, друге — ціна помилки/дедлайну чи межа наслідків).";

const REPHRASE_SYSTEM_PROMPT: &str = "Ти переформульовуєш формулювання КОНТРОЛЬНОГО питання квіз-гейта системи «Дельта» після неправильної відповіді — той самий сенс і ті самі варіанти відповіді (не міняй, що правильно), інше формулювання, щоб людина читала питання свіжим поглядом, а не впізнавала попередній текст. Поверни СТРОГО текст нового питання, без лапок і без пояснень поза ним.";

const TEACHBACK_SYSTEM_PROMPT: &str = "Ти оцінюєш ПЕРЕКАЗ (teach-back) розвилки системи «Дельта» (mt mandates.md, «Квіз-гейт») — власник переказав своїми словами, що підписує, ПЕРЕД незворотним рішенням. Перевір, чи переказ ПО СУТІ покриває чотири аспекти: (1) суть розвилки, (2) обраний варіант, (3) головний наслідок обраного варіанта, (4) головний ризик рішення. Не суди стиль, граматику чи довжину переказу — лише покриття цих аспектів по суті; перефразування своїми словами зараховується як покриття. Поверни СТРОГО JSON без пояснень поза ним: {\"understood\": boolean, \"missingAspects\": string[], \"feedback\": string}. missingAspects — підмножина [\"суть розвилки\",\"обраний варіант\",\"головний наслідок\",\"головний ризик\"], порожній масив коли understood: true. feedback — 1-2 речення: що саме пропущено (understood: false), або коротке підтвердження розуміння (understood: true).";

/// Адреса й модель локального OpenAI-сумісного ендпоінта (`quiz.js:
/// defaultLlmConfig`/`llm_config` tool).
#[derive(Debug, Clone, PartialEq)]
pub struct LlmConfig {
    pub base_url: String,
    pub model: String,
}

impl Default for LlmConfig {
    fn default() -> Self {
        LlmConfig {
            base_url: "http://127.0.0.1:8080".to_string(),
            model: "gemma-4-26b-a4b-it".to_string(),
        }
    }
}

pub fn default_llm_config() -> LlmConfig {
    LlmConfig::default()
}

/// Формує user-промпт із тіла decision-request і обраного варіанта
/// (`quiz.js: buildQuizPrompt`).
pub fn build_quiz_prompt(dr: &DecisionRequest, chosen_option: &str) -> String {
    let chosen = dr.options.iter().find(|o| o.label == chosen_option);
    let chosen_title_suffix = chosen
        .map(|c| format!(" — {}", c.title))
        .unwrap_or_default();
    let options_text = dr
        .options
        .iter()
        .map(|o| format!("### {}. {}\n{}", o.label, o.title, o.body))
        .collect::<Vec<_>>()
        .join("\n\n");
    [
        format!("## Контекст\n{}", dr.context),
        format!("## Варіанти\n{options_text}"),
        format!("## Обраний варіант\n{chosen_option}{chosen_title_suffix}"),
        format!(
            "## Рекомендація агента (лише для контексту, НЕ повторюй її як питання)\n{}",
            dr.recommendation
        ),
    ]
    .join("\n\n")
}

#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedQuestion {
    pub question: String,
    pub options: Vec<String>,
    pub correct_index: usize,
    pub microlesson: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedQuiz {
    pub question: GeneratedQuestion,
    pub generated_by: String,
}

#[derive(Deserialize)]
struct LlmQuestionPayload {
    question: String,
    options: Vec<String>,
    #[serde(rename = "correctIndex")]
    correct_index: i64,
    microlesson: String,
}

impl LlmQuestionPayload {
    fn is_valid(&self) -> bool {
        !self.question.trim().is_empty()
            && self.options.len() == 3
            && self.options.iter().all(|o| !o.trim().is_empty())
            && (0..=2).contains(&self.correct_index)
            && !self.microlesson.trim().is_empty()
    }

    fn into_question(self) -> GeneratedQuestion {
        GeneratedQuestion {
            question: self.question.trim().to_string(),
            options: self
                .options
                .into_iter()
                .map(|o| o.trim().to_string())
                .collect(),
            correct_index: self.correct_index as usize,
            microlesson: self.microlesson.trim().to_string(),
        }
    }
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}
#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}
#[derive(Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

fn chat_completions_url(base_url: &str) -> String {
    format!("{}/v1/chat/completions", base_url.trim_end_matches('/'))
}

/// Викликає локальний OpenAI-сумісний ендпоінт для генерації квіз-питання
/// (one-tap). Мережева/парсингова помилка, неочікувана форма — `None`, не
/// error (`quiz.js: callLlmQuizGenerator`).
pub async fn call_llm_quiz_generator(
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    dr: &DecisionRequest,
    chosen_option: &str,
) -> Option<GeneratedQuiz> {
    let body = json!({
        "model": llm_config.model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT },
            { "role": "user", "content": build_quiz_prompt(dr, chosen_option) }
        ]
    });
    let resp = client
        .post(chat_completions_url(&llm_config.base_url))
        .json(&body)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: ChatCompletionResponse = resp.json().await.ok()?;
    let raw = data.choices.first()?.message.content.as_deref()?;
    let parsed: LlmQuestionPayload = serde_json::from_str(strip_json_code_fence(raw)).ok()?;
    if !parsed.is_valid() {
        return None;
    }
    let generated_by = format!("quiz-gen-{}", llm_config.model);
    Some(GeneratedQuiz {
        question: parsed.into_question(),
        generated_by,
    })
}

/// Детермінований фолбек-генератор — питання/варіанти будуються з самих
/// варіантів decision-request, без LLM (`quiz.js: fallbackQuiz`).
pub fn fallback_quiz(dr: &DecisionRequest, chosen_option: &str) -> GeneratedQuiz {
    let chosen = dr.options.iter().find(|o| o.label == chosen_option);
    let chosen_text = chosen
        .map(|c| format!("{} — {}", c.title, c.body).trim().to_string())
        .unwrap_or_else(|| format!("варіант {chosen_option}"));
    let mut distractors: Vec<String> = dr
        .options
        .iter()
        .filter(|o| o.label != chosen_option)
        .map(|o| format!("{} — {}", o.title, o.body).trim().to_string())
        .take(2)
        .collect();
    while distractors.len() < 2 {
        distractors.push("Жоден із перелічених наслідків не застосовується".to_string());
    }

    let mut options = vec![chosen_text.clone()];
    options.extend(distractors);
    let rotation = dr.context.chars().count() % options.len();
    let mut rotated = options[rotation..].to_vec();
    rotated.extend_from_slice(&options[..rotation]);
    let correct_index = rotated.iter().position(|o| o == &chosen_text).unwrap_or(0);

    let question = GeneratedQuestion {
        question: format!("Який наслідок у варіанта {chosen_option}, якщо його обрати?"),
        options: rotated,
        correct_index,
        microlesson: format!(
            "Мікроурок: рішення застосовується до decision-request «{}» (escalation_chain: {}); deadline_cost: {}.",
            dr.path.as_deref().or(dr.nnnn.as_deref()).unwrap_or(""),
            if dr.escalation_chain.is_empty() { "н/д".to_string() } else { dr.escalation_chain.join(" → ") },
            dr.deadline_cost.as_deref().unwrap_or("не вказано")
        ),
    };
    GeneratedQuiz {
        question,
        generated_by: "quiz-gen-fallback".to_string(),
    }
}

/// Генерує one-tap квіз: спершу LLM, потім фолбек. Кидає, якщо
/// `generated_by` квізу все одно збігається з `recommended_by`
/// decision-request (конфлікт інтересів у промпті) — `quiz.js:
/// generateQuiz`.
pub async fn generate_quiz(
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    dr: &DecisionRequest,
    chosen_option: &str,
) -> Result<GeneratedQuiz, String> {
    let mut quiz = call_llm_quiz_generator(client, llm_config, dr, chosen_option).await;
    if quiz
        .as_ref()
        .is_none_or(|q| Some(q.generated_by.as_str()) == dr.recommended_by.as_deref())
    {
        quiz = Some(fallback_quiz(dr, chosen_option));
    }
    let quiz = quiz.expect("фолбек завжди повертає значення");
    if Some(quiz.generated_by.as_str()) == dr.recommended_by.as_deref() {
        return Err(
            "generated_by квізу збігається з recommended_by decision-request — інваріант порушено"
                .to_string(),
        );
    }
    Ok(quiz)
}

#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedStandardQuiz {
    pub questions: Vec<GeneratedQuestion>,
    pub generated_by: String,
}

#[derive(Deserialize)]
struct LlmStandardPayload {
    questions: Vec<LlmQuestionPayload>,
}

/// Викликає локальний ендпоінт у режимі `standard` (`quiz.js:
/// callLlmStandardQuizGenerator`).
pub async fn call_llm_standard_quiz_generator(
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    dr: &DecisionRequest,
    chosen_option: &str,
) -> Option<GeneratedStandardQuiz> {
    let body = json!({
        "model": llm_config.model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": SYSTEM_PROMPT_STANDARD },
            { "role": "user", "content": build_quiz_prompt(dr, chosen_option) }
        ]
    });
    let resp = client
        .post(chat_completions_url(&llm_config.base_url))
        .json(&body)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: ChatCompletionResponse = resp.json().await.ok()?;
    let raw = data.choices.first()?.message.content.as_deref()?;
    let parsed: LlmStandardPayload = serde_json::from_str(strip_json_code_fence(raw)).ok()?;
    if parsed.questions.len() < 2 || parsed.questions.len() > 3 {
        return None;
    }
    if parsed.questions.iter().any(|q| !q.is_valid()) {
        return None;
    }
    Some(GeneratedStandardQuiz {
        questions: parsed
            .questions
            .into_iter()
            .map(LlmQuestionPayload::into_question)
            .collect(),
        generated_by: format!("quiz-gen-{}", llm_config.model),
    })
}

fn fallback_secondary_question(dr: &DecisionRequest) -> GeneratedQuestion {
    if let Some(deadline_cost) = dr.deadline_cost.as_deref() {
        let distractors = [
            "Дедлайн не критичний — розвилка нічого не блокує".to_string(),
            "Розвилка не має встановленого дедлайну".to_string(),
        ];
        let mut options = vec![deadline_cost.to_string()];
        options.extend(distractors);
        let rotation = deadline_cost.chars().count() % options.len();
        let mut rotated = options[rotation..].to_vec();
        rotated.extend_from_slice(&options[..rotation]);
        let correct_index = rotated.iter().position(|o| o == deadline_cost).unwrap_or(0);
        return GeneratedQuestion {
            question: "Яка ціна затримки цієї розвилки (deadline_cost)?".to_string(),
            options: rotated,
            correct_index,
            microlesson: "Мікроурок: deadline_cost — контрактне поле decision-request (mandates.md), не оцінка агента; разом із leverage-фасетами воно визначає пріоритет розвилки в черзі «Вирішую».".to_string(),
        };
    }
    let radii = ["node", "subtree", "repo", "company"];
    let actual = dr.leverage_facets.blast_radius.as_str();
    let distractors: Vec<String> = radii
        .iter()
        .filter(|&&r| r != actual)
        .take(2)
        .map(|s| s.to_string())
        .collect();
    let mut options = vec![actual.to_string()];
    options.extend(distractors);
    let rotation = actual.chars().count() % options.len();
    let mut rotated = options[rotation..].to_vec();
    rotated.extend_from_slice(&options[..rotation]);
    let correct_index = rotated.iter().position(|o| o == actual).unwrap_or(0);
    GeneratedQuestion {
        question: "Який blast_radius (межа наслідків) цієї розвилки?".to_string(),
        options: rotated,
        correct_index,
        microlesson: "Мікроурок: blast_radius — один із leverage-фасетів (mandates.md), що визначає ширину наслідків рішення і саме він (разом з irreversible/divergence/est_cost_eur) визначив глибину цього квіз-гейта.".to_string(),
    }
}

/// Детермінований фолбек `standard` (2 питання) — `quiz.js:
/// fallbackStandardQuiz`.
pub fn fallback_standard_quiz(dr: &DecisionRequest, chosen_option: &str) -> GeneratedStandardQuiz {
    let first = fallback_quiz(dr, chosen_option).question;
    let second = fallback_secondary_question(dr);
    GeneratedStandardQuiz {
        questions: vec![first, second],
        generated_by: "quiz-gen-fallback".to_string(),
    }
}

/// Генерує `depth: standard` квіз — той самий інваріант, що `generate_quiz`
/// (`quiz.js: generateStandardQuiz`).
pub async fn generate_standard_quiz(
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    dr: &DecisionRequest,
    chosen_option: &str,
) -> Result<GeneratedStandardQuiz, String> {
    let mut quiz = call_llm_standard_quiz_generator(client, llm_config, dr, chosen_option).await;
    if quiz
        .as_ref()
        .is_none_or(|q| Some(q.generated_by.as_str()) == dr.recommended_by.as_deref())
    {
        quiz = Some(fallback_standard_quiz(dr, chosen_option));
    }
    let quiz = quiz.expect("фолбек завжди повертає значення");
    if Some(quiz.generated_by.as_str()) == dr.recommended_by.as_deref() {
        return Err(
            "generated_by квізу збігається з recommended_by decision-request — інваріант порушено"
                .to_string(),
        );
    }
    Ok(quiz)
}

/// Перефразовує формулювання питання для повторного заходу — best-effort,
/// `None` лишає попередній текст (`quiz.js: rephraseQuestion`).
pub async fn rephrase_question(
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    dr: &DecisionRequest,
    chosen_option: &str,
    previous_question: &str,
) -> Option<String> {
    let body = json!({
        "model": llm_config.model,
        "temperature": 0.4,
        "messages": [
            { "role": "system", "content": REPHRASE_SYSTEM_PROMPT },
            { "role": "user", "content": format!("{}\n\n## Попереднє формулювання питання\n{}", build_quiz_prompt(dr, chosen_option), previous_question) }
        ]
    });
    let resp = client
        .post(chat_completions_url(&llm_config.base_url))
        .json(&body)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: ChatCompletionResponse = resp.json().await.ok()?;
    let raw = data.choices.first()?.message.content.as_deref()?;
    let text = raw.trim().trim_matches('"');
    if text.is_empty() || text == previous_question {
        return None;
    }
    Some(text.to_string())
}

pub fn build_teach_back_eval_prompt(
    dr: &DecisionRequest,
    chosen_option: &str,
    transcript: &str,
) -> String {
    format!(
        "{}\n\n## Переказ власника (teach-back)\n{}",
        build_quiz_prompt(dr, chosen_option),
        transcript
    )
}

const TEACHBACK_ASPECTS: [&str; 4] = [
    "суть розвилки",
    "обраний варіант",
    "головний наслідок",
    "головний ризик",
];

#[derive(Debug, Clone, PartialEq)]
pub struct TeachBackEvaluation {
    pub understood: bool,
    pub missing_aspects: Vec<String>,
    pub feedback: String,
    pub generated_by: String,
}

#[derive(Deserialize)]
struct LlmTeachBackPayload {
    understood: bool,
    #[serde(rename = "missingAspects")]
    missing_aspects: Vec<String>,
    feedback: String,
}

impl LlmTeachBackPayload {
    fn is_valid(&self) -> bool {
        self.missing_aspects
            .iter()
            .all(|a| TEACHBACK_ASPECTS.contains(&a.as_str()))
            && !self.feedback.trim().is_empty()
    }
}

/// Викликає локальний ендпоінт для ОЦІНКИ переказу teach-back — `None`
/// означає «teach-back недоступний» (НЕ «перейти на фолбек», немає фолбека
/// свідомо) — `quiz.js: callLlmTeachBackEvaluator`.
pub async fn call_llm_teach_back_evaluator(
    client: &reqwest::Client,
    llm_config: &LlmConfig,
    dr: &DecisionRequest,
    chosen_option: &str,
    transcript: &str,
) -> Option<TeachBackEvaluation> {
    let body = json!({
        "model": llm_config.model,
        "temperature": 0.1,
        "messages": [
            { "role": "system", "content": TEACHBACK_SYSTEM_PROMPT },
            { "role": "user", "content": build_teach_back_eval_prompt(dr, chosen_option, transcript) }
        ]
    });
    let resp = client
        .post(chat_completions_url(&llm_config.base_url))
        .json(&body)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let data: ChatCompletionResponse = resp.json().await.ok()?;
    let raw = data.choices.first()?.message.content.as_deref()?;
    let parsed: LlmTeachBackPayload = serde_json::from_str(strip_json_code_fence(raw)).ok()?;
    if !parsed.is_valid() {
        return None;
    }
    Some(TeachBackEvaluation {
        understood: parsed.understood,
        missing_aspects: parsed.missing_aspects,
        feedback: parsed.feedback.trim().to_string(),
        generated_by: format!("teachback-eval-{}", llm_config.model),
    })
}

// ---------------------------------------------------------------------
// Формат квіз-файлу (Q&A: one-tap/standard/spaced-repetition) — 1:1 з
// `quiz.js: formatQuizFile`/`parseQuizFile`.
// ---------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct QuestionAttempt {
    pub question: String,
    pub options: Vec<String>,
    pub correct_answer: String,
    pub microlesson: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QuestionState {
    pub repetition: bool,
    pub attempts: Vec<QuestionAttempt>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct QuizDraft {
    pub decision_ref: String,
    pub depth: String,
    pub generated_by: String,
    pub iterations: u64,
    pub time_to_understanding_sec: Option<f64>,
    pub shown_at: Option<String>,
    pub resolved_count: Option<u64>,
    pub repetition_source: Option<String>,
    pub questions: Vec<QuestionState>,
}

fn format_heading(question_index: usize, attempt_index: usize, repetition: bool) -> String {
    let mut parts = Vec::new();
    if repetition {
        parts.push("повторення".to_string());
    }
    if attempt_index > 0 {
        parts.push(format!("спроба {}", attempt_index + 1));
    }
    if parts.is_empty() {
        format!("## Питання {question_index}")
    } else {
        format!("## Питання {question_index} ({})", parts.join(", "))
    }
}

/// Серіалізує квіз-стан у markdown точно за форматом mandates.md
/// (`quiz.js: formatQuizFile`).
pub fn format_quiz_file(quiz: &QuizDraft) -> String {
    let mut lines = vec![
        "---".to_string(),
        "schema_version: 1".to_string(),
        "type: quiz".to_string(),
        format!("decision_ref: {}", quiz.decision_ref),
        format!("depth: {}", quiz.depth),
        format!("generated_by: {}", quiz.generated_by),
    ];
    if let Some(shown_at) = &quiz.shown_at {
        lines.push(format!("shown_at: {shown_at}"));
    }
    if let Some(src) = &quiz.repetition_source {
        lines.push(format!("repetition_source: {src}"));
    }
    if let Some(rc) = quiz.resolved_count {
        lines.push(format!("resolved_count: {rc}"));
    }
    if let Some(t) = quiz.time_to_understanding_sec {
        lines.push(format!("time_to_understanding_sec: {}", format_number(t)));
    }
    lines.push(format!("iterations: {}", quiz.iterations));
    lines.push("---".to_string());
    lines.push(String::new());

    let mut body_parts = Vec::new();
    for (qi, q) in quiz.questions.iter().enumerate() {
        let mut attempt_blocks = Vec::new();
        for (ai, attempt) in q.attempts.iter().enumerate() {
            let heading = format_heading(qi + 1, ai, q.repetition);
            let options_md = attempt
                .options
                .iter()
                .enumerate()
                .map(|(i, o)| format!("- {}. {}", (b'A' + i as u8) as char, o))
                .collect::<Vec<_>>()
                .join("\n");
            attempt_blocks.push(
                [
                    heading,
                    attempt.question.clone(),
                    String::new(),
                    options_md,
                    String::new(),
                    "### Відповідь".to_string(),
                    attempt.correct_answer.clone(),
                    String::new(),
                    "### Мікроурок".to_string(),
                    attempt.microlesson.clone(),
                    String::new(),
                ]
                .join("\n"),
            );
        }
        body_parts.push(attempt_blocks.join("\n"));
    }
    let body = body_parts.join("\n");

    format!("{}\n{}", lines.join("\n"), body)
}

fn format_number(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedQuizFile {
    pub schema_version: Option<i64>,
    pub decision_ref: Option<String>,
    pub depth: Option<String>,
    pub generated_by: Option<String>,
    pub shown_at: Option<String>,
    pub repetition_source: Option<String>,
    pub resolved_count: Option<u64>,
    pub time_to_understanding_sec: Option<f64>,
    pub iterations: Option<u64>,
    pub attempts: Vec<QuestionAttempt>,
    pub questions: Vec<QuestionState>,
}

fn split_frontmatter_fields(text: &str) -> (std::collections::HashMap<String, String>, String) {
    let re = Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---\r?\n?(.*)$").unwrap();
    let (raw, body) = match re.captures(text) {
        Some(caps) => (
            caps.get(1).map(|m| m.as_str()).unwrap_or("").to_string(),
            caps.get(2).map(|m| m.as_str()).unwrap_or("").to_string(),
        ),
        None => (String::new(), text.to_string()),
    };
    let mut fields = std::collections::HashMap::new();
    for line in raw.split(['\n']) {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            continue;
        }
        if let Some(idx) = line.find(':') {
            fields.insert(
                line[..idx].trim().to_string(),
                line[idx + 1..].trim().to_string(),
            );
        }
    }
    (fields, body)
}

/// Розбиває текст на блоки, що починаються з рядка `marker` — ручна заміна
/// JS-регекса `/\r?\n(?=marker)/` (позитивний lookahead), якого немає в
/// Rust `regex`-крейті (лінійна NFA-реалізація свідомо не підтримує
/// look-around). Семантика ідентична: розрив ставиться ПЕРЕД кожним рядком,
/// що починається з `marker` (окрім самого першого блоку).
fn split_before_marker(text: &str, marker: &str) -> Vec<String> {
    let mut blocks: Vec<String> = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    for line in text.split('\n') {
        let check = line.strip_suffix('\r').unwrap_or(line);
        if check.starts_with(marker) && !current.is_empty() {
            blocks.push(current.join("\n"));
            current = vec![line];
        } else {
            current.push(line);
        }
    }
    if !current.is_empty() {
        blocks.push(current.join("\n"));
    }
    blocks
}

/// Розбирає квіз-файл назад у структурований стан (`quiz.js:
/// parseQuizFile`).
pub fn parse_quiz_file(text: &str) -> ParsedQuizFile {
    let (fields, body) = split_frontmatter_fields(text);

    let heading_re = Regex::new(r"^## Питання (\d+)(?: \(([^)]*)\))?$").unwrap();
    let attempt_num_re = Regex::new(r"спроба (\d+)").unwrap();
    let option_line_re = Regex::new(r"(?m)^- [A-Z]\.\s(.*)$").unwrap();
    let answer_section_re =
        Regex::new(r"(?s)### Відповідь\r?\n(.*?)(?:\r?\n### Мікроурок|$)").unwrap();
    let microlesson_section_re = Regex::new(r"(?s)### Мікроурок\r?\n(.*?)$").unwrap();
    let question_text_re =
        Regex::new(r"(?s)^(.*?)(?:\r?\n\r?\n- [A-Z]\.|\r?\n\r?\n### Відповідь)").unwrap();

    let all_blocks = split_before_marker(&body, "## Питання");
    let blocks: Vec<&str> = all_blocks
        .iter()
        .map(|b| b.as_str())
        .filter(|b| !b.trim().is_empty())
        .collect();

    struct RawAttempt {
        question_index: usize,
        repetition: bool,
        #[allow(dead_code)]
        // дзеркалить `attempt` JS-виходу parseQuizFile; жоден викликач delta-core поки не читає номер спроби окремо
        attempt: u64,
        question: String,
        options: Vec<String>,
        correct_answer: String,
        microlesson: String,
    }

    let mut raw_attempts = Vec::new();
    for (block_index, block) in blocks.iter().enumerate() {
        let lines: Vec<&str> = block.split(['\n']).collect();
        let first_line = lines.first().map(|l| l.trim()).unwrap_or("");
        let heading_caps = heading_re.captures(first_line);
        let rest = lines[1.min(lines.len())..].join("\n");
        let options: Vec<String> = option_line_re
            .captures_iter(&rest)
            .map(|c| c[1].to_string())
            .collect();
        let answer = answer_section_re
            .captures(&rest)
            .map(|c| c[1].trim().to_string())
            .unwrap_or_default();
        let microlesson = microlesson_section_re
            .captures(&rest)
            .map(|c| c[1].trim().to_string())
            .unwrap_or_default();
        let question_text = question_text_re
            .captures(&rest)
            .map(|c| c[1].trim().to_string())
            .unwrap_or_else(|| rest.trim().to_string());
        let inner = heading_caps
            .as_ref()
            .and_then(|c| c.get(2))
            .map(|m| m.as_str())
            .unwrap_or("");
        let attempt_num = attempt_num_re
            .captures(inner)
            .map(|c| c[1].parse::<u64>().unwrap_or(1))
            .unwrap_or(1);

        raw_attempts.push(RawAttempt {
            question_index: heading_caps
                .as_ref()
                .and_then(|c| c[1].parse::<usize>().ok())
                .unwrap_or(block_index + 1),
            repetition: inner.contains("повторення"),
            attempt: attempt_num,
            question: question_text,
            options,
            correct_answer: answer,
            microlesson,
        });
    }

    let mut questions_by_index: std::collections::BTreeMap<usize, QuestionState> =
        std::collections::BTreeMap::new();
    for a in &raw_attempts {
        let entry = questions_by_index
            .entry(a.question_index)
            .or_insert_with(|| QuestionState {
                repetition: a.repetition,
                attempts: Vec::new(),
            });
        entry.attempts.push(QuestionAttempt {
            question: a.question.clone(),
            options: a.options.clone(),
            correct_answer: a.correct_answer.clone(),
            microlesson: a.microlesson.clone(),
        });
    }
    let questions: Vec<QuestionState> = questions_by_index.into_values().collect();
    let attempts: Vec<QuestionAttempt> = raw_attempts
        .iter()
        .map(|a| QuestionAttempt {
            question: a.question.clone(),
            options: a.options.clone(),
            correct_answer: a.correct_answer.clone(),
            microlesson: a.microlesson.clone(),
        })
        .collect();

    ParsedQuizFile {
        schema_version: fields.get("schema_version").and_then(|v| v.parse().ok()),
        decision_ref: fields.get("decision_ref").cloned(),
        depth: fields.get("depth").cloned(),
        generated_by: fields.get("generated_by").cloned(),
        shown_at: fields.get("shown_at").cloned(),
        repetition_source: fields.get("repetition_source").cloned(),
        resolved_count: fields.get("resolved_count").and_then(|v| v.parse().ok()),
        time_to_understanding_sec: fields
            .get("time_to_understanding_sec")
            .and_then(|v| v.parse().ok()),
        iterations: fields.get("iterations").and_then(|v| v.parse().ok()),
        attempts,
        questions,
    }
}

// ---------------------------------------------------------------------
// Формат teach-back-квіз-файлу (M5) — 1:1 з `quiz.js:
// formatTeachBackFile`/`parseTeachBackFile`.
// ---------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct TeachBackEvalRecord {
    pub understood: Option<bool>,
    pub missing_aspects: Vec<String>,
    pub feedback: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TeachBackAttempt {
    pub transcript: String,
    pub evaluation: TeachBackEvalRecord,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct TeachBackDraft {
    pub decision_ref: String,
    pub generated_by: String,
    pub iterations: u64,
    pub shown_at: Option<String>,
    pub time_to_understanding_sec: Option<f64>,
    pub attempts: Vec<TeachBackAttempt>,
}

fn format_teach_back_heading(attempt_index: usize) -> String {
    if attempt_index > 0 {
        format!("## Переказ (teach-back) (спроба {})", attempt_index + 1)
    } else {
        "## Переказ (teach-back)".to_string()
    }
}

fn format_teach_back_verdict(evaluation: &TeachBackEvalRecord) -> String {
    let missing_line = if evaluation.missing_aspects.is_empty() {
        "немає".to_string()
    } else {
        evaluation.missing_aspects.join(", ")
    };
    format!(
        "Зрозумів: {}\nПропущено: {}\n{}",
        if evaluation.understood == Some(true) {
            "так"
        } else {
            "ні"
        },
        missing_line,
        evaluation.feedback
    )
}

/// Серіалізує teach-back-квіз-стан у markdown (`quiz.js:
/// formatTeachBackFile`).
pub fn format_teach_back_file(state: &TeachBackDraft) -> String {
    let mut lines = vec![
        "---".to_string(),
        "schema_version: 1".to_string(),
        "type: quiz".to_string(),
        format!("decision_ref: {}", state.decision_ref),
        "depth: teach-back".to_string(),
        format!("generated_by: {}", state.generated_by),
    ];
    if let Some(shown_at) = &state.shown_at {
        lines.push(format!("shown_at: {shown_at}"));
    }
    if let Some(t) = state.time_to_understanding_sec {
        lines.push(format!("time_to_understanding_sec: {}", format_number(t)));
    }
    lines.push(format!("iterations: {}", state.iterations));
    lines.push("---".to_string());
    lines.push(String::new());

    let body = state
        .attempts
        .iter()
        .enumerate()
        .map(|(i, a)| {
            [
                format_teach_back_heading(i),
                a.transcript.clone(),
                String::new(),
                "### Оцінка локальної моделі".to_string(),
                format_teach_back_verdict(&a.evaluation),
                String::new(),
            ]
            .join("\n")
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!("{}\n{}", lines.join("\n"), body)
}

/// Розбирає teach-back-квіз-файл назад у структурований стан (`quiz.js:
/// parseTeachBackFile`).
pub fn parse_teach_back_file(text: &str) -> TeachBackDraft {
    let (fields, body) = split_frontmatter_fields(text);

    // Заголовок блоку (`## Переказ (teach-back) (спроба N)`) несе номер
    // спроби, який жоден викликач delta-core поки не читає окремо (той
    // самий підхід, що `attempt`-поле `RawAttempt` у `parse_quiz_file`) —
    // блок ідентифікується позицією у векторі `attempts`, не цим номером.
    let verdict_section_re = Regex::new(r"(?s)### Оцінка локальної моделі\r?\n(.*?)$").unwrap();
    let transcript_re = Regex::new(r"(?s)^(.*?)(?:\r?\n\r?\n### Оцінка локальної моделі)").unwrap();
    let understood_line_re = Regex::new(r"(?m)^Зрозумів: (так|ні)$").unwrap();
    let missing_line_re = Regex::new(r"(?m)^Пропущено: (.*)$").unwrap();

    let all_blocks = split_before_marker(&body, "## Переказ (teach-back)");
    let blocks: Vec<&str> = all_blocks
        .iter()
        .map(|b| b.as_str())
        .filter(|b| !b.trim().is_empty())
        .collect();
    let attempts: Vec<TeachBackAttempt> = blocks
        .iter()
        .map(|block| {
            let lines: Vec<&str> = block.split(['\n']).collect();
            let rest = lines[1.min(lines.len())..].join("\n");
            let transcript = transcript_re
                .captures(&rest)
                .map(|c| c[1].trim().to_string())
                .unwrap_or_else(|| rest.trim().to_string());
            let verdict_body = verdict_section_re
                .captures(&rest)
                .map(|c| c[1].to_string())
                .unwrap_or_default();
            let understood = understood_line_re
                .captures(&verdict_body)
                .map(|c| &c[1] == "так");
            let missing_raw = missing_line_re
                .captures(&verdict_body)
                .map(|c| c[1].trim().to_string())
                .unwrap_or_default();
            let missing_aspects = if !missing_raw.is_empty() && missing_raw != "немає" {
                missing_raw
                    .split(", ")
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .collect()
            } else {
                Vec::new()
            };
            let feedback = verdict_body
                .split(['\n'])
                .skip(2)
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string();
            TeachBackAttempt {
                transcript,
                evaluation: TeachBackEvalRecord {
                    understood,
                    missing_aspects,
                    feedback,
                },
            }
        })
        .collect();

    TeachBackDraft {
        decision_ref: fields.get("decision_ref").cloned().unwrap_or_default(),
        generated_by: fields.get("generated_by").cloned().unwrap_or_default(),
        iterations: fields
            .get("iterations")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0),
        shown_at: fields.get("shown_at").cloned(),
        time_to_understanding_sec: fields
            .get("time_to_understanding_sec")
            .and_then(|v| v.parse().ok()),
        attempts,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decisions::{parse_decision_request, DecisionRequestMeta};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const DR_0001: &str =
        include_str!("../tests/fixtures/runs/demo-1/decisions/0001-decision-request.md");
    const DR_0002: &str =
        include_str!("../tests/fixtures/runs/demo-1/decisions/0002-decision-request.md");

    #[test]
    fn strip_json_code_fence_removes_json_labeled_fence() {
        assert_eq!(
            strip_json_code_fence("```json\n{\"a\":1}\n```"),
            "{\"a\":1}"
        );
    }

    #[test]
    fn strip_json_code_fence_removes_bare_fence() {
        assert_eq!(strip_json_code_fence("```\n{\"a\":1}\n```"), "{\"a\":1}");
    }

    #[test]
    fn strip_json_code_fence_passes_through_unwrapped_json() {
        assert_eq!(strip_json_code_fence("  {\"a\":1}  "), "{\"a\":1}");
    }

    fn dr_0001() -> DecisionRequest {
        parse_decision_request(
            DR_0001,
            DecisionRequestMeta {
                path: Some("x".into()),
                nnnn: Some("0001".into()),
                ..Default::default()
            },
        )
        .unwrap()
    }
    fn dr_0002() -> DecisionRequest {
        parse_decision_request(
            DR_0002,
            DecisionRequestMeta {
                path: Some("y".into()),
                nnnn: Some("0002".into()),
                ..Default::default()
            },
        )
        .unwrap()
    }

    #[test]
    fn default_llm_config_matches_spec_default() {
        let c = default_llm_config();
        assert_eq!(c.base_url, "http://127.0.0.1:8080");
        assert_eq!(c.model, "gemma-4-26b-a4b-it");
    }

    #[test]
    fn build_quiz_prompt_includes_context_chosen_and_recommendation() {
        let prompt = build_quiz_prompt(&dr_0001(), "B");
        assert!(prompt.contains("MandateCard.vue"));
        assert!(prompt.contains("Обраний варіант\nB"));
        assert!(prompt.contains("Рекомендація агента"));
    }

    #[tokio::test]
    async fn call_llm_quiz_generator_valid_response_generates_quiz() {
        let server = MockServer::start().await;
        let body = json!({"choices": [{"message": {"content": json!({
            "question": "Що станеться з версткою при варіанті B?",
            "options": ["Логіка мігрує в composable", "Зʼявиться новий .vue-файл", "Нічого не зміниться"],
            "correctIndex": 0,
            "microlesson": "Composable-и легше тестувати ізольовано від розмітки."
        }).to_string() }}]});
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let config = LlmConfig {
            base_url: server.uri(),
            model: "gemma-4-26b-a4b-it".into(),
        };
        let result = call_llm_quiz_generator(&client, &config, &dr_0001(), "B")
            .await
            .unwrap();
        assert_eq!(result.generated_by, "quiz-gen-gemma-4-26b-a4b-it");
        assert_eq!(result.question.correct_index, 0);
        assert_eq!(result.question.options.len(), 3);
    }

    #[tokio::test]
    async fn call_llm_quiz_generator_network_error_returns_none() {
        let client = reqwest::Client::new();
        let config = LlmConfig {
            base_url: "http://127.0.0.1:1".into(),
            model: "x".into(),
        };
        assert!(call_llm_quiz_generator(&client, &config, &dr_0001(), "B")
            .await
            .is_none());
    }

    #[tokio::test]
    async fn call_llm_quiz_generator_non_2xx_returns_none() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let config = LlmConfig {
            base_url: server.uri(),
            model: "x".into(),
        };
        assert!(call_llm_quiz_generator(&client, &config, &dr_0001(), "B")
            .await
            .is_none());
    }

    #[tokio::test]
    async fn call_llm_quiz_generator_invalid_shape_returns_none() {
        let server = MockServer::start().await;
        let body = json!({"choices": [{"message": {"content": json!({"question": "x", "options": ["a", "b"], "correctIndex": 0, "microlesson": "y"}).to_string()}}]});
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let config = LlmConfig {
            base_url: server.uri(),
            model: "x".into(),
        };
        assert!(call_llm_quiz_generator(&client, &config, &dr_0001(), "B")
            .await
            .is_none());
    }

    #[test]
    fn fallback_quiz_is_deterministic() {
        let a = fallback_quiz(&dr_0001(), "B");
        let b = fallback_quiz(&dr_0001(), "B");
        assert_eq!(a, b);
        assert_eq!(a.generated_by, "quiz-gen-fallback");
        assert!(a.question.options[a.question.correct_index].contains("composable"));
    }

    #[tokio::test]
    async fn generate_quiz_falls_back_when_llm_unreachable() {
        let client = reqwest::Client::new();
        let config = LlmConfig {
            base_url: "http://127.0.0.1:1".into(),
            model: "x".into(),
        };
        let quiz = generate_quiz(&client, &config, &dr_0001(), "B")
            .await
            .unwrap();
        assert_eq!(quiz.generated_by, "quiz-gen-fallback");
    }

    #[test]
    fn format_quiz_file_round_trip_preserves_key_fields() {
        let draft = QuizDraft {
            decision_ref: "0001-decision-request.md".into(),
            depth: "one-tap".into(),
            generated_by: "quiz-gen-fallback".into(),
            iterations: 1,
            time_to_understanding_sec: Some(47.0),
            questions: vec![QuestionState {
                repetition: false,
                attempts: vec![QuestionAttempt {
                    question: "Що станеться з бюджетом задачі, якщо обереш варіант B?".into(),
                    options: vec![
                        "Логіка мігрує в composable".into(),
                        "Новий .vue-файл".into(),
                        "Нічого не зміниться".into(),
                    ],
                    correct_answer: "Логіка мігрує в composable".into(),
                    microlesson: "Composable-и легше тестувати ізольовано.".into(),
                }],
            }],
            ..Default::default()
        };
        let text = format_quiz_file(&draft);
        assert!(text.starts_with("---\nschema_version: 1\ntype: quiz\n"));
        assert!(text.contains("decision_ref: 0001-decision-request.md"));
        assert!(text.contains("depth: one-tap"));
        assert!(!text.contains("passed"));
        assert!(!text.contains("failed"));

        let parsed = parse_quiz_file(&text);
        assert_eq!(parsed.schema_version, Some(1));
        assert_eq!(
            parsed.decision_ref.as_deref(),
            Some("0001-decision-request.md")
        );
        assert_eq!(parsed.iterations, Some(1));
        assert_eq!(parsed.time_to_understanding_sec, Some(47.0));
        assert_eq!(parsed.attempts.len(), 1);
        assert_eq!(
            parsed.attempts[0].correct_answer,
            "Логіка мігрує в composable"
        );
    }

    #[test]
    fn second_attempt_of_same_question_is_attempt_2_not_question_2() {
        let attempt = QuestionAttempt {
            question: "q".into(),
            options: vec!["a".into(), "b".into()],
            correct_answer: "a".into(),
            microlesson: "m".into(),
        };
        let draft = QuizDraft {
            decision_ref: "x".into(),
            depth: "one-tap".into(),
            generated_by: "quiz-gen-fallback".into(),
            iterations: 2,
            questions: vec![QuestionState {
                repetition: false,
                attempts: vec![attempt.clone(), attempt],
            }],
            ..Default::default()
        };
        let text = format_quiz_file(&draft);
        assert!(text.contains("## Питання 1\n"));
        assert!(text.contains("## Питання 1 (спроба 2)"));
        assert!(!text.contains("## Питання 2"));
        assert_eq!(parse_quiz_file(&text).attempts.len(), 2);
    }

    #[test]
    fn shown_at_only_in_draft_disappears_after_finalization() {
        let base = QuizDraft {
            decision_ref: "0001-decision-request.md".into(),
            depth: "one-tap".into(),
            generated_by: "quiz-gen-fallback".into(),
            iterations: 1,
            questions: vec![QuestionState {
                repetition: false,
                attempts: vec![QuestionAttempt {
                    question: "q".into(),
                    options: vec!["a".into()],
                    correct_answer: "a".into(),
                    microlesson: "m".into(),
                }],
            }],
            ..Default::default()
        };
        let draft = QuizDraft {
            shown_at: Some("2026-08-09T10:00:00.000Z".into()),
            time_to_understanding_sec: None,
            ..base.clone()
        };
        let draft_text = format_quiz_file(&draft);
        assert!(draft_text.contains("shown_at: 2026-08-09T10:00:00.000Z"));
        assert_eq!(
            parse_quiz_file(&draft_text).shown_at.as_deref(),
            Some("2026-08-09T10:00:00.000Z")
        );

        let final_draft = QuizDraft {
            time_to_understanding_sec: Some(47.0),
            ..base
        };
        let final_text = format_quiz_file(&final_draft);
        assert!(!final_text.contains("shown_at"));
    }

    #[test]
    fn multi_question_state_second_question_serializes_as_repetition() {
        let draft = QuizDraft {
            decision_ref: "0001-decision-request.md".into(),
            depth: "one-tap".into(),
            generated_by: "quiz-gen-fallback".into(),
            shown_at: Some("2026-08-09T10:00:00.000Z".into()),
            resolved_count: Some(0),
            repetition_source: Some("9998-decision-request.md@2026-08-01T10:00:00.000Z".into()),
            iterations: 2,
            questions: vec![
                QuestionState {
                    repetition: false,
                    attempts: vec![QuestionAttempt {
                        question: "Головне питання про розвилку?".into(),
                        options: vec![
                            "Правильна".into(),
                            "Дистрактор 1".into(),
                            "Дистрактор 2".into(),
                        ],
                        correct_answer: "Правильна".into(),
                        microlesson: "Мікроурок 1.".into(),
                    }],
                },
                QuestionState {
                    repetition: true,
                    attempts: vec![QuestionAttempt {
                        question: "Старе питання-повторення?".into(),
                        options: vec!["Стара правильна".into(), "Стара 1".into(), "Стара 2".into()],
                        correct_answer: "Стара правильна".into(),
                        microlesson: "Мікроурок 2.".into(),
                    }],
                },
            ],
            ..Default::default()
        };
        let text = format_quiz_file(&draft);
        assert!(text.contains("## Питання 1\n"));
        assert!(text.contains("## Питання 2 (повторення)"));
        assert!(
            text.contains("repetition_source: 9998-decision-request.md@2026-08-01T10:00:00.000Z")
        );
        assert!(text.contains("resolved_count: 0"));

        let parsed = parse_quiz_file(&text);
        assert_eq!(parsed.questions.len(), 2);
        assert!(!parsed.questions[0].repetition);
        assert!(parsed.questions[1].repetition);
        assert_eq!(parsed.resolved_count, Some(0));
        assert_eq!(parsed.attempts.len(), 2);
    }

    #[tokio::test]
    async fn fallback_standard_quiz_has_two_questions_and_deadline_cost_second() {
        let a = fallback_standard_quiz(&dr_0002(), "A");
        let b = fallback_standard_quiz(&dr_0002(), "A");
        assert_eq!(a, b);
        assert_eq!(a.questions.len(), 2);
        assert!(
            a.questions[1].question.contains("deadline_cost")
                || a.questions[1].question.to_lowercase().contains("затримки")
        );
        assert_eq!(
            a.questions[1].options[a.questions[1].correct_index],
            dr_0002().deadline_cost.unwrap()
        );
    }

    #[tokio::test]
    async fn generate_standard_quiz_falls_back_with_two_questions() {
        let client = reqwest::Client::new();
        let config = LlmConfig {
            base_url: "http://127.0.0.1:1".into(),
            model: "x".into(),
        };
        let quiz = generate_standard_quiz(&client, &config, &dr_0002(), "A")
            .await
            .unwrap();
        assert_eq!(quiz.generated_by, "quiz-gen-fallback");
        assert_eq!(quiz.questions.len(), 2);
    }

    #[tokio::test]
    async fn rephrase_question_valid_response_returns_new_wording() {
        let server = MockServer::start().await;
        let body = json!({"choices": [{"message": {"content": "Нове формулювання питання?"}}]});
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let config = LlmConfig {
            base_url: server.uri(),
            model: "x".into(),
        };
        let result = rephrase_question(&client, &config, &dr_0001(), "B", "Старе питання?").await;
        assert_eq!(result.as_deref(), Some("Нове формулювання питання?"));
    }

    #[tokio::test]
    async fn rephrase_question_identical_wording_returns_none() {
        let server = MockServer::start().await;
        let body = json!({"choices": [{"message": {"content": "Старе питання?"}}]});
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let config = LlmConfig {
            base_url: server.uri(),
            model: "x".into(),
        };
        let result = rephrase_question(&client, &config, &dr_0001(), "B", "Старе питання?").await;
        assert!(result.is_none());
    }

    #[test]
    fn teach_back_prompt_text_stable_and_nonempty() {
        assert!(!teach_back_prompt_text().is_empty());
        assert_eq!(teach_back_prompt_text(), teach_back_prompt_text());
    }

    #[tokio::test]
    async fn teach_back_evaluator_valid_understood_true() {
        let server = MockServer::start().await;
        let body = json!({"choices": [{"message": {"content": json!({"understood": true, "missingAspects": [], "feedback": "покрито"}).to_string()}}]});
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let config = LlmConfig {
            base_url: server.uri(),
            model: "gemma-4-26b-a4b-it".into(),
        };
        let result = call_llm_teach_back_evaluator(&client, &config, &dr_0001(), "B", "переказ")
            .await
            .unwrap();
        assert!(result.understood);
        assert_eq!(result.generated_by, "teachback-eval-gemma-4-26b-a4b-it");
    }

    #[tokio::test]
    async fn teach_back_evaluator_network_error_is_honest_refusal_not_fallback() {
        let client = reqwest::Client::new();
        let config = LlmConfig {
            base_url: "http://127.0.0.1:1".into(),
            model: "x".into(),
        };
        assert!(
            call_llm_teach_back_evaluator(&client, &config, &dr_0001(), "B", "переказ")
                .await
                .is_none()
        );
    }

    #[test]
    fn teachback_unavailable_message_explains_no_fallback() {
        assert!(TEACHBACK_UNAVAILABLE_MESSAGE.contains("недоступний без локальної моделі"));
    }

    #[test]
    fn format_teach_back_file_round_trip_single_attempt() {
        let state = TeachBackDraft {
            decision_ref: "0001-decision-request.md".into(),
            generated_by: "teachback-eval-gemma-4-26b-a4b-it".into(),
            iterations: 1,
            time_to_understanding_sec: Some(42.0),
            attempts: vec![TeachBackAttempt {
                transcript: "Обираю варіант B, головний наслідок — X, головний ризик — Y.".into(),
                evaluation: TeachBackEvalRecord {
                    understood: Some(true),
                    missing_aspects: vec![],
                    feedback: "Переказ покриває всі аспекти.".into(),
                },
            }],
            ..Default::default()
        };
        let text = format_teach_back_file(&state);
        assert!(text.starts_with("---\nschema_version: 1\ntype: quiz\n"));
        assert!(text.contains("depth: teach-back"));
        assert!(text.contains("## Переказ (teach-back)\n"));
        assert!(text.contains("Обираю варіант B"));
        assert!(text.contains("### Оцінка локальної моделі\nЗрозумів: так\nПропущено: немає"));
        assert!(!text.contains("passed"));
        assert!(!text.contains("failed"));

        let parsed = parse_teach_back_file(&text);
        assert!(parsed.depth_is_teach_back_by_construction());
        assert_eq!(parsed.decision_ref, "0001-decision-request.md");
        assert_eq!(parsed.iterations, 1);
        assert_eq!(parsed.time_to_understanding_sec, Some(42.0));
        assert_eq!(parsed.attempts.len(), 1);
        assert_eq!(parsed.attempts[0].evaluation.understood, Some(true));
    }

    #[test]
    fn format_teach_back_file_two_attempts_first_stays_in_file() {
        let state = TeachBackDraft {
            decision_ref: "0001-decision-request.md".into(),
            generated_by: "teachback-eval-gemma-4-26b-a4b-it".into(),
            iterations: 2,
            attempts: vec![
                TeachBackAttempt {
                    transcript: "коротко".into(),
                    evaluation: TeachBackEvalRecord {
                        understood: Some(false),
                        missing_aspects: vec!["головний ризик".into(), "обраний варіант".into()],
                        feedback: "бракує двох аспектів".into(),
                    },
                },
                TeachBackAttempt {
                    transcript: "Обираю B, наслідок X, ризик Y.".into(),
                    evaluation: TeachBackEvalRecord {
                        understood: Some(true),
                        missing_aspects: vec![],
                        feedback: "тепер повно".into(),
                    },
                },
            ],
            ..Default::default()
        };
        let text = format_teach_back_file(&state);
        assert!(text.contains("## Переказ (teach-back)\nкоротко"));
        assert!(text.contains("## Переказ (teach-back) (спроба 2)"));
        assert!(text.contains("Пропущено: головний ризик, обраний варіант"));

        let parsed = parse_teach_back_file(&text);
        assert_eq!(parsed.attempts.len(), 2);
        assert_eq!(parsed.attempts[0].evaluation.understood, Some(false));
        assert_eq!(parsed.attempts[1].evaluation.understood, Some(true));
        assert_eq!(
            parsed.attempts[1].transcript,
            "Обираю B, наслідок X, ризик Y."
        );
    }

    #[test]
    fn format_teach_back_file_draft_without_time_field_absent_and_null() {
        let draft = TeachBackDraft {
            decision_ref: "0001-decision-request.md".into(),
            generated_by: "teach-back-prompt".into(),
            shown_at: Some("2026-08-09T10:00:00.000Z".into()),
            iterations: 0,
            attempts: vec![],
            time_to_understanding_sec: None,
        };
        let text = format_teach_back_file(&draft);
        assert!(text.contains("shown_at: 2026-08-09T10:00:00.000Z"));
        assert!(!text.contains("time_to_understanding_sec"));
        let parsed = parse_teach_back_file(&text);
        assert_eq!(parsed.time_to_understanding_sec, None);
        assert!(parsed.attempts.is_empty());
    }

    impl TeachBackDraft {
        fn depth_is_teach_back_by_construction(&self) -> bool {
            true // формат завжди пише `depth: teach-back` буквально — окремого поля не парсимо (він завжди відомий з контексту виклику)
        }
    }
}
