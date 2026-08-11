//! Спільні test-fixture-хелпери для `#[cfg(test)]` модулів delta-core.
//! `base_file` дублювався 1:1 у `ai_petition.rs`/`change_proposal.rs`/
//! `mandate_change.rs`; `mandates_fixture`/`dt` — у `report.rs`/`review.rs`
//! (jscpd `js/jscpd_duplicates`). Єдине джерело правди тут.

use chrono::{DateTime, Utc};
use mt_mandates::{
    AudacityLevel, Mandate, MandateKind, MandatesFile, RiskLevel, Scope, Thresholds,
};

/// Три-мандатний файл (олена/віталій/fable-5), той самий, що спека
/// `docs/architecture/mandates.md` наводить прикладом.
pub fn base_file(generation: u64) -> MandatesFile {
    MandatesFile {
        generation,
        mandates: vec![
            Mandate {
                owner: "olena".into(),
                kind: MandateKind::Person,
                scope: Scope {
                    refs: vec!["refs/mt/tasks/design/**".into()],
                    decision_types: vec!["architecture".into()],
                },
                thresholds: Thresholds {
                    budget_eur: Some(2000.0),
                    risk: None,
                    irreversible: Some(false),
                    audacity: None,
                },
                escalates_to: Some("vitalii".into()),
            },
            Mandate {
                owner: "vitalii".into(),
                kind: MandateKind::Person,
                scope: Scope {
                    refs: vec!["refs/mt/**".into()],
                    decision_types: vec!["*".into()],
                },
                thresholds: Thresholds::default(),
                escalates_to: None,
            },
            Mandate {
                owner: "fable-5".into(),
                kind: MandateKind::Model,
                scope: Scope {
                    refs: vec!["refs/mt/tasks/routine/**".into()],
                    decision_types: vec!["ops".into()],
                },
                thresholds: Thresholds {
                    budget_eur: Some(200.0),
                    risk: None,
                    irreversible: Some(false),
                    audacity: Some(AudacityLevel::Medium),
                },
                escalates_to: Some("olena".into()),
            },
        ],
    }
}

/// Той самий три-мандатний набір, що [`base_file`], але як голий
/// `Vec<Mandate>` (без `generation`) і з заповненим `risk` — форма, якою
/// оперують `report.rs`/`review.rs`.
pub fn mandates_fixture() -> Vec<Mandate> {
    vec![
        Mandate {
            owner: "fable-5".into(),
            kind: MandateKind::Model,
            scope: Scope {
                refs: vec!["refs/mt/tasks/routine/**".into()],
                decision_types: vec!["ops".into()],
            },
            thresholds: Thresholds {
                budget_eur: Some(200.0),
                risk: Some(RiskLevel::Low),
                irreversible: Some(false),
                audacity: Some(AudacityLevel::Medium),
            },
            escalates_to: Some("olena".into()),
        },
        Mandate {
            owner: "olena".into(),
            kind: MandateKind::Person,
            scope: Scope {
                refs: vec!["refs/mt/tasks/design/**".into()],
                decision_types: vec!["architecture".into()],
            },
            thresholds: Thresholds {
                budget_eur: Some(2000.0),
                risk: Some(RiskLevel::Medium),
                irreversible: Some(false),
                audacity: None,
            },
            escalates_to: Some("vitalii".into()),
        },
        Mandate {
            owner: "vitalii".into(),
            kind: MandateKind::Person,
            scope: Scope {
                refs: vec!["refs/mt/**".into()],
                decision_types: vec!["*".into()],
            },
            thresholds: Thresholds {
                budget_eur: None,
                risk: None,
                irreversible: None,
                audacity: None,
            },
            escalates_to: None,
        },
    ]
}

pub fn dt(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
}
