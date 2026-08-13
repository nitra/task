//! `delta-core` — спільна логіка гейт-ядра Delta App (фаза A), яку лінкують
//! і Tauri-бекенд (GUI), і `delta-cli` (CLI) — інваріант «GUI і CLI — одна
//! логіка» (n-tool-surface). Портовано 1:1 з `delta/src/{mandates,decisions,
//! signing,approval}.js` (JS-тести — специфікація семантики; квіз/кворум —
//! окремий крок, ще не портовано, див. README).
//!
//! `mandates` більше НЕ мокає парсер `.mt/mandates.yaml` — читає й валідує
//! через `mt-mandates` (nitra/mt-rust), справжню реалізацію нормативного
//! контракту (mandates.md, «M6 фаза 0»); лишає лише view-деривації delta
//! (`mandatesForOwner`/`escalationChain`/`modelMandates`/`deriveMandatesView`)
//! поверх його типів.

pub mod ai_petition;
pub mod approval;
pub mod candor;
pub mod change_proposal;
pub mod decision_flow;
pub mod decisions;
pub mod delegation;
pub mod device_registry;
pub mod directory;
pub mod drift;
pub mod io;
pub mod kill_switch;
pub mod knowledge;
pub mod mandate_change;
pub mod mandates;
pub mod onboarding;
pub mod org;
pub mod profiles;
pub mod quiz;
pub mod quorum;
pub mod report;
pub mod review;
pub mod signing;
pub mod simulation;
pub mod staff;
#[cfg(test)]
pub(crate) mod test_support;
pub mod track_record;
pub mod trust;
pub mod watcher;
pub mod what_system_knows;

// Реекспорт mt-mandates типів/парсера — виклик-сайти delta-core не повинні
// імпортувати `mt_mandates` напряму для базових операцій з картою мандатів.
pub use mt_mandates::{
    parse_mandates, parse_mandates_str, Mandate, MandateKind, MandatesError, MandatesFile, Scope,
    Thresholds,
};
