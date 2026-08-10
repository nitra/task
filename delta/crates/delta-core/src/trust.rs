//! «Довіряю» — порт `delta/src/trust.js` (M3): мої ШІ-мандати
//! (`escalates_to === мій handle`) з трек-рекордом, audacity-описом
//! наслідків, мутатори «звузити»/«розширити» (MVP-скоуп однієї осі —
//! audacity ± один щабель, `budget_eur`-фолбек на межах).

use mt_mandates::{AudacityLevel, Mandate, MandateKind, MandatesFile};
use serde_json::{json, Value};

use crate::device_registry::DeviceRegistryEntry;
use crate::mandates::mandate_to_camel_json;
use crate::track_record::{derive_track_record, DecisionsDirScan};

pub fn audacity_description(level: AudacityLevel) -> &'static str {
    match level {
        AudacityLevel::Low => "Низька: агент питає людину перед тим, як відмовити постачальнику чи контрагенту.",
        AudacityLevel::Medium => "Середня: агент відмовляє сам, коли рішення зворотне (reversible) — без попереднього запиту.",
        AudacityLevel::High => "Висока: агент веде жорсткі переговори самостійно — обмежено інваріантом reversible (mandates.md): незворотне рішення high-зухвалість не дозволяє.",
    }
}

pub fn audacity_of(mandate: &Mandate) -> AudacityLevel {
    mandate.thresholds.audacity_or_default()
}

/// Дериваційний зріз екрана «Довіряю» — `trust.js: deriveTrustView`.
pub fn derive_trust_view(
    mandates_file: &MandatesFile,
    device_registry: &[DeviceRegistryEntry],
    decisions_dirs: &[DecisionsDirScan<'_>],
    handle: Option<&str>,
) -> Value {
    let my_models: Vec<&Mandate> = match handle {
        Some(h) => mandates_file
            .mandates
            .iter()
            .filter(|m| m.kind == MandateKind::Model && m.escalates_to.as_deref() == Some(h))
            .collect(),
        None => Vec::new(),
    };
    let items: Vec<Value> = my_models
        .iter()
        .map(|mandate| {
            let audacity = audacity_of(mandate);
            let track_record =
                derive_track_record(decisions_dirs, device_registry, &mandate.owner, None);
            json!({
                "mandate": mandate_to_camel_json(mandate),
                "audacity": audacity_str(audacity),
                "audacityDescription": audacity_description(audacity),
                "trackRecord": track_record,
            })
        })
        .collect();
    json!({"generation": mandates_file.generation, "items": items})
}

fn audacity_str(level: AudacityLevel) -> &'static str {
    match level {
        AudacityLevel::Low => "low",
        AudacityLevel::Medium => "medium",
        AudacityLevel::High => "high",
    }
}

/// Новий файл з одним заміненим мандатом (`generation + 1`) — `trust.js:
/// withMandateReplaced`.
pub fn with_mandate_replaced(
    file: &MandatesFile,
    owner_handle: &str,
    updater: impl Fn(&Mandate) -> Mandate,
) -> MandatesFile {
    MandatesFile {
        generation: file.generation + 1,
        mandates: file
            .mandates
            .iter()
            .map(|m| {
                if m.owner == owner_handle {
                    updater(m)
                } else {
                    m.clone()
                }
            })
            .collect(),
    }
}

fn audacity_up(level: AudacityLevel) -> Option<AudacityLevel> {
    match level {
        AudacityLevel::Low => Some(AudacityLevel::Medium),
        AudacityLevel::Medium => Some(AudacityLevel::High),
        AudacityLevel::High => None,
    }
}

fn audacity_down(level: AudacityLevel) -> Option<AudacityLevel> {
    match level {
        AudacityLevel::Low => None,
        AudacityLevel::Medium => Some(AudacityLevel::Low),
        AudacityLevel::High => Some(AudacityLevel::Medium),
    }
}

/// Звужений мандат на один щабель — `trust.js: narrowMandateOneStep`.
pub fn narrow_mandate_one_step(mandate: &Mandate) -> Mandate {
    let down = if mandate.kind == MandateKind::Model {
        audacity_down(audacity_of(mandate))
    } else {
        None
    };
    if let Some(down) = down {
        let mut m = mandate.clone();
        m.thresholds.audacity = Some(down);
        return m;
    }
    if let Some(budget) = mandate.thresholds.budget_eur {
        if budget > 0.0 {
            let mut m = mandate.clone();
            m.thresholds.budget_eur = Some((budget / 2.0).round().max(0.0));
            return m;
        }
    }
    mandate.clone()
}

/// Розширений мандат на один щабель — `trust.js: widenMandateOneStep`.
pub fn widen_mandate_one_step(mandate: &Mandate) -> Mandate {
    let up = if mandate.kind == MandateKind::Model {
        audacity_up(audacity_of(mandate))
    } else {
        None
    };
    if let Some(up) = up {
        let mut m = mandate.clone();
        m.thresholds.audacity = Some(up);
        return m;
    }
    let current_budget = mandate.thresholds.budget_eur.unwrap_or(0.0);
    let next_budget = if current_budget > 0.0 {
        (current_budget * 1.5).round()
    } else {
        50.0
    };
    let mut m = mandate.clone();
    m.thresholds.budget_eur = Some(next_budget);
    m
}

/// `trust.js: isAtWidenCeiling`.
pub fn is_at_widen_ceiling(mandate: &Mandate) -> bool {
    let audacity_capped =
        mandate.kind != MandateKind::Model || audacity_of(mandate) == AudacityLevel::High;
    audacity_capped && mandate.thresholds.budget_eur.is_none()
}

/// `trust.js: isAtNarrowFloor`.
pub fn is_at_narrow_floor(mandate: &Mandate) -> bool {
    let audacity_floored =
        mandate.kind != MandateKind::Model || audacity_of(mandate) == AudacityLevel::Low;
    audacity_floored && mandate.thresholds.budget_eur.is_none_or(|b| b == 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mt_mandates::{Scope, Thresholds};

    fn model_mandate(audacity: Option<AudacityLevel>, budget: Option<f64>) -> Mandate {
        Mandate {
            owner: "fable-5".into(),
            kind: MandateKind::Model,
            scope: Scope {
                refs: vec!["refs/mt/**".into()],
                decision_types: vec!["ops".into()],
            },
            thresholds: Thresholds {
                budget_eur: budget,
                risk: None,
                irreversible: None,
                audacity,
            },
            escalates_to: Some("olena".into()),
        }
    }

    #[test]
    fn narrow_steps_audacity_down_before_touching_budget() {
        let m = model_mandate(Some(AudacityLevel::Medium), Some(200.0));
        let narrowed = narrow_mandate_one_step(&m);
        assert_eq!(narrowed.thresholds.audacity, Some(AudacityLevel::Low));
        assert_eq!(narrowed.thresholds.budget_eur, Some(200.0)); // budget untouched — audacity axis moved instead
    }

    #[test]
    fn narrow_falls_back_to_budget_halving_at_audacity_floor() {
        let m = model_mandate(Some(AudacityLevel::Low), Some(200.0));
        let narrowed = narrow_mandate_one_step(&m);
        assert_eq!(narrowed.thresholds.audacity, Some(AudacityLevel::Low));
        assert_eq!(narrowed.thresholds.budget_eur, Some(100.0));
    }

    #[test]
    fn widen_steps_audacity_up_before_touching_budget() {
        let m = model_mandate(Some(AudacityLevel::Low), Some(200.0));
        let widened = widen_mandate_one_step(&m);
        assert_eq!(widened.thresholds.audacity, Some(AudacityLevel::Medium));
    }

    #[test]
    fn widen_falls_back_to_budget_1_5x_at_audacity_ceiling() {
        let m = model_mandate(Some(AudacityLevel::High), Some(200.0));
        let widened = widen_mandate_one_step(&m);
        assert_eq!(widened.thresholds.audacity, Some(AudacityLevel::High));
        assert_eq!(widened.thresholds.budget_eur, Some(300.0));
    }

    #[test]
    fn widen_ceiling_with_no_budget_defaults_to_50() {
        let m = model_mandate(Some(AudacityLevel::High), None);
        let widened = widen_mandate_one_step(&m);
        assert_eq!(widened.thresholds.budget_eur, Some(50.0));
    }

    #[test]
    fn is_at_ceiling_true_when_audacity_high_and_budget_uncapped() {
        let m = model_mandate(Some(AudacityLevel::High), None);
        assert!(is_at_widen_ceiling(&m));
    }

    #[test]
    fn is_at_floor_true_when_audacity_low_and_budget_zero_or_none() {
        let m = model_mandate(Some(AudacityLevel::Low), None);
        assert!(is_at_narrow_floor(&m));
        let m2 = model_mandate(Some(AudacityLevel::Low), Some(0.0));
        assert!(is_at_narrow_floor(&m2));
    }

    #[test]
    fn with_mandate_replaced_bumps_generation_and_replaces_only_target_owner() {
        let file = MandatesFile {
            generation: 3,
            mandates: vec![model_mandate(Some(AudacityLevel::Low), Some(200.0))],
        };
        let updated = with_mandate_replaced(&file, "fable-5", widen_mandate_one_step);
        assert_eq!(updated.generation, 4);
        assert_eq!(
            updated.mandates[0].thresholds.audacity,
            Some(AudacityLevel::Medium)
        );
    }
}
