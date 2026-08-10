//! View-деривації карти мандатів поверх типів `mt-mandates` — порт
//! `delta/src/mandates.js` (`mandatesForOwner`/`escalationChain`/
//! `modelMandates`/`rootMandates`/`deriveMandatesView`). Сам парсинг/
//! валідація `.mt/mandates.yaml` — відповідальність `mt_mandates::
//! parse_mandates`/`parse_mandates_str` (реекспортовано з `crate::lib`), НЕ
//! цього модуля: на відміну від JS-мока (лінивий, толерантний до побитих
//! записів), реальний контракт валідує файл СТРУКТУРНО ЦІЛИМ — один
//! невалідний запис валить увесь файл (той самий інваріант, що
//! `parse_mandates_str` документує в mt-rust).

use mt_mandates::Mandate;

/// Усі мандати конкретного власника (mandates.js: `mandatesForOwner`).
/// Схема CODEOWNERS-подібна — кілька записів того самого `owner` лишаються
/// валідними (кожен зі своїм `scope`), хоч контракт `mt-mandates::parse_mandates`
/// вимагає унікальність `owner` на рівні файлу — цей фільтр лишається
/// коректним і тоді (повертає рівно один запис).
pub fn mandates_for_owner<'a>(mandates: &'a [Mandate], handle: Option<&str>) -> Vec<&'a Mandate> {
    let Some(handle) = handle else {
        return Vec::new();
    };
    mandates.iter().filter(|m| m.owner == handle).collect()
}

/// Ланцюг ескалації від `handle` до кореня (`escalates_to: None`), включно
/// зі стартовим handle (mandates.js: `escalationChain`). Захист від циклу в
/// даних фікстури: кожен owner заходить у ланцюг не більше разу (реальний
/// контракт `parse_mandates` уже відхиляє цикли структурно, але деривація
/// лишається безпечною й на сирих/непровалідованих зрізах).
pub fn escalation_chain(mandates: &[Mandate], handle: Option<&str>) -> Vec<String> {
    let mut chain = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut current = handle.map(str::to_string);
    while let Some(cur) = current {
        if seen.contains(&cur) {
            break;
        }
        let Some(found) = mandates.iter().find(|m| m.owner == cur) else {
            break;
        };
        seen.insert(cur.clone());
        chain.push(cur);
        current = found.escalates_to.clone();
    }
    chain
}

/// ШІ-мандати карти (`kind: model`) — першокласні учасники поруч із людьми
/// (mandates.js: `modelMandates`).
pub fn model_mandates(mandates: &[Mandate]) -> Vec<&Mandate> {
    mandates
        .iter()
        .filter(|m| m.kind == mt_mandates::MandateKind::Model)
        .collect()
}

/// Кореневі мандати карти (`escalates_to: null`) — вершини ланцюгів
/// ескалації (mandates.js: `rootMandates`). Контракт `parse_mandates`
/// вимагає рівно один такий запис на валідному файлі.
pub fn root_mandates(mandates: &[Mandate]) -> Vec<&Mandate> {
    mandates
        .iter()
        .filter(|m| m.escalates_to.is_none())
        .collect()
}

/// Повний деривований зріз карти для одного handle — єдина точка входу, яку
/// використовують і GUI (Tauri-команда), і CLI (`delta mandates_show`), щоб
/// обидві поверхні бачили той самий результат з того самого файлу
/// (mandates.js: `deriveMandatesView`).
pub struct MandatesView<'a> {
    pub mandates: &'a [Mandate],
    pub mine: Vec<&'a Mandate>,
    pub escalation_chain: Vec<String>,
    pub models: Vec<&'a Mandate>,
}

pub fn derive_mandates_view<'a>(mandates: &'a [Mandate], handle: Option<&str>) -> MandatesView<'a> {
    MandatesView {
        mandates,
        mine: mandates_for_owner(mandates, handle),
        escalation_chain: escalation_chain(mandates, handle),
        models: model_mandates(mandates),
    }
}

/// Серіалізує один мандат у camelCase JSON — байт-у-байт та сама форма
/// поля, що стара `mandates.js`-деривація віддавала GUI (Vue-компоненти
/// M0-M6 читають `thresholds.budgetEur`/`escalatesTo`/`scope.decisionTypes`
/// напряму). `mt_mandates::Mandate` серіалізується власним derive у
/// snake_case (контрактна YAML-форма) — camelCase-межа для існуючого GUI
/// проведена ТУТ, на виході CLI/Tauri-командного шару, а не окремою JS-
/// обгорткою (задокументоване рішення фази A: одна точка конверсії,
/// однакова для CLI JSON і Tauri invoke-результату).
pub fn mandate_to_camel_json(m: &Mandate) -> serde_json::Value {
    let kind = match m.kind {
        mt_mandates::MandateKind::Person => "person",
        mt_mandates::MandateKind::Model => "model",
    };
    let risk = m.thresholds.risk.map(|r| match r {
        mt_mandates::RiskLevel::Low => "low",
        mt_mandates::RiskLevel::Medium => "medium",
        mt_mandates::RiskLevel::High => "high",
    });
    let audacity = m.thresholds.audacity.map(|a| match a {
        mt_mandates::AudacityLevel::Low => "low",
        mt_mandates::AudacityLevel::Medium => "medium",
        mt_mandates::AudacityLevel::High => "high",
    });
    serde_json::json!({
        "owner": m.owner,
        "kind": kind,
        "scope": { "refs": m.scope.refs, "decisionTypes": m.scope.decision_types },
        "thresholds": {
            "budgetEur": m.thresholds.budget_eur,
            "risk": risk,
            "irreversible": m.thresholds.irreversible,
            "audacity": audacity,
        },
        "escalatesTo": m.escalates_to,
    })
}

/// Серіалізує повний деривований зріз ([`MandatesView`]) у camelCase JSON
/// — та сама форма, що `mandates.js: deriveMandatesView` (`mandates_show`
/// tool).
pub fn mandates_view_to_json(view: &MandatesView<'_>) -> serde_json::Value {
    serde_json::json!({
        "mandates": view.mandates.iter().map(mandate_to_camel_json).collect::<Vec<_>>(),
        "mine": view.mine.iter().map(|m| mandate_to_camel_json(m)).collect::<Vec<_>>(),
        "escalationChain": view.escalation_chain,
        "models": view.models.iter().map(|m| mandate_to_camel_json(m)).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mt_mandates::parse_mandates_str;

    // Та сама фікстура, що `delta/src/tests/fixtures/mandates.yaml`, +
    // `generation: 1` (контракт `mt-mandates` вимагає поле структурно —
    // JS-мок його не читав узагалі, тож фікстура delta історично без нього;
    // задокументована різниця парсера, не фікстури).
    const FIXTURE: &str = r#"
generation: 1
mandates:
  - owner: olena
    scope:
      refs: ["refs/mt/tasks/design/**"]
      decision_types: [architecture, ux]
    thresholds: { budget_eur: 2000, risk: medium, irreversible: false }
    escalates_to: vitalii
  - owner: fable-5
    kind: model
    scope:
      refs: ["refs/mt/tasks/routine/**"]
      decision_types: [ops]
    thresholds: { budget_eur: 200, risk: low, irreversible: false, audacity: medium }
    escalates_to: olena
  - owner: vitalii
    scope: { refs: ["refs/mt/**"], decision_types: ["*"] }
    thresholds: {}
    escalates_to: null
"#;

    fn fixture_mandates() -> Vec<Mandate> {
        parse_mandates_str(FIXTURE).expect("valid fixture").mandates
    }

    #[test]
    fn parses_fixture_into_three_mandates_in_file_order() {
        let mandates = fixture_mandates();
        assert_eq!(mandates.len(), 3);
        assert_eq!(
            mandates
                .iter()
                .map(|m| m.owner.as_str())
                .collect::<Vec<_>>(),
            vec!["olena", "fable-5", "vitalii"]
        );
    }

    #[test]
    fn kind_person_by_default_model_only_when_explicit() {
        let mandates = fixture_mandates();
        assert_eq!(mandates[0].kind, mt_mandates::MandateKind::Person);
        assert_eq!(mandates[1].kind, mt_mandates::MandateKind::Model);
        assert_eq!(mandates[2].kind, mt_mandates::MandateKind::Person);
    }

    #[test]
    fn mandates_for_owner_returns_known_owner() {
        let mandates = fixture_mandates();
        let mine = mandates_for_owner(&mandates, Some("olena"));
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].owner, "olena");
    }

    #[test]
    fn mandates_for_owner_unknown_or_missing_handle_is_empty() {
        let mandates = fixture_mandates();
        assert!(mandates_for_owner(&mandates, Some("ghost")).is_empty());
        assert!(mandates_for_owner(&mandates, None).is_empty());
    }

    #[test]
    fn escalation_chain_human_to_root() {
        let mandates = fixture_mandates();
        assert_eq!(
            escalation_chain(&mandates, Some("olena")),
            vec!["olena", "vitalii"]
        );
    }

    #[test]
    fn escalation_chain_model_passes_through_to_human_root() {
        let mandates = fixture_mandates();
        assert_eq!(
            escalation_chain(&mandates, Some("fable-5")),
            vec!["fable-5", "olena", "vitalii"]
        );
    }

    #[test]
    fn escalation_chain_root_is_single_element() {
        let mandates = fixture_mandates();
        assert_eq!(
            escalation_chain(&mandates, Some("vitalii")),
            vec!["vitalii"]
        );
    }

    #[test]
    fn escalation_chain_unknown_handle_is_empty() {
        let mandates = fixture_mandates();
        assert!(escalation_chain(&mandates, Some("ghost")).is_empty());
        assert!(escalation_chain(&mandates, None).is_empty());
    }

    #[test]
    fn model_mandates_returns_only_kind_model() {
        let mandates = fixture_mandates();
        assert_eq!(
            model_mandates(&mandates)
                .iter()
                .map(|m| m.owner.as_str())
                .collect::<Vec<_>>(),
            vec!["fable-5"]
        );
    }

    #[test]
    fn root_mandates_returns_without_escalates_to() {
        let mandates = fixture_mandates();
        assert_eq!(
            root_mandates(&mandates)
                .iter()
                .map(|m| m.owner.as_str())
                .collect::<Vec<_>>(),
            vec!["vitalii"]
        );
    }

    #[test]
    fn derive_mandates_view_two_users_see_different_slice() {
        let mandates = fixture_mandates();
        let olena_view = derive_mandates_view(&mandates, Some("olena"));
        assert_eq!(olena_view.mandates.len(), 3);
        assert_eq!(olena_view.mine.len(), 1);
        assert_eq!(olena_view.mine[0].owner, "olena");
        assert_eq!(olena_view.escalation_chain, vec!["olena", "vitalii"]);
        assert_eq!(
            olena_view
                .models
                .iter()
                .map(|m| m.owner.as_str())
                .collect::<Vec<_>>(),
            vec!["fable-5"]
        );

        let vitalii_view = derive_mandates_view(&mandates, Some("vitalii"));
        assert!(vitalii_view.mine[0].escalates_to.is_none());
        assert_eq!(vitalii_view.escalation_chain, vec!["vitalii"]);
    }

    #[test]
    fn derive_mandates_view_without_handle_mine_empty_rest_full() {
        let mandates = fixture_mandates();
        let view = derive_mandates_view(&mandates, None);
        assert!(view.mine.is_empty());
        assert_eq!(view.mandates.len(), 3);
    }
}
