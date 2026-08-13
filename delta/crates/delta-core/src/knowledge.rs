//! Особиста база знань (M2) — порт `delta/src/knowledge.js`. Сховище ПОЗА
//! git, файл-сусід `config.json`/`device_key.json` (`knowledge.json`).
//! Плаский JSON-масив записів, по одному на КОЖЕН завершений квіз —
//! одночасно конспект домену («що я зрозумів, підписуючи») і одиниця
//! spaced-repetition (`options`/`correctAnswer`/`intervalDays`/
//! `lastRepeatedAt`). Запис/читання переноситься в delta-core разом із
//! `decision_flow.rs`, щоб цикл «квіз → фіналізація → база знань» не
//! розривався напів-JS/напів-Rust мостом (задокументоване рішення фази A).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const INTERVAL_LADDER_DAYS: [i64; 4] = [1, 3, 7, 21];
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

/// Довжина серії поспіль-успішних квізів домену, що обґрунтовує спрощення
/// (docs/specs/260809-delta-app.md, конституція п.3: «Серія пройдених
/// квізів класу спрощує наступні до one-tap»).
pub const TRUST_STREAK_LEN: usize = 5;
/// Максимальна давність останнього квізу серії, днів — довша перерва
/// повертає глибину (та сама п.3).
pub const TRUST_RECENCY_DAYS: i64 = 14;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KnowledgeEntry {
    pub id: String,
    #[serde(rename = "decisionRef")]
    pub decision_ref: String,
    pub domain: String,
    pub question: String,
    #[serde(default)]
    pub options: Option<Vec<String>>,
    #[serde(rename = "correctAnswer", default)]
    pub correct_answer: Option<String>,
    pub microlesson: String,
    pub iterations: u64,
    #[serde(rename = "timeToUnderstandingSec")]
    pub time_to_understanding_sec: f64,
    #[serde(rename = "completedAt")]
    pub completed_at: String,
    #[serde(rename = "intervalDays")]
    pub interval_days: i64,
    #[serde(rename = "lastRepeatedAt")]
    pub last_repeated_at: Option<String>,
    /// `mandate_generation` decision-request, з якого вийшов цей квіз —
    /// відсутнє в записах, зроблених до п.3 (спрощення квізів з довірою,
    /// `docs/open-questions.md` розділ 3), `default` тримає старі записи
    /// парсовними. Зміна генерації мандатів фенсить довіру-стрік
    /// ([`trust_simplified_for_domain`]) так само, як і mt-mandates фенсить
    /// застарілі decision-request (mandates.md: «Generation fencing»).
    #[serde(
        rename = "mandateGeneration",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub mandate_generation: Option<i64>,
}

/// Розбирає сирий текст `knowledge.json` — відсутній/битий файл повертає
/// порожній масив (не кидає): відсутність бази знань — не помилка, а стан
/// «ще жодного завершеного квізу» (`knowledge.js: parseKnowledgeFile`).
pub fn parse_knowledge_file(text: Option<&str>) -> Vec<KnowledgeEntry> {
    let Some(text) = text else { return Vec::new() };
    if text.trim().is_empty() {
        return Vec::new();
    }
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|arr| {
            arr.into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect()
        })
        .unwrap_or_default()
}

/// Серіалізує записи бази знань у pretty-print JSON з кінцевим переносом
/// рядка (`knowledge.js: formatKnowledgeFile`).
pub fn format_knowledge_file(entries: &[KnowledgeEntry]) -> String {
    let mut text = serde_json::to_string_pretty(entries)
        .expect("Vec<KnowledgeEntry> серіалізується без помилок");
    text.push('\n');
    text
}

fn make_entry_id(decision_ref: &str, completed_at: &str) -> String {
    format!("{decision_ref}@{completed_at}")
}

pub struct CompletedQuiz<'a> {
    pub decision_ref: &'a str,
    pub domain: Option<&'a str>,
    pub question: &'a str,
    pub options: Option<Vec<String>>,
    pub correct_answer: Option<String>,
    pub microlesson: &'a str,
    pub iterations: u64,
    pub time_to_understanding_sec: f64,
    pub completed_at: &'a str,
    pub mandate_generation: Option<i64>,
}

/// Додає запис завершеного квізу до бази знань — pure-функція (повертає
/// НОВИЙ вектор, не мутує вхідний) — `knowledge.js: appendKnowledgeEntry`.
pub fn append_knowledge_entry(
    entries: &[KnowledgeEntry],
    completed: CompletedQuiz<'_>,
) -> Vec<KnowledgeEntry> {
    let mut next = entries.to_vec();
    next.push(KnowledgeEntry {
        id: make_entry_id(completed.decision_ref, completed.completed_at),
        decision_ref: completed.decision_ref.to_string(),
        domain: completed.domain.unwrap_or("general").to_string(),
        question: completed.question.to_string(),
        options: completed.options,
        correct_answer: completed.correct_answer,
        microlesson: completed.microlesson.to_string(),
        iterations: completed.iterations,
        time_to_understanding_sec: completed.time_to_understanding_sec,
        completed_at: completed.completed_at.to_string(),
        interval_days: INTERVAL_LADDER_DAYS[0],
        last_repeated_at: None,
        mandate_generation: completed.mandate_generation,
    });
    next
}

fn due_at_ms(entry: &KnowledgeEntry) -> i64 {
    let base_str = entry
        .last_repeated_at
        .as_deref()
        .unwrap_or(&entry.completed_at);
    let base = DateTime::parse_from_rfc3339(base_str)
        .map(|d| d.timestamp_millis())
        .unwrap_or(0);
    base + entry.interval_days * DAY_MS
}

/// Знаходить найдавніший «дозрілий» запис певного домену для підмішування
/// в новий квіз (`knowledge.js: dueRepetition`).
pub fn due_repetition<'a>(
    entries: &'a [KnowledgeEntry],
    domain: &str,
    now: DateTime<Utc>,
) -> Option<&'a KnowledgeEntry> {
    let now_ms = now.timestamp_millis();
    let mut candidates: Vec<&KnowledgeEntry> = entries
        .iter()
        .filter(|e| e.domain == domain && e.options.is_some() && e.correct_answer.is_some())
        .filter(|e| due_at_ms(e) <= now_ms)
        .collect();
    candidates.sort_by_key(|e| due_at_ms(e));
    candidates.into_iter().next()
}

/// Оновлює `lastRepeatedAt`/`intervalDays` запису після відповіді на
/// spaced-repetition-питання — драбинка 1→3→7→21 на правильній відповіді,
/// скидання до 1 на неправильній (`knowledge.js: recordRepetitionAnswer`).
pub fn record_repetition_answer(
    entries: &[KnowledgeEntry],
    entry_id: &str,
    correct: bool,
    now: DateTime<Utc>,
) -> Vec<KnowledgeEntry> {
    entries
        .iter()
        .map(|e| {
            if e.id != entry_id {
                return e.clone();
            }
            let current_index = INTERVAL_LADDER_DAYS
                .iter()
                .position(|&d| d == e.interval_days);
            let next_index = if correct {
                current_index
                    .map(|i| (i + 1).min(INTERVAL_LADDER_DAYS.len() - 1))
                    .unwrap_or(0)
            } else {
                0
            };
            let mut updated = e.clone();
            updated.last_repeated_at =
                Some(now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
            updated.interval_days = INTERVAL_LADDER_DAYS[next_index];
            updated
        })
        .collect()
}

/// Чи обґрунтована серія останніх завершених квізів домену для спрощення
/// НАСТУПНОГО `standard`-квізу до one-tap (п.3 конституції: «Спрощення
/// квізів з довірою», `docs/open-questions.md` розділ 3). Умови (усі разом):
/// (1) щонайменше [`TRUST_STREAK_LEN`] завершених квізів цього домену,
/// (2) останні [`TRUST_STREAK_LEN`] усі з `iterations == 1` (жодного фейлу —
/// перша спроба щоразу правильна), (3) усі з тим самим `mandate_generation`,
/// що дав викликач (зміна генерації карти мандатів фенсить довіру-стрік,
/// той самий принцип, що generation fencing decision-request у
/// mandates.md), (4) давність останнього квізу серії ≤ [`TRUST_RECENCY_DAYS`]
/// від `now` (ін'єктований годинник — детерміновані тести).
///
/// **Інваріант, який ЦЯ функція не перевіряє сама (відповідальність
/// викликача):** irreversible/teach-back НІКОЛИ не спрощується — викликач
/// (`decision_flow::decision_quiz`) застосовує результат лише коли
/// `depth_for_facets` уже повернув `"standard"`, глибина `"teach-back"`
/// сюди взагалі не доходить (mandates.md: «Інваріант reversible» — довіра
/// ніколи не знімає гейт, лише полегшує reversible-клас).
pub fn trust_simplified_for_domain(
    entries: &[KnowledgeEntry],
    domain: &str,
    mandate_generation: Option<i64>,
    now: DateTime<Utc>,
) -> bool {
    // teach-back-завершення пишуть `options: None`/`correct_answer: None`
    // (немає варіантів вибору — вільний переказ) — свідомо виключені з
    // серії: інваріант reversible забороняє довірі-стріку впливати на
    // irreversible/teach-back клас навіть опосередковано, через змішування
    // його статистики в стрік сусіднього `standard`-квізу того самого
    // домену.
    let mut domain_entries: Vec<&KnowledgeEntry> = entries
        .iter()
        .filter(|e| e.domain == domain && e.options.is_some())
        .collect();
    if domain_entries.len() < TRUST_STREAK_LEN {
        return false;
    }
    domain_entries.sort_by(|a, b| a.completed_at.cmp(&b.completed_at));
    let recent = &domain_entries[domain_entries.len() - TRUST_STREAK_LEN..];
    if !recent.iter().all(|e| e.iterations == 1) {
        return false;
    }
    if !recent
        .iter()
        .all(|e| e.mandate_generation == mandate_generation)
    {
        return false;
    }
    let Some(last) = recent.last() else {
        return false;
    };
    let Ok(last_at) = DateTime::parse_from_rfc3339(&last.completed_at) else {
        return false;
    };
    let age_days = (now.timestamp_millis() - last_at.timestamp_millis()) / DAY_MS;
    age_days <= TRUST_RECENCY_DAYS
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DomainDigestItem {
    #[serde(rename = "decisionRef")]
    pub decision_ref: String,
    pub question: String,
    pub microlesson: String,
    #[serde(rename = "completedAt")]
    pub completed_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DomainDigestEntry {
    pub domain: String,
    pub count: usize,
    pub items: Vec<DomainDigestItem>,
}

/// Конспект по доменах — усі мікроуроки й питання, згруповані за доменом,
/// хронологічно (`knowledge.js: domainDigest`).
pub fn domain_digest(entries: &[KnowledgeEntry]) -> Vec<DomainDigestEntry> {
    let mut by_domain: std::collections::BTreeMap<String, Vec<DomainDigestItem>> =
        std::collections::BTreeMap::new();
    for e in entries {
        by_domain
            .entry(e.domain.clone())
            .or_default()
            .push(DomainDigestItem {
                decision_ref: e.decision_ref.clone(),
                question: e.question.clone(),
                microlesson: e.microlesson.clone(),
                completed_at: e.completed_at.clone(),
            });
    }
    by_domain
        .into_iter()
        .map(|(domain, mut items)| {
            items.sort_by(|a, b| a.completed_at.cmp(&b.completed_at));
            DomainDigestEntry {
                domain,
                count: items.len(),
                items,
            }
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrendDirection {
    Down,
    Up,
    Flat,
    InsufficientData,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TrendEntry {
    pub domain: String,
    pub samples: usize,
    pub trend: TrendDirection,
    #[serde(rename = "averageSec")]
    pub average_sec: Option<f64>,
    #[serde(rename = "firstAvgSec", skip_serializing_if = "Option::is_none")]
    pub first_avg_sec: Option<f64>,
    #[serde(rename = "secondAvgSec", skip_serializing_if = "Option::is_none")]
    pub second_avg_sec: Option<f64>,
}

fn average_sec(items: &[&KnowledgeEntry]) -> f64 {
    items
        .iter()
        .map(|x| x.time_to_understanding_sec)
        .sum::<f64>()
        / items.len() as f64
}

/// Приватний тренд «час до розуміння» по доменах — порівнює середнє першої
/// й другої половини хронології кожного домену (`knowledge.js:
/// timeToUnderstandingTrend`).
pub fn time_to_understanding_trend(entries: &[KnowledgeEntry]) -> Vec<TrendEntry> {
    let mut by_domain: std::collections::BTreeMap<String, Vec<&KnowledgeEntry>> =
        std::collections::BTreeMap::new();
    for e in entries {
        by_domain.entry(e.domain.clone()).or_default().push(e);
    }
    by_domain
        .into_iter()
        .map(|(domain, mut items)| {
            items.sort_by(|a, b| a.completed_at.cmp(&b.completed_at));
            if items.len() < 2 {
                return TrendEntry {
                    domain,
                    samples: items.len(),
                    trend: TrendDirection::InsufficientData,
                    average_sec: items.first().map(|e| e.time_to_understanding_sec),
                    first_avg_sec: None,
                    second_avg_sec: None,
                };
            }
            let mid = items.len() / 2;
            let (first_half, second_half) = items.split_at(mid);
            let first_avg = average_sec(first_half);
            let second_avg = average_sec(second_half);
            let trend = if second_avg < first_avg {
                TrendDirection::Down
            } else if second_avg > first_avg {
                TrendDirection::Up
            } else {
                TrendDirection::Flat
            };
            TrendEntry {
                domain,
                samples: items.len(),
                trend,
                average_sec: Some((average_sec(&items) * 1.0).round()),
                first_avg_sec: Some(first_avg.round()),
                second_avg_sec: Some(second_avg.round()),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn dt(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn parse_knowledge_file_missing_or_blank_is_empty() {
        assert!(parse_knowledge_file(None).is_empty());
        assert!(parse_knowledge_file(Some("")).is_empty());
        assert!(parse_knowledge_file(Some("   ")).is_empty());
    }

    #[test]
    fn parse_knowledge_file_corrupt_json_is_empty() {
        assert!(parse_knowledge_file(Some("{not json")).is_empty());
    }

    #[test]
    fn append_knowledge_entry_sets_default_interval_and_null_last_repeated() {
        let entries = append_knowledge_entry(
            &[],
            CompletedQuiz {
                decision_ref: "0001-decision-request.md",
                domain: Some("architecture"),
                question: "q?",
                options: Some(vec!["a".into(), "b".into()]),
                correct_answer: Some("a".into()),
                microlesson: "m",
                iterations: 1,
                time_to_understanding_sec: 47.0,
                completed_at: "2026-08-09T10:05:00.000Z",
                mandate_generation: None,
            },
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].interval_days, 1);
        assert_eq!(entries[0].last_repeated_at, None);
        assert_eq!(
            entries[0].id,
            "0001-decision-request.md@2026-08-09T10:05:00.000Z"
        );
    }

    #[test]
    fn append_knowledge_entry_domain_defaults_to_general() {
        let entries = append_knowledge_entry(
            &[],
            CompletedQuiz {
                decision_ref: "x",
                domain: None,
                question: "q",
                options: None,
                correct_answer: None,
                microlesson: "m",
                iterations: 1,
                time_to_understanding_sec: 1.0,
                completed_at: "2026-08-09T10:05:00.000Z",
                mandate_generation: None,
            },
        );
        assert_eq!(entries[0].domain, "general");
    }

    fn due_entry() -> KnowledgeEntry {
        KnowledgeEntry {
            id: "9998-decision-request.md@2026-08-01T10:00:00.000Z".into(),
            decision_ref: "9998-decision-request.md".into(),
            domain: "architecture".into(),
            question: "Старе питання?".into(),
            options: Some(vec!["A".into(), "B".into(), "C".into()]),
            correct_answer: Some("A".into()),
            microlesson: "m".into(),
            iterations: 1,
            time_to_understanding_sec: 30.0,
            completed_at: "2026-08-01T10:00:00.000Z".into(),
            interval_days: 1,
            last_repeated_at: None,
            mandate_generation: None,
        }
    }

    #[test]
    fn due_repetition_finds_matured_entry_of_domain() {
        let entries = vec![due_entry()];
        let now = dt("2026-08-09T10:00:00.000Z"); // > 1 day after completedAt
        let found = due_repetition(&entries, "architecture", now);
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, entries[0].id);
    }

    #[test]
    fn due_repetition_none_for_other_domain_or_not_matured() {
        let entries = vec![due_entry()];
        let now = dt("2026-08-09T10:00:00.000Z");
        assert!(due_repetition(&entries, "process", now).is_none());
        let now_too_soon = dt("2026-08-01T10:00:00.500Z");
        assert!(due_repetition(&entries, "architecture", now_too_soon).is_none());
    }

    #[test]
    fn record_repetition_answer_correct_advances_ladder() {
        let entries = vec![due_entry()];
        let now = Utc.with_ymd_and_hms(2026, 8, 9, 10, 0, 0).unwrap();
        let updated = record_repetition_answer(&entries, &entries[0].id, true, now);
        assert_eq!(updated[0].interval_days, 3);
        assert!(updated[0].last_repeated_at.is_some());
    }

    #[test]
    fn record_repetition_answer_incorrect_resets_to_first_rung() {
        let mut entry = due_entry();
        entry.interval_days = 7;
        let entries = vec![entry];
        let now = Utc.with_ymd_and_hms(2026, 8, 9, 10, 0, 0).unwrap();
        let updated = record_repetition_answer(&entries, &entries[0].id, false, now);
        assert_eq!(updated[0].interval_days, 1);
    }

    #[test]
    fn domain_digest_groups_and_sorts_by_domain_name() {
        let entries = vec![
            append_knowledge_entry(
                &[],
                CompletedQuiz {
                    decision_ref: "a",
                    domain: Some("z"),
                    question: "q1",
                    options: None,
                    correct_answer: None,
                    microlesson: "m1",
                    iterations: 1,
                    time_to_understanding_sec: 1.0,
                    completed_at: "2026-01-01T00:00:00.000Z",
                    mandate_generation: None,
                },
            )[0]
            .clone(),
            append_knowledge_entry(
                &[],
                CompletedQuiz {
                    decision_ref: "b",
                    domain: Some("a"),
                    question: "q2",
                    options: None,
                    correct_answer: None,
                    microlesson: "m2",
                    iterations: 1,
                    time_to_understanding_sec: 1.0,
                    completed_at: "2026-01-02T00:00:00.000Z",
                    mandate_generation: None,
                },
            )[0]
            .clone(),
        ];
        let digest = domain_digest(&entries);
        assert_eq!(digest.len(), 2);
        assert_eq!(digest[0].domain, "a");
        assert_eq!(digest[1].domain, "z");
    }

    #[test]
    fn time_to_understanding_trend_insufficient_data_below_two_samples() {
        let entries = vec![append_knowledge_entry(
            &[],
            CompletedQuiz {
                decision_ref: "a",
                domain: Some("x"),
                question: "q",
                options: None,
                correct_answer: None,
                microlesson: "m",
                iterations: 1,
                time_to_understanding_sec: 40.0,
                completed_at: "2026-01-01T00:00:00.000Z",
                mandate_generation: None,
            },
        )[0]
        .clone()];
        let trend = time_to_understanding_trend(&entries);
        assert_eq!(trend[0].trend, TrendDirection::InsufficientData);
        assert_eq!(trend[0].samples, 1);
    }

    #[test]
    fn time_to_understanding_trend_down_when_second_half_faster() {
        let mut e1 = append_knowledge_entry(
            &[],
            CompletedQuiz {
                decision_ref: "a",
                domain: Some("x"),
                question: "q",
                options: None,
                correct_answer: None,
                microlesson: "m",
                iterations: 1,
                time_to_understanding_sec: 100.0,
                completed_at: "2026-01-01T00:00:00.000Z",
                mandate_generation: None,
            },
        )[0]
        .clone();
        let mut e2 = e1.clone();
        e2.time_to_understanding_sec = 10.0;
        e2.completed_at = "2026-01-02T00:00:00.000Z".into();
        e2.id = "b".into();
        e1.id = "a".into();
        let trend = time_to_understanding_trend(&[e1, e2]);
        assert_eq!(trend[0].trend, TrendDirection::Down);
    }

    fn streak_entry(day: u32, iterations: u64, generation: Option<i64>) -> KnowledgeEntry {
        let completed_at = format!("2026-07-{day:02}T10:00:00.000Z");
        append_knowledge_entry(
            &[],
            CompletedQuiz {
                decision_ref: "0001-decision-request.md",
                domain: Some("architecture"),
                question: "q",
                options: Some(vec!["a".into(), "b".into(), "c".into()]),
                correct_answer: Some("a".into()),
                microlesson: "m",
                iterations,
                time_to_understanding_sec: 20.0,
                completed_at: &completed_at,
                mandate_generation: generation,
            },
        )
        .remove(0)
    }

    #[test]
    fn trust_simplified_true_after_five_clean_quizzes_within_recency() {
        let entries: Vec<KnowledgeEntry> = (21..=25).map(|d| streak_entry(d, 1, Some(3))).collect();
        let now = dt("2026-07-30T10:00:00.000Z"); // 5 days after last (25th)
        assert!(trust_simplified_for_domain(
            &entries,
            "architecture",
            Some(3),
            now
        ));
    }

    #[test]
    fn trust_simplified_false_below_streak_length() {
        let entries: Vec<KnowledgeEntry> = (22..=25).map(|d| streak_entry(d, 1, Some(3))).collect();
        let now = dt("2026-07-30T10:00:00.000Z");
        assert!(!trust_simplified_for_domain(
            &entries,
            "architecture",
            Some(3),
            now
        ));
    }

    #[test]
    fn trust_simplified_false_when_any_recent_had_a_failed_attempt() {
        let mut entries: Vec<KnowledgeEntry> =
            (21..=25).map(|d| streak_entry(d, 1, Some(3))).collect();
        entries[4].iterations = 2; // остання спроба у серії — не з першого разу
        let now = dt("2026-07-30T10:00:00.000Z");
        assert!(!trust_simplified_for_domain(
            &entries,
            "architecture",
            Some(3),
            now
        ));
    }

    #[test]
    fn trust_simplified_false_when_recency_exceeds_fourteen_days() {
        let entries: Vec<KnowledgeEntry> = (1..=5).map(|d| streak_entry(d, 1, Some(3))).collect();
        let now = dt("2026-07-30T10:00:00.000Z"); // > 14 днів після 5-го (25 днів)
        assert!(!trust_simplified_for_domain(
            &entries,
            "architecture",
            Some(3),
            now
        ));
    }

    #[test]
    fn trust_simplified_false_exactly_at_recency_boundary_still_true() {
        let entries: Vec<KnowledgeEntry> = (21..=25).map(|d| streak_entry(d, 1, Some(3))).collect();
        let now = dt("2026-08-08T10:00:00.000Z"); // рівно 14 днів після 25 липня
        assert!(trust_simplified_for_domain(
            &entries,
            "architecture",
            Some(3),
            now
        ));
    }

    #[test]
    fn trust_simplified_false_on_mandate_generation_change() {
        let entries: Vec<KnowledgeEntry> = (21..=25).map(|d| streak_entry(d, 1, Some(3))).collect();
        let now = dt("2026-07-30T10:00:00.000Z");
        // делегатор підписав нову генерацію мандатів — довіра-стрік старої генерації не рахується
        assert!(!trust_simplified_for_domain(
            &entries,
            "architecture",
            Some(4),
            now
        ));
    }

    #[test]
    fn trust_simplified_ignores_other_domains() {
        let mut entries: Vec<KnowledgeEntry> =
            (21..=25).map(|d| streak_entry(d, 1, Some(3))).collect();
        for e in &mut entries {
            e.domain = "architecture".into();
        }
        let now = dt("2026-07-30T10:00:00.000Z");
        assert!(!trust_simplified_for_domain(
            &entries,
            "process",
            Some(3),
            now
        ));
    }
}
