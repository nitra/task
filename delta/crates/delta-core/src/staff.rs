//! Штаб — бриф перед рішенням — порт `delta/src/staff.js` (M5). Генератор
//! брифу стискає decision-request у {контекст 3 речення, варіанти з ціною
//! одним рядком, рекомендація + найсильніше заперечення проти НЕЇ, ціна
//! зволікання} — анти-rubber-stamping (owner-спека 260711, «Штаб»). Лінива
//! кнопка «Бриф» — опційна, НЕ блокує підпис. Фолбек без LLM — структурний
//! витяг, чесно позначений `compressed: false`, без `strongestObjection`
//! (генерація контраргументу принципово потребує LLM-судження).

use serde::Deserialize;
use serde_json::json;

use crate::decisions::DecisionRequest;

/// Адреса й модель локального OpenAI-сумісного ендпоінта — той самий
/// дефолт, що `quiz.rs: default_llm_config` (`staff.js:
/// defaultStaffLlmConfig`).
#[derive(Debug, Clone, PartialEq)]
pub struct StaffLlmConfig {
    pub base_url: String,
    pub model: String,
}

impl Default for StaffLlmConfig {
    fn default() -> Self {
        StaffLlmConfig {
            base_url: "http://127.0.0.1:8080".to_string(),
            model: "gemma-4-26b-a4b-it".to_string(),
        }
    }
}

pub fn default_staff_llm_config() -> StaffLlmConfig {
    StaffLlmConfig::default()
}

const STAFF_SYSTEM_PROMPT: &str = "Ти — Штаб системи «Дельта»: стискаєш decision-request у бриф ПЕРЕД тим, як власник його підпише (owner-спека 260711, «Штаб»). Анти-rubber-stamping — обов'язково знайди НАЙСИЛЬНІШЕ заперечення проти рекомендації агента, навіть якщо рекомендація виглядає правильною; власник має побачити контраргумент, а не лише підтвердження. Поверни СТРОГО JSON без пояснень поза ним: {\"contextSummary\": string, \"options\": [{\"label\": string, \"priceLine\": string}], \"recommendationSummary\": string, \"strongestObjection\": string, \"delaySummary\": string}. contextSummary — РІВНО 3 речення; options — по одному рядку-ціні на кожен варіант decision-request (наслідок + ризик одним реченням); recommendationSummary — одне речення, чому агент рекомендує цей варіант; strongestObjection — найсильніше заперечення ПРОТИ рекомендації (не проти рішення взагалі); delaySummary — ціна зволікання одним реченням (з deadline_cost, якщо є, або з наслідків затримки).";

/// Формує user-промпт зі всього тіла decision-request — без обраного
/// варіанта (бриф читається ДО вибору) (`staff.js: buildStaffBriefPrompt`).
pub fn build_staff_brief_prompt(dr: &DecisionRequest) -> String {
    let options_text = dr
        .options
        .iter()
        .map(|o| format!("### {}. {}\n{}", o.label, o.title, o.body))
        .collect::<Vec<_>>()
        .join("\n\n");
    [
        format!("## Контекст\n{}", dr.context),
        format!("## Варіанти\n{options_text}"),
        format!("## Рекомендація агента\n{}", dr.recommendation),
        format!(
            "## Ціна затримки\n{}",
            dr.deadline_cost.as_deref().unwrap_or("не вказана")
        ),
    ]
    .join("\n\n")
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct BriefOption {
    pub label: String,
    #[serde(rename = "priceLine")]
    pub price_line: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct StaffBrief {
    #[serde(rename = "contextSummary")]
    pub context_summary: String,
    pub options: Vec<BriefOption>,
    #[serde(rename = "recommendationSummary")]
    pub recommendation_summary: String,
    #[serde(rename = "strongestObjection")]
    pub strongest_objection: Option<String>,
    #[serde(rename = "delaySummary")]
    pub delay_summary: String,
    #[serde(rename = "generatedBy")]
    pub generated_by: String,
}

#[derive(Deserialize)]
struct LlmBriefOptionPayload {
    label: serde_json::Value,
    #[serde(rename = "priceLine")]
    price_line: Option<String>,
}

#[derive(Deserialize)]
struct LlmBriefPayload {
    #[serde(rename = "contextSummary")]
    context_summary: Option<String>,
    options: Option<Vec<LlmBriefOptionPayload>>,
    #[serde(rename = "recommendationSummary")]
    recommendation_summary: Option<String>,
    #[serde(rename = "strongestObjection")]
    strongest_objection: Option<String>,
    #[serde(rename = "delaySummary")]
    delay_summary: Option<String>,
}

impl LlmBriefPayload {
    fn is_valid(&self) -> bool {
        let Some(context_summary) = &self.context_summary else {
            return false;
        };
        if context_summary.trim().is_empty() {
            return false;
        }
        let Some(options) = &self.options else {
            return false;
        };
        if options.is_empty() {
            return false;
        }
        if !options.iter().all(|o| {
            o.price_line
                .as_deref()
                .is_some_and(|p| !p.trim().is_empty())
        }) {
            return false;
        }
        let Some(recommendation_summary) = &self.recommendation_summary else {
            return false;
        };
        if recommendation_summary.trim().is_empty() {
            return false;
        }
        let Some(strongest_objection) = &self.strongest_objection else {
            return false;
        };
        if strongest_objection.trim().is_empty() {
            return false;
        }
        let Some(delay_summary) = &self.delay_summary else {
            return false;
        };
        !delay_summary.trim().is_empty()
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

/// Викликає локальний ендпоінт для генерації брифу — мережева/парсингова
/// помилка, недоступний ендпоінт, чи невалідна форма повертає `None`, не
/// error; викликач (`decision_brief`) переходить на структурний фолбек
/// (`staff.js: callLlmStaffBrief`).
pub async fn call_llm_staff_brief(
    client: &reqwest::Client,
    llm_config: &StaffLlmConfig,
    dr: &DecisionRequest,
) -> Option<StaffBrief> {
    let body = json!({
        "model": llm_config.model,
        "temperature": 0.3,
        "messages": [
            { "role": "system", "content": STAFF_SYSTEM_PROMPT },
            { "role": "user", "content": build_staff_brief_prompt(dr) }
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
    let parsed: LlmBriefPayload =
        serde_json::from_str(crate::quiz::strip_json_code_fence(raw)).ok()?;
    if !parsed.is_valid() {
        return None;
    }
    Some(StaffBrief {
        context_summary: parsed.context_summary.unwrap().trim().to_string(),
        options: parsed
            .options
            .unwrap()
            .into_iter()
            .map(|o| BriefOption {
                label: value_to_trimmed_string(&o.label),
                price_line: o.price_line.unwrap().trim().to_string(),
            })
            .collect(),
        recommendation_summary: parsed.recommendation_summary.unwrap().trim().to_string(),
        strongest_objection: Some(parsed.strongest_objection.unwrap().trim().to_string()),
        delay_summary: parsed.delay_summary.unwrap().trim().to_string(),
        generated_by: format!("staff-brief-{}", llm_config.model),
    })
}

fn value_to_trimmed_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.trim().to_string(),
        other => other.to_string().trim().to_string(),
    }
}

/// Структурний фолбек-бриф без LLM — БЕЗ стискання, чесно позначений
/// `compressed: false`. Немає `strongestObjection` (`staff.js:
/// fallbackStaffBrief`).
pub fn fallback_staff_brief(dr: &DecisionRequest) -> StaffBrief {
    StaffBrief {
        context_summary: dr.context.clone(),
        options: dr
            .options
            .iter()
            .map(|o| BriefOption {
                label: o.label.clone(),
                price_line: format!("{} — {}", o.title, o.body).trim().to_string(),
            })
            .collect(),
        recommendation_summary: dr.recommendation.clone(),
        strongest_objection: None,
        delay_summary: dr
            .deadline_cost
            .clone()
            .unwrap_or_else(|| "не вказана".to_string()),
        generated_by: "staff-brief-fallback".to_string(),
    }
}

/// Повний потік `decision_brief`: спершу LLM, недоступний — структурний
/// фолбек. Обидва шляхи повертають однакову форму плюс `compressed` (true
/// — LLM реально стиснув; false — фолбек, чесно позначений) (`staff.js:
/// decisionBrief`).
pub async fn decision_brief(
    client: &reqwest::Client,
    llm_config: &StaffLlmConfig,
    dr: &DecisionRequest,
) -> (StaffBrief, bool) {
    match call_llm_staff_brief(client, llm_config, dr).await {
        Some(brief) => (brief, true),
        None => (fallback_staff_brief(dr), false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decisions::{parse_decision_request, DecisionRequestMeta};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const DR_TEXT: &str =
        include_str!("../tests/fixtures/runs/demo-1/decisions/0001-decision-request.md");

    fn decision_request() -> DecisionRequest {
        parse_decision_request(
            DR_TEXT,
            DecisionRequestMeta {
                path: Some("x".into()),
                nnnn: Some("0001".into()),
                ..Default::default()
            },
        )
        .unwrap()
    }

    fn valid_payload_json() -> serde_json::Value {
        json!({
            "contextSummary": "Речення 1. Речення 2. Речення 3.",
            "options": [
                {"label": "A", "priceLine": "Новий файл, чистіші тести."},
                {"label": "B", "priceLine": "Без нового файлу, логіка в JS."}
            ],
            "recommendationSummary": "Composable лишає верстку локальною.",
            "strongestObjection": "Composable без типів гірше документується, ніж окремий компонент.",
            "delaySummary": "Блокує вихід design-review вузла."
        })
    }

    #[test]
    fn default_staff_llm_config_matches_quiz_default() {
        let c = default_staff_llm_config();
        assert_eq!(c.base_url, "http://127.0.0.1:8080");
        assert_eq!(c.model, "gemma-4-26b-a4b-it");
    }

    #[test]
    fn build_staff_brief_prompt_includes_all_sections() {
        let prompt = build_staff_brief_prompt(&decision_request());
        assert!(prompt.contains("MandateCard.vue"));
        assert!(prompt.contains("Рекомендація агента"));
        assert!(prompt.contains("Ціна затримки"));
        assert!(prompt.contains("design-review"));
    }

    #[tokio::test]
    async fn call_llm_staff_brief_valid_response() {
        let server = MockServer::start().await;
        let body = json!({"choices": [{"message": {"content": valid_payload_json().to_string()}}]});
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let config = StaffLlmConfig {
            base_url: server.uri(),
            model: "gemma-4-26b-a4b-it".into(),
        };
        let result = call_llm_staff_brief(&client, &config, &decision_request())
            .await
            .unwrap();
        assert_eq!(result.generated_by, "staff-brief-gemma-4-26b-a4b-it");
        assert_eq!(result.options.len(), 2);
        assert_eq!(
            result.strongest_objection.as_deref(),
            Some("Composable без типів гірше документується, ніж окремий компонент.")
        );
    }

    #[tokio::test]
    async fn call_llm_staff_brief_network_error_returns_none() {
        let client = reqwest::Client::new();
        let config = StaffLlmConfig {
            base_url: "http://127.0.0.1:1".into(),
            model: "x".into(),
        };
        assert!(call_llm_staff_brief(&client, &config, &decision_request())
            .await
            .is_none());
    }

    #[tokio::test]
    async fn call_llm_staff_brief_non_2xx_returns_none() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let config = StaffLlmConfig {
            base_url: server.uri(),
            model: "x".into(),
        };
        assert!(call_llm_staff_brief(&client, &config, &decision_request())
            .await
            .is_none());
    }

    #[tokio::test]
    async fn call_llm_staff_brief_missing_strongest_objection_returns_none() {
        let mut payload = valid_payload_json();
        payload
            .as_object_mut()
            .unwrap()
            .remove("strongestObjection");
        let server = MockServer::start().await;
        let body = json!({"choices": [{"message": {"content": payload.to_string()}}]});
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let config = StaffLlmConfig {
            base_url: server.uri(),
            model: "x".into(),
        };
        assert!(call_llm_staff_brief(&client, &config, &decision_request())
            .await
            .is_none());
    }

    #[tokio::test]
    async fn call_llm_staff_brief_broken_json_returns_none() {
        let server = MockServer::start().await;
        let body = json!({"choices": [{"message": {"content": "not json"}}]});
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let config = StaffLlmConfig {
            base_url: server.uri(),
            model: "x".into(),
        };
        assert!(call_llm_staff_brief(&client, &config, &decision_request())
            .await
            .is_none());
    }

    #[test]
    fn fallback_staff_brief_is_structural_and_uncompressed() {
        let dr = decision_request();
        let brief = fallback_staff_brief(&dr);
        assert_eq!(brief.generated_by, "staff-brief-fallback");
        assert!(brief.strongest_objection.is_none());
        assert_eq!(brief.context_summary, dr.context);
        assert_eq!(brief.options.len(), dr.options.len());
        assert_eq!(brief.options[0].label, dr.options[0].label);
    }

    #[tokio::test]
    async fn decision_brief_llm_available_is_compressed() {
        let server = MockServer::start().await;
        let body = json!({"choices": [{"message": {"content": valid_payload_json().to_string()}}]});
        Mock::given(method("POST"))
            .and(path("/v1/chat/completions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;
        let client = reqwest::Client::new();
        let config = StaffLlmConfig {
            base_url: server.uri(),
            model: "gemma-4-26b-a4b-it".into(),
        };
        let (brief, compressed) = decision_brief(&client, &config, &decision_request()).await;
        assert!(compressed);
        assert!(brief.generated_by.starts_with("staff-brief-"));
    }

    #[tokio::test]
    async fn decision_brief_llm_unavailable_falls_back_honestly() {
        let client = reqwest::Client::new();
        let config = StaffLlmConfig {
            base_url: "http://127.0.0.1:1".into(),
            model: "x".into(),
        };
        let (brief, compressed) = decision_brief(&client, &config, &decision_request()).await;
        assert!(!compressed);
        assert_eq!(brief.generated_by, "staff-brief-fallback");
        assert!(brief.strongest_objection.is_none());
    }
}
