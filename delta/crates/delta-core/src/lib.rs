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
pub mod change_proposal;
pub mod decision_flow;
pub mod decisions;
pub mod device_registry;
pub mod io;
pub mod knowledge;
pub mod mandate_change;
pub mod mandates;
pub mod quiz;
pub mod quorum;
pub mod signing;
pub mod track_record;
pub mod trust;

// Реекспорт mt-mandates типів/парсера — виклик-сайти delta-core не повинні
// імпортувати `mt_mandates` напряму для базових операцій з картою мандатів.
pub use mt_mandates::{
    parse_mandates, parse_mandates_str, Mandate, MandateKind, MandatesError, MandatesFile, Scope,
    Thresholds,
};
