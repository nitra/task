//! Мок профілів компетенцій — `.mt/profiles/{handle}.yaml`, ЛИШЕ секція
//! `growth_edge` (конституція п.2(г); mt `docs/architecture/mandates.md`,
//! «Профіль людини»: «`growth_edge: [rust, postgres]` — ЄДИНА секція, яку
//! пише сама людина (CI-виняток)»). Реальний контракт живе в окремому
//! org-репо `people-profiles` з `competencies` (positive-only CV, пише лише
//! агрегатор) — цього репо тут немає (свідомо поза обсягом), тому мок
//! навмисно містить ЛИШЕ `growth_edge`, не повний профіль.
//!
//! **Інваріант, який тримає весь модуль:** генератор квізу читає
//! `growth_edge` і, якщо домен розвилки в ньому, додає ОДНЕ додаткове
//! навчальне питання ширшого контексту («на виріст») — навчання, не
//! бар'єр: [`build_growth_edge_field`] повертає окреме поле відповіді
//! `decision_quiz` (`growthEdge`), яке НІКОЛИ не входить у сам квіз-файл чи
//! `questions[]`/`resolved_count` — фізично не може вплинути на те, чи
//! відкривається підпис.

use serde::{Deserialize, Serialize};

use crate::decisions::DecisionRequest;
use crate::quiz::GeneratedQuestion;

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct GrowthEdgeProfile {
    #[serde(default)]
    pub growth_edge: Vec<String>,
}

/// Шлях до профілю одного handle у воркспейсі.
pub fn profile_path(mandates_dir: &str, handle: &str) -> String {
    format!("{mandates_dir}/.mt/profiles/{handle}.yaml")
}

/// Розбирає `growth_edge` з YAML — відсутній/битий файл повертає порожній
/// список (не кидає): відсутність профілю — стан «зона росту ще не
/// заявлена», не помилка (той самий fail-open інваріант, що
/// `knowledge::parse_knowledge_file`).
pub fn parse_growth_edge_profile(text: Option<&str>) -> Vec<String> {
    let Some(text) = text else {
        return Vec::new();
    };
    if text.trim().is_empty() {
        return Vec::new();
    }
    serde_norway::from_str::<GrowthEdgeProfile>(text)
        .map(|p| p.growth_edge)
        .unwrap_or_default()
}

/// Серіалізує `growth_edge` назад у YAML — `people-profiles.git/{handle}.yaml`
/// формат mandates.md, лише ця одна секція.
pub fn format_growth_edge_profile(domains: &[String]) -> String {
    let profile = GrowthEdgeProfile {
        growth_edge: domains.to_vec(),
    };
    serde_norway::to_string(&profile).expect("GrowthEdgeProfile серіалізується в YAML без помилок")
}

/// Чи `domain` (decision_type розвилки) — заявлена зона росту.
pub fn is_growth_edge_domain(growth_edge: &[String], domain: &str) -> bool {
    growth_edge.iter().any(|d| d == domain)
}

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

/// Детерміноване питання «на виріст» — ширший контекст поза самою
/// розвилкою (не «що станеться, якщо обереш X», а «як цей клас розвилок
/// виглядає на масштабі ширшому за цей вузол»). Детерміноване (без LLM) —
/// той самий підхід, що `onboarding::generate_entry_questions`: питання
/// поза Гудхартовим тиском, підпис від нього не залежить.
pub fn growth_edge_question(dr: &DecisionRequest) -> GeneratedQuestion {
    let domain = dr.decision_type.as_deref().unwrap_or("general");
    let blast_radius = dr.leverage_facets.blast_radius.as_str();
    let correct = format!(
        "Розглянути, чи цей клас рішень ({domain}) варто дистилювати в policy-рядок mandates.yaml — повторювані розвилки того самого класу є прецедентним матеріалом"
    );
    let distractors = vec![
        "Нічого — кожна розвилка цього класу унікальна і не узагальнюється".to_string(),
        format!("Розширити {blast_radius} без аналізу прецедентів"),
    ];
    let (options, correct_index) = rotate_options(&correct, distractors, domain);
    GeneratedQuestion {
        question: format!(
            "На виріст: ти позначив(ла) «{domain}» зоною росту у своєму профілі. Ширший контекст — якщо такі розвилки повторюються, що варто зробити з класом рішень, а не з ЦІЄЮ конкретною розвилкою?"
        ),
        options,
        correct_index,
        microlesson: "Мікроурок «на виріст»: прецедентний рушій (mandates.md) — судження власника, застосоване тисячі разів; серія однотипних розвилок — сигнал дистилювати в policy-рядок, не підписувати щоразу заново.".to_string(),
    }
}

/// Будує окреме поле `growthEdge` відповіді `decision_quiz` — `None`, якщо
/// домен розвилки НЕ в зоні росту власника. Викликач (CLI/Tauri
/// tool-обгортка, не сам `decision_flow::decision_quiz`) вставляє це поле
/// в JSON-відповідь ПІСЛЯ звичайного квіз-гейта — воно ніколи не проходить
/// через `format_quiz_file`/`questions[]`, тому фізично не може підняти
/// вимоги до підпису.
pub fn build_growth_edge_field(
    growth_edge: &[String],
    domain: &str,
    dr: &DecisionRequest,
) -> Option<serde_json::Value> {
    if !is_growth_edge_domain(growth_edge, domain) {
        return None;
    }
    let q = growth_edge_question(dr);
    Some(serde_json::json!({
        "question": q.question,
        "options": q.options,
        "microlesson": q.microlesson,
        "stretch": true,
        "blocking": false,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decisions::{parse_decision_request, DecisionRequestMeta};

    const DR_0001: &str =
        include_str!("../tests/fixtures/runs/demo-1/decisions/0001-decision-request.md");

    fn dr() -> DecisionRequest {
        parse_decision_request(DR_0001, DecisionRequestMeta::default()).unwrap()
    }

    #[test]
    fn parse_growth_edge_profile_missing_or_blank_is_empty() {
        assert!(parse_growth_edge_profile(None).is_empty());
        assert!(parse_growth_edge_profile(Some("")).is_empty());
        assert!(parse_growth_edge_profile(Some("   ")).is_empty());
    }

    #[test]
    fn parse_growth_edge_profile_corrupt_yaml_is_empty() {
        assert!(parse_growth_edge_profile(Some("growth_edge: [\n")).is_empty());
    }

    #[test]
    fn format_and_parse_growth_edge_profile_round_trips() {
        let domains = vec!["rust".to_string(), "postgres".to_string()];
        let text = format_growth_edge_profile(&domains);
        assert!(text.contains("growth_edge"));
        assert!(text.contains("rust"));
        assert_eq!(parse_growth_edge_profile(Some(&text)), domains);
    }

    #[test]
    fn is_growth_edge_domain_matches_exact_only() {
        let ge = vec!["architecture".to_string()];
        assert!(is_growth_edge_domain(&ge, "architecture"));
        assert!(!is_growth_edge_domain(&ge, "ops"));
    }

    #[test]
    fn growth_edge_question_is_deterministic_and_mentions_domain() {
        let a = growth_edge_question(&dr());
        let b = growth_edge_question(&dr());
        assert_eq!(a, b);
        assert!(a.question.contains("architecture"));
        assert_eq!(a.options.len(), 3);
    }

    #[test]
    fn build_growth_edge_field_none_when_domain_not_in_growth_edge() {
        assert!(build_growth_edge_field(&[], "architecture", &dr()).is_none());
        assert!(build_growth_edge_field(&["ops".to_string()], "architecture", &dr()).is_none());
    }

    #[test]
    fn build_growth_edge_field_some_when_domain_in_growth_edge_never_blocking() {
        let field =
            build_growth_edge_field(&["architecture".to_string()], "architecture", &dr()).unwrap();
        assert_eq!(field["stretch"], true);
        assert_eq!(field["blocking"], false);
        assert!(
            field["question"].as_str().unwrap().contains("на виріст")
                || field["question"].as_str().unwrap().contains("architecture")
        );
    }
}
