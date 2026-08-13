//! Симуляція на історії для майстра делегування (конституція п.12:
//! «Редактор мандата — майстер делегування з симуляцією на історії: «за
//! минулий місяць це були б 14 рішень», прогноз частоти/ризику/ескалацій
//! перед підписом»). Детерміновано, БЕЗ LLM — той самий підхід, що
//! `report.rs`/`review.rs` (сканування вже наявних decision-request-ів,
//! чиста агрегація).
//!
//! **Свідома межа обсягу (задокументована, не забута):** мандат матчиться
//! на реальний decision-request двома осями `scope` — `refs` (git-glob
//! шляху задачі) і `decision_types`. Файловий мок `decisions/NNNN-decision-request.md`
//! (цього репо, `decisions.rs`) НЕ несе поля, еквівалентного `scope.refs`
//! (немає «звідки» ця розвилка в дереві задач — лише `computed_owner`,
//! уже обчислений маршрутизатором, і `decision_type`). Тому ця симуляція
//! матчить ЛИШЕ віссю `decision_types` — та сама вісь, якою користується
//! приклад із конституції («N рішень, з них M — irreversible», без
//! «з них K — під /design/**»). `refs` лишається чесним боргом, не
//! мовчазним пропуском — див. `docs/open-questions.md`.

use chrono::{DateTime, Utc};
use mt_mandates::Scope;

use crate::decisions::{
    parse_decision_request, DecisionRequest, DecisionRequestMeta, DecisionsDir,
};

fn covers_domain(scope: &Scope, domain: &str) -> bool {
    scope.covers_all_decision_types() || scope.decision_types.iter().any(|d| d == domain)
}

fn domain_of(dr: &DecisionRequest) -> String {
    dr.decision_type
        .clone()
        .unwrap_or_else(|| "general".to_string())
}

fn within_period(dr: &DecisionRequest, now: DateTime<Utc>, period_days: i64) -> bool {
    let Some(opened_at) = dr.opened_at.as_deref() else {
        return false; // немає opened_at — не рахуємо у вікно (fail-closed, не вгадуємо дату)
    };
    let Ok(opened) = DateTime::parse_from_rfc3339(opened_at) else {
        return false;
    };
    let age_days = (now.timestamp_millis() - opened.timestamp_millis()) / (24 * 60 * 60 * 1000);
    (0..=period_days).contains(&age_days)
}

#[derive(Debug, Clone, PartialEq)]
pub struct SimulationBucket {
    pub decision_type: String,
    pub count: usize,
    pub irreversible_count: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SimulationResult {
    pub period_days: i64,
    pub total: usize,
    pub irreversible_total: usize,
    pub buckets: Vec<SimulationBucket>,
}

/// Прогноз «за цей період у `scope` потрапило б N рішень (розбивка за
/// decision_type), з них M — irreversible» — конституція п.12. `exclude`
/// (наявний scope мандата ДО зміни) віднімає розвилки, що вже потрапляли б
/// туди і без цієї зміни — рахуються лише новозахоплені; `None` (немає
/// попереднього мандата — онбординг/новий мандат) рахує все, що matches
/// `scope`.
pub fn simulate_scope(
    dirs: &[DecisionsDir],
    scope: &Scope,
    exclude: Option<&Scope>,
    period_days: i64,
    now: DateTime<Utc>,
) -> SimulationResult {
    let mut by_domain: std::collections::BTreeMap<String, (usize, usize)> =
        std::collections::BTreeMap::new();

    for dir in dirs {
        for (name, content) in &dir.files {
            if !name.ends_with("-decision-request.md") {
                continue;
            }
            let Ok(dr) = parse_decision_request(content, DecisionRequestMeta::default()) else {
                continue;
            };
            if !within_period(&dr, now, period_days) {
                continue;
            }
            let domain = domain_of(&dr);
            if !covers_domain(scope, &domain) {
                continue;
            }
            if let Some(prev) = exclude {
                if covers_domain(prev, &domain) {
                    continue; // уже покривалось попереднім мандатом — не «новозахоплене»
                }
            }
            let entry = by_domain.entry(domain).or_insert((0, 0));
            entry.0 += 1;
            if dr.leverage_facets.irreversible {
                entry.1 += 1;
            }
        }
    }

    let buckets: Vec<SimulationBucket> = by_domain
        .into_iter()
        .map(
            |(decision_type, (count, irreversible_count))| SimulationBucket {
                decision_type,
                count,
                irreversible_count,
            },
        )
        .collect();
    let total = buckets.iter().map(|b| b.count).sum();
    let irreversible_total = buckets.iter().map(|b| b.irreversible_count).sum();

    SimulationResult {
        period_days,
        total,
        irreversible_total,
        buckets,
    }
}

pub fn simulation_to_json(result: &SimulationResult) -> serde_json::Value {
    serde_json::json!({
        "periodDays": result.period_days,
        "total": result.total,
        "irreversibleTotal": result.irreversible_total,
        "buckets": result.buckets.iter().map(|b| serde_json::json!({
            "decisionType": b.decision_type,
            "count": b.count,
            "irreversibleCount": b.irreversible_count,
        })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(decision_types: &[&str]) -> Scope {
        Scope {
            refs: vec!["refs/mt/**".into()],
            decision_types: decision_types.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn dr_fixture(decision_type: &str, opened_at: &str, irreversible: bool) -> String {
        format!(
            "---\ntype: decision-request\ncomputed_owner: olena\nleverage_facets: {{ irreversible: {irreversible} }}\ndecision_type: {decision_type}\nopened_at: \"{opened_at}\"\n---\n\n## Контекст\nx\n"
        )
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-08-13T00:00:00.000Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn counts_matching_domain_within_period() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![(
                "0001-decision-request.md".into(),
                dr_fixture("architecture", "2026-08-01T00:00:00.000Z", false),
            )],
        }];
        let result = simulate_scope(&dirs, &scope(&["architecture"]), None, 90, now());
        assert_eq!(result.total, 1);
        assert_eq!(result.irreversible_total, 0);
        assert_eq!(result.buckets[0].decision_type, "architecture");
    }

    #[test]
    fn excludes_domains_outside_scope() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![(
                "0001-decision-request.md".into(),
                dr_fixture("ops", "2026-08-01T00:00:00.000Z", false),
            )],
        }];
        let result = simulate_scope(&dirs, &scope(&["architecture"]), None, 90, now());
        assert_eq!(result.total, 0);
        assert!(result.buckets.is_empty());
    }

    #[test]
    fn excludes_decisions_outside_time_window() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![(
                "0001-decision-request.md".into(),
                dr_fixture("architecture", "2026-01-01T00:00:00.000Z", false),
            )],
        }];
        let result = simulate_scope(&dirs, &scope(&["architecture"]), None, 90, now());
        assert_eq!(result.total, 0);
    }

    #[test]
    fn missing_opened_at_is_excluded_fail_closed() {
        let text =
            "---\ntype: decision-request\ndecision_type: architecture\n---\n\n## Контекст\nx\n";
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![("0001-decision-request.md".into(), text.to_string())],
        }];
        let result = simulate_scope(&dirs, &scope(&["architecture"]), None, 90, now());
        assert_eq!(result.total, 0);
    }

    #[test]
    fn counts_irreversible_subset_per_bucket() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![
                (
                    "0001-decision-request.md".into(),
                    dr_fixture("architecture", "2026-08-01T00:00:00.000Z", true),
                ),
                (
                    "0002-decision-request.md".into(),
                    dr_fixture("architecture", "2026-08-05T00:00:00.000Z", false),
                ),
            ],
        }];
        let result = simulate_scope(&dirs, &scope(&["architecture"]), None, 90, now());
        assert_eq!(result.total, 2);
        assert_eq!(result.irreversible_total, 1);
        assert_eq!(result.buckets[0].count, 2);
        assert_eq!(result.buckets[0].irreversible_count, 1);
    }

    #[test]
    fn wildcard_scope_covers_any_domain() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![(
                "0001-decision-request.md".into(),
                dr_fixture("ops", "2026-08-01T00:00:00.000Z", false),
            )],
        }];
        let result = simulate_scope(&dirs, &scope(&["*"]), None, 90, now());
        assert_eq!(result.total, 1);
    }

    #[test]
    fn exclude_scope_only_counts_newly_captured_decisions() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![
                (
                    "0001-decision-request.md".into(),
                    dr_fixture("architecture", "2026-08-01T00:00:00.000Z", false),
                ),
                (
                    "0002-decision-request.md".into(),
                    dr_fixture("ops", "2026-08-05T00:00:00.000Z", false),
                ),
            ],
        }];
        // new scope: architecture + ops; old scope already had architecture — only ops is "new"
        let result = simulate_scope(
            &dirs,
            &scope(&["architecture", "ops"]),
            Some(&scope(&["architecture"])),
            90,
            now(),
        );
        assert_eq!(result.total, 1);
        assert_eq!(result.buckets[0].decision_type, "ops");
    }

    #[test]
    fn no_exclude_counts_everything_matching_new_scope() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![(
                "0001-decision-request.md".into(),
                dr_fixture("architecture", "2026-08-01T00:00:00.000Z", false),
            )],
        }];
        let result = simulate_scope(&dirs, &scope(&["architecture"]), None, 90, now());
        assert_eq!(result.total, 1);
    }

    #[test]
    fn invalid_decision_request_is_skipped_not_fatal() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo/decisions".into(),
            files: vec![(
                "0001-decision-request.md".into(),
                "not valid frontmatter at all { [".into(),
            )],
        }];
        let result = simulate_scope(&dirs, &scope(&["*"]), None, 90, now());
        assert_eq!(result.total, 0);
    }
}
