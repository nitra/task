//! Тижневе дельта-рев'ю (M6) — порт `delta/src/review.js`. Детермінований
//! порядок денний — БЕЗ LLM, три секції: (а) draft-пропозиції розширення
//! (моделі з ≥ `widenThreshold` рішень без override за період, чий
//! делегатор БЕЗ активного kill-switch — рев'ю САМЕ матеріалізує
//! change-proposal через `ai_petition`-патерн, підписує ЛЮДИНА звичайним
//! потоком); (б) кандидати на звуження (override-и за період АБО активний
//! kill-switch делегатора — інформаційний список, дій не виконує); (в)
//! відкриті розбіжності кворумів і застарілі розвилки, по УСІХ
//! decision-request-ах воркспейсу (організаційна прозорість, на відміну
//! від приватного `drift.rs`).

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::Serialize;

use crate::ai_petition::ai_petition;
use crate::decisions::{
    derive_quorum_status, parse_decision_request, requires_quorum, DecisionRequestMeta,
    DecisionsDir, QuorumState, SignedApproval,
};
use crate::device_registry::{DeviceRegistryEntry, SignerRole};
use crate::io::Io;
use crate::mandates::model_mandates;
use crate::signing::DeviceKeypair;
use crate::track_record::{derive_track_record, DecisionsDirScan, RecentDecision};
use crate::trust::widen_mandate_one_step;
use mt_mandates::{Mandate, MandatesFile};

const DAY_MS_F64: f64 = 24.0 * 60.0 * 60.0 * 1000.0;
const DEFAULT_WIDEN_THRESHOLD: usize = 5;
const DEFAULT_STALE_DAYS: f64 = 7.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReviewConfig {
    pub widen_threshold: usize,
    pub stale_days: f64,
}

pub fn default_review_config() -> ReviewConfig {
    ReviewConfig {
        widen_threshold: DEFAULT_WIDEN_THRESHOLD,
        stale_days: DEFAULT_STALE_DAYS,
    }
}

fn run_id_of(dir: &str) -> Option<String> {
    let parts: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return None;
    }
    Some(parts[parts.len() - 2].to_string())
}

fn decision_request_nnnn(name: &str) -> Option<String> {
    let re = Regex::new(r"^(\d{4})-decision-request\.md$").expect("статичний regex валідний");
    re.captures(name).map(|c| c[1].to_string())
}

fn within_period(iso: Option<&str>, start: DateTime<Utc>, end: DateTime<Utc>) -> bool {
    let Some(iso) = iso else { return false };
    let Ok(dt) = DateTime::parse_from_rfc3339(iso) else {
        return false;
    };
    let dt = dt.with_timezone(&Utc);
    dt >= start && dt <= end
}

fn decisions_dir_scans(decisions_dirs: &[DecisionsDir]) -> Vec<DecisionsDirScan<'_>> {
    decisions_dirs
        .iter()
        .map(|d| DecisionsDirScan {
            dir: &d.dir,
            files: &d.files,
        })
        .collect()
}

struct ModelActivity<'a> {
    model: &'a Mandate,
    in_period: Vec<RecentDecision>,
    override_free_in_period: Vec<RecentDecision>,
    overridden_in_period: Vec<RecentDecision>,
}

/// (а)/(б) Один прохід трек-рекорду КОЖНОЇ моделі за період — спільна
/// основа для draft-widen і narrow-кандидатів (`review.js:
/// modelActivityInPeriod`).
fn model_activity_in_period<'a>(
    mandates: &'a [Mandate],
    decisions_dirs: &[DecisionsDir],
    device_registry: &[DeviceRegistryEntry],
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> Vec<ModelActivity<'a>> {
    let scans = decisions_dir_scans(decisions_dirs);
    model_mandates(mandates)
        .into_iter()
        .map(|model| {
            let track_record =
                derive_track_record(&scans, device_registry, &model.owner, Some(usize::MAX));
            let in_period: Vec<RecentDecision> = track_record
                .recent
                .into_iter()
                .filter(|e| within_period(e.signed_at.as_deref(), period_start, period_end))
                .collect();
            let override_free_in_period: Vec<RecentDecision> = in_period
                .iter()
                .filter(|e| !e.r#override)
                .cloned()
                .collect();
            let overridden_in_period: Vec<RecentDecision> =
                in_period.iter().filter(|e| e.r#override).cloned().collect();
            ModelActivity {
                model,
                in_period,
                override_free_in_period,
                overridden_in_period,
            }
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WidenCandidate {
    #[serde(rename = "modelHandle")]
    pub model_handle: String,
    #[serde(rename = "delegatorHandle")]
    pub delegator_handle: Option<String>,
    #[serde(rename = "decisionsInPeriod")]
    pub decisions_in_period: usize,
    #[serde(rename = "overrideFreeInPeriod")]
    pub override_free_in_period: usize,
}

/// (а) Кандидати на розширення — ЛИШЕ дериваційний список (без IO), кожен
/// запис несе усе потрібне для {@link materialize_widen_proposals}
/// (`review.js: draftWidenCandidates`).
pub fn draft_widen_candidates(
    mandates: &[Mandate],
    decisions_dirs: &[DecisionsDir],
    device_registry: &[DeviceRegistryEntry],
    kill_switch_active_handles: &HashSet<String>,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
    widen_threshold: usize,
) -> Vec<WidenCandidate> {
    let activity = model_activity_in_period(
        mandates,
        decisions_dirs,
        device_registry,
        period_start,
        period_end,
    );
    let mut candidates = Vec::new();
    for a in activity {
        if let Some(delegator) = &a.model.escalates_to {
            if kill_switch_active_handles.contains(delegator) {
                continue;
            }
        }
        if a.override_free_in_period.len() < widen_threshold {
            continue;
        }
        candidates.push(WidenCandidate {
            model_handle: a.model.owner.clone(),
            delegator_handle: a.model.escalates_to.clone(),
            decisions_in_period: a.in_period.len(),
            override_free_in_period: a.override_free_in_period.len(),
        });
    }
    candidates.sort_by_key(|c| std::cmp::Reverse(c.override_free_in_period));
    candidates
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NarrowCandidate {
    #[serde(rename = "modelHandle")]
    pub model_handle: String,
    #[serde(rename = "delegatorHandle")]
    pub delegator_handle: Option<String>,
    #[serde(rename = "overriddenInPeriod")]
    pub overridden_in_period: usize,
    #[serde(rename = "delegatorKillSwitchActive")]
    pub delegator_kill_switch_active: bool,
}

/// (б) Кандидати на звуження — override-и за період АБО активний
/// kill-switch делегатора (снепшот «зараз»). Інформаційний список, дій не
/// виконує (`review.js: narrowCandidates`).
pub fn narrow_candidates(
    mandates: &[Mandate],
    decisions_dirs: &[DecisionsDir],
    device_registry: &[DeviceRegistryEntry],
    kill_switch_active_handles: &HashSet<String>,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> Vec<NarrowCandidate> {
    let activity = model_activity_in_period(
        mandates,
        decisions_dirs,
        device_registry,
        period_start,
        period_end,
    );
    let mut candidates = Vec::new();
    for a in activity {
        let delegator_kill_switch_active = a
            .model
            .escalates_to
            .as_ref()
            .is_some_and(|d| kill_switch_active_handles.contains(d));
        if a.overridden_in_period.is_empty() && !delegator_kill_switch_active {
            continue;
        }
        candidates.push(NarrowCandidate {
            model_handle: a.model.owner.clone(),
            delegator_handle: a.model.escalates_to.clone(),
            overridden_in_period: a.overridden_in_period.len(),
            delegator_kill_switch_active,
        });
    }
    candidates.sort_by_key(|c| std::cmp::Reverse(c.overridden_in_period));
    candidates
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DivergedDecision {
    #[serde(rename = "runId")]
    pub run_id: Option<String>,
    pub nnnn: String,
    #[serde(rename = "decisionType")]
    pub decision_type: String,
    pub signed: Vec<SignedApproval>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StaleDecision {
    #[serde(rename = "runId")]
    pub run_id: Option<String>,
    pub nnnn: String,
    #[serde(rename = "decisionType")]
    pub decision_type: String,
    #[serde(rename = "computedOwner")]
    pub computed_owner: Option<String>,
    #[serde(rename = "ageDays")]
    pub age_days: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OpenDisputes {
    pub diverged: Vec<DivergedDecision>,
    pub stale: Vec<StaleDecision>,
}

/// (в) Відкриті розбіжності кворумів і застарілі розвилки — по УСІХ
/// decision-request-ах воркспейсу, організаційна прозорість (`review.js:
/// openDisputes`).
pub fn open_disputes(
    decisions_dirs: &[DecisionsDir],
    now: DateTime<Utc>,
    stale_days: f64,
) -> Result<OpenDisputes, String> {
    let mut diverged = Vec::new();
    let mut stale = Vec::new();
    for d in decisions_dirs {
        let files_by_name: std::collections::HashMap<String, String> =
            d.files.iter().cloned().collect();
        for (name, content) in &d.files {
            let Some(nnnn) = decision_request_nnnn(name) else {
                continue;
            };
            let run_id = run_id_of(&d.dir);
            let parsed = parse_decision_request(
                content,
                DecisionRequestMeta {
                    path: Some(format!("{}/{}", d.dir, name)),
                    run_id: run_id.clone(),
                    nnnn: Some(nnnn.clone()),
                },
            )
            .map_err(|e| e.to_string())?;
            let decision_type = parsed
                .decision_type
                .clone()
                .unwrap_or_else(|| "general".to_string());

            if requires_quorum(&parsed.leverage_facets) {
                let quorum = derive_quorum_status(&parsed, &files_by_name);
                if quorum.status == QuorumState::Diverged {
                    diverged.push(DivergedDecision {
                        run_id,
                        nnnn,
                        decision_type,
                        signed: quorum.signed,
                    });
                }
                continue; // кворумні — «застаріле» тут не рахуємо (той самий інваріант, що drift.rs)
            }

            if files_by_name.contains_key(&format!("{nnnn}-approval.json")) {
                continue;
            }
            let Some(opened_at) = &parsed.opened_at else {
                continue;
            };
            let Ok(opened_dt) = DateTime::parse_from_rfc3339(opened_at) else {
                continue;
            };
            let age_days =
                (now - opened_dt.with_timezone(&Utc)).num_milliseconds() as f64 / DAY_MS_F64;
            if age_days < stale_days {
                continue;
            }
            stale.push(StaleDecision {
                run_id,
                nnnn,
                decision_type,
                computed_owner: parsed.computed_owner.clone(),
                age_days: age_days.round() as i64,
            });
        }
    }
    stale.sort_by_key(|s| std::cmp::Reverse(s.age_days));
    Ok(OpenDisputes { diverged, stale })
}

/// Транспорт-специфічне завантаження (чи генерація) ключа моделі —
/// `review.js: params.loadModelDeviceKey`.
#[async_trait::async_trait]
pub trait ModelDeviceKeyLoader: Send + Sync {
    async fn load_model_device_key(&self, model_handle: &str) -> DeviceKeypair;
}

/// Транспорт-специфічна реєстрація pubkey у `device-registry.json`
/// (опційно) — `review.js: params.registerDevice`.
#[async_trait::async_trait]
pub trait DeviceRegistrar: Send + Sync {
    async fn register_device(&self, handle: &str, role: SignerRole, pubkey_base64: &str);
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MaterializedWidenProposal {
    #[serde(rename = "modelHandle")]
    pub model_handle: String,
    #[serde(rename = "delegatorHandle")]
    pub delegator_handle: String,
    #[serde(rename = "changeId")]
    pub change_id: String,
    #[serde(rename = "decisionRequestPath")]
    pub decision_request_path: String,
}

/// Матеріалізує draft change-proposal для КОЖНОГО widen-кандидата — один
/// виклик `ai_petition` на кандидата. Ідемпотентно за конструкцією
/// `changeId` (`review-{generation}-{model}`) (`review.js:
/// materializeWidenProposals`).
#[allow(clippy::too_many_arguments)]
pub async fn materialize_widen_proposals(
    io: &dyn Io,
    mandates_dir: &str,
    mandates_file: &MandatesFile,
    candidates: &[WidenCandidate],
    load_model_device_key: &dyn ModelDeviceKeyLoader,
    register_device: Option<&dyn DeviceRegistrar>,
    decisions_dirs: &[DecisionsDir],
    device_registry: &[DeviceRegistryEntry],
    now: Option<DateTime<Utc>>,
) -> Vec<MaterializedWidenProposal> {
    let scans = decisions_dir_scans(decisions_dirs);
    let mut created = Vec::new();
    for candidate in candidates {
        let Some(delegator_handle) = &candidate.delegator_handle else {
            continue;
        };
        let Some(mandate) = mandates_file
            .mandates
            .iter()
            .find(|m| m.owner == candidate.model_handle)
        else {
            continue;
        };
        let widened = widen_mandate_one_step(mandate);
        let new_mandates: Vec<Mandate> = mandates_file
            .mandates
            .iter()
            .map(|m| {
                if m.owner == candidate.model_handle {
                    widened.clone()
                } else {
                    m.clone()
                }
            })
            .collect();
        let new_file = MandatesFile {
            generation: mandates_file.generation + 1,
            mandates: new_mandates,
        };

        let model_device_key = load_model_device_key
            .load_model_device_key(&candidate.model_handle)
            .await;
        if let Some(registrar) = register_device {
            registrar
                .register_device(
                    &candidate.model_handle,
                    SignerRole::Model,
                    &model_device_key.public_key_base64,
                )
                .await;
        }
        let track_record =
            derive_track_record(&scans, device_registry, &candidate.model_handle, None);
        let change_id = format!(
            "review-{}-{}",
            mandates_file.generation, candidate.model_handle
        );
        if let Some(result) = ai_petition(
            io,
            mandates_dir,
            &change_id,
            mandates_file,
            &new_file,
            &candidate.model_handle,
            delegator_handle,
            &track_record,
            &model_device_key,
            now,
        )
        .await
        {
            created.push(MaterializedWidenProposal {
                model_handle: candidate.model_handle.clone(),
                delegator_handle: delegator_handle.clone(),
                change_id,
                decision_request_path: result.written.decision_request_path,
            });
        }
    }
    created
}

fn widen_section_lines(
    widen_candidates: &[WidenCandidate],
    materialized: &[MaterializedWidenProposal],
) -> Vec<String> {
    if widen_candidates.is_empty() {
        return vec![
            "Жодна модель не набрала порогу без-override рішень за період.".to_string(),
            String::new(),
        ];
    }
    let mut lines = Vec::new();
    for c in widen_candidates {
        let draft = materialized
            .iter()
            .find(|m| m.model_handle == c.model_handle);
        let draft_note = draft
            .map(|d| {
                format!(
                    " — чернетка готова: `{}` (`{}`)",
                    d.change_id, d.decision_request_path
                )
            })
            .unwrap_or_default();
        lines.push(format!(
            "- **{}** → делегатор `{}`: {}/{} без override за період{}",
            c.model_handle,
            c.delegator_handle.as_deref().unwrap_or("—"),
            c.override_free_in_period,
            c.decisions_in_period,
            draft_note
        ));
    }
    lines.push(String::new());
    lines
}

fn narrow_section_lines(narrow: &[NarrowCandidate]) -> Vec<String> {
    if narrow.is_empty() {
        return vec![
            "Жодного кандидата — override-ів немає, kill-switch не активний.".to_string(),
            String::new(),
        ];
    }
    let mut lines = Vec::new();
    for c in narrow {
        let mut reasons = Vec::new();
        if c.overridden_in_period > 0 {
            reasons.push(format!(
                "{} override(-и/ів) за період",
                c.overridden_in_period
            ));
        }
        if c.delegator_kill_switch_active {
            reasons.push(format!(
                "делегатор `{}` — активний kill-switch",
                c.delegator_handle.as_deref().unwrap_or("—")
            ));
        }
        lines.push(format!(
            "- **{}** → делегатор `{}`: {}",
            c.model_handle,
            c.delegator_handle.as_deref().unwrap_or("—"),
            reasons.join("; ")
        ));
    }
    lines.push(String::new());
    lines
}

fn format_signed_options(signed: &[SignedApproval]) -> String {
    signed
        .iter()
        .map(|s| format!("{}→{}", s.handle, s.chosen_option.as_deref().unwrap_or("—")))
        .collect::<Vec<_>>()
        .join(", ")
}

fn disputes_section_lines(disputes: &OpenDisputes) -> Vec<String> {
    let mut lines = Vec::new();
    if disputes.diverged.is_empty() {
        lines.push("Розбіжностей кворуму немає.".to_string());
        lines.push(String::new());
    } else {
        lines.push("Розбіжності кворуму (усі підписали, chosen_option розійшовся):".to_string());
        lines.push(String::new());
        for d in &disputes.diverged {
            lines.push(format!(
                "- {}/{} ({}): {}",
                d.run_id.as_deref().unwrap_or("—"),
                d.nnnn,
                d.decision_type,
                format_signed_options(&d.signed)
            ));
        }
        lines.push(String::new());
    }
    if disputes.stale.is_empty() {
        lines.push("Застарілих розвилок немає.".to_string());
        lines.push(String::new());
    } else {
        lines.push("Застарілі розвилки (відкриті, старші за поріг):".to_string());
        lines.push(String::new());
        for s in &disputes.stale {
            lines.push(format!(
                "- {}/{} ({}), власник `{}`, {} дн.",
                s.run_id.as_deref().unwrap_or("—"),
                s.nnnn,
                s.decision_type,
                s.computed_owner.as_deref().unwrap_or("—"),
                s.age_days
            ));
        }
        lines.push(String::new());
    }
    lines
}

/// Рендерить порядок денний у ДЕТЕРМІНОВАНИЙ markdown — жодного LLM
/// (`review.js: formatReviewAgendaMarkdown`).
pub fn format_review_agenda_markdown(
    period_start: &str,
    period_end: &str,
    widen_candidates: &[WidenCandidate],
    materialized: &[MaterializedWidenProposal],
    narrow: &[NarrowCandidate],
    disputes: &OpenDisputes,
) -> String {
    let title = format!(
        "# Дельта-рев’ю: порядок денний — {} — {}",
        &period_start[..10.min(period_start.len())],
        &period_end[..10.min(period_end.len())]
    );
    let subtitle = "30 хв, єдина синхронна церемонія (README, «Ритуал дельта-рев’ю»).";
    let mut lines = vec![
        title,
        String::new(),
        subtitle.to_string(),
        String::new(),
        "## Draft-пропозиції розширення".to_string(),
        String::new(),
    ];
    lines.extend(widen_section_lines(widen_candidates, materialized));
    lines.push("## Кандидати на звуження".to_string());
    lines.push(String::new());
    lines.extend(narrow_section_lines(narrow));
    lines.push("## Відкриті розбіжності й застарілі розвилки".to_string());
    lines.push(String::new());
    lines.extend(disputes_section_lines(disputes));
    format!("{}\n", lines.join("\n"))
}

/// `.mt/reviews/YYYY-MM-DD-agenda.md` (`review.js: reviewAgendaPath`).
pub fn review_agenda_path(mandates_dir: &str, period_end_iso: &str) -> String {
    let date = period_end_iso.get(0..10).unwrap_or(period_end_iso);
    format!("{mandates_dir}/.mt/reviews/{date}-agenda.md")
}

pub struct ReviewAgendaOutput {
    pub widen_candidates: Vec<WidenCandidate>,
    pub materialized: Vec<MaterializedWidenProposal>,
    pub narrow_candidates: Vec<NarrowCandidate>,
    pub disputes: OpenDisputes,
    pub markdown: String,
    pub path: String,
}

/// Повний потік `review_agenda`: деривує три секції, МАТЕРІАЛІЗУЄ
/// draft-widen change-proposal-и, рендерить і пише markdown (`review.js:
/// reviewAgenda`).
#[allow(clippy::too_many_arguments)]
pub async fn review_agenda(
    io: &dyn Io,
    mandates_dir: &str,
    mandates_file: &MandatesFile,
    decisions_dirs: &[DecisionsDir],
    device_registry: &[DeviceRegistryEntry],
    kill_switch_active_handles: &HashSet<String>,
    load_model_device_key: &dyn ModelDeviceKeyLoader,
    register_device: Option<&dyn DeviceRegistrar>,
    period_days: i64,
    config: Option<ReviewConfig>,
    now: Option<DateTime<Utc>>,
) -> Result<ReviewAgendaOutput, String> {
    let resolved_config = config.unwrap_or_else(default_review_config);
    let now_date = now.unwrap_or_else(Utc::now);
    let period_end = now_date;
    let period_start = now_date - chrono::Duration::days(period_days);
    let mandates = &mandates_file.mandates;

    let widen_candidates = draft_widen_candidates(
        mandates,
        decisions_dirs,
        device_registry,
        kill_switch_active_handles,
        period_start,
        period_end,
        resolved_config.widen_threshold,
    );
    let narrow = narrow_candidates(
        mandates,
        decisions_dirs,
        device_registry,
        kill_switch_active_handles,
        period_start,
        period_end,
    );
    let disputes = open_disputes(decisions_dirs, now_date, resolved_config.stale_days)?;

    let materialized = materialize_widen_proposals(
        io,
        mandates_dir,
        mandates_file,
        &widen_candidates,
        load_model_device_key,
        register_device,
        decisions_dirs,
        device_registry,
        now,
    )
    .await;

    let period_start_iso = period_start.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let period_end_iso = period_end.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let markdown = format_review_agenda_markdown(
        &period_start_iso,
        &period_end_iso,
        &widen_candidates,
        &materialized,
        &narrow,
        &disputes,
    );
    let path = review_agenda_path(mandates_dir, &period_end_iso);
    io.write_file(&path, &markdown).await;

    Ok(ReviewAgendaOutput {
        widen_candidates,
        materialized,
        narrow_candidates: narrow,
        disputes,
        markdown,
        path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemoryIo;
    use crate::signing::generate_device_keypair;
    use mt_mandates::{AudacityLevel, MandateKind, RiskLevel, Scope, Thresholds};
    use std::sync::Mutex;

    fn dt(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn mandates_fixture() -> Vec<Mandate> {
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

    fn model_decisions_dir(count: usize, model_pubkey: &str) -> DecisionsDir {
        let mut files = Vec::new();
        for i in 1..=count {
            let nnnn = format!("{i:04}");
            files.push((
                format!("{nnnn}-decision-request.md"),
                [
                    "---",
                    "type: decision-request",
                    "computed_owner: fable-5",
                    "leverage_facets: { irreversible: false, blast_radius: node }",
                    "decision_type: ops",
                    "---",
                    "## Контекст",
                    "x",
                ]
                .join("\n"),
            ));
            files.push((format!("{nnnn}-approval.json"), serde_json::json!({"chosen_option": "A", "signed_at": "2026-08-05T00:00:00.000Z", "pubkey": model_pubkey}).to_string()));
        }
        DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files,
        }
    }

    fn quorum_decision_request() -> String {
        [
            "---",
            "type: decision-request",
            "computed_owner: olena",
            "approvers: [olena, vitalii]",
            "leverage_facets: { irreversible: true, blast_radius: company }",
            "decision_type: architecture",
            "---",
            "## Контекст",
            "x",
        ]
        .join("\n")
    }

    // --- defaultReviewConfig -----------------------------------------------------

    #[test]
    fn default_config_matches_task_thresholds() {
        let c = default_review_config();
        assert_eq!(c.widen_threshold, 5);
        assert_eq!(c.stale_days, 7.0);
    }

    // --- draftWidenCandidates -----------------------------------------------------

    #[test]
    fn model_with_5_plus_override_free_decisions_is_a_candidate() {
        let key = generate_device_keypair();
        let device_registry = vec![DeviceRegistryEntry {
            handle: "fable-5".into(),
            role: SignerRole::Model,
            pubkey_base64: key.public_key_base64.clone(),
            registered_at: "2026-08-01T00:00:00.000Z".into(),
        }];
        let decisions_dirs = vec![model_decisions_dir(5, &key.public_key_base64)];
        let candidates = draft_widen_candidates(
            &mandates_fixture(),
            &decisions_dirs,
            &device_registry,
            &HashSet::new(),
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
            5,
        );
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].model_handle, "fable-5");
        assert_eq!(candidates[0].delegator_handle.as_deref(), Some("olena"));
        assert_eq!(candidates[0].override_free_in_period, 5);
    }

    #[test]
    fn below_threshold_is_not_a_candidate() {
        let key = generate_device_keypair();
        let device_registry = vec![DeviceRegistryEntry {
            handle: "fable-5".into(),
            role: SignerRole::Model,
            pubkey_base64: key.public_key_base64.clone(),
            registered_at: "2026-08-01T00:00:00.000Z".into(),
        }];
        let decisions_dirs = vec![model_decisions_dir(3, &key.public_key_base64)];
        let candidates = draft_widen_candidates(
            &mandates_fixture(),
            &decisions_dirs,
            &device_registry,
            &HashSet::new(),
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
            5,
        );
        assert!(candidates.is_empty());
    }

    #[test]
    fn delegator_with_active_kill_switch_is_never_a_widen_candidate() {
        let key = generate_device_keypair();
        let device_registry = vec![DeviceRegistryEntry {
            handle: "fable-5".into(),
            role: SignerRole::Model,
            pubkey_base64: key.public_key_base64.clone(),
            registered_at: "2026-08-01T00:00:00.000Z".into(),
        }];
        let decisions_dirs = vec![model_decisions_dir(5, &key.public_key_base64)];
        let kill_switch: HashSet<String> = ["olena".to_string()].into_iter().collect();
        let candidates = draft_widen_candidates(
            &mandates_fixture(),
            &decisions_dirs,
            &device_registry,
            &kill_switch,
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
            5,
        );
        assert!(candidates.is_empty());
    }

    // --- narrowCandidates -----------------------------------------------------------

    #[test]
    fn active_delegator_kill_switch_is_a_narrow_candidate_even_without_overrides() {
        let key = generate_device_keypair();
        let device_registry = vec![DeviceRegistryEntry {
            handle: "fable-5".into(),
            role: SignerRole::Model,
            pubkey_base64: key.public_key_base64.clone(),
            registered_at: "2026-08-01T00:00:00.000Z".into(),
        }];
        let decisions_dirs = vec![model_decisions_dir(1, &key.public_key_base64)];
        let kill_switch: HashSet<String> = ["olena".to_string()].into_iter().collect();
        let candidates = narrow_candidates(
            &mandates_fixture(),
            &decisions_dirs,
            &device_registry,
            &kill_switch,
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        );
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].model_handle, "fable-5");
        assert_eq!(candidates[0].delegator_handle.as_deref(), Some("olena"));
        assert!(candidates[0].delegator_kill_switch_active);
    }

    #[test]
    fn no_overrides_and_no_kill_switch_is_empty() {
        let candidates = narrow_candidates(
            &mandates_fixture(),
            &[],
            &[],
            &HashSet::new(),
            dt("1970-01-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        );
        assert!(candidates.is_empty());
    }

    // --- openDisputes -----------------------------------------------------------------

    #[test]
    fn diverged_quorum_goes_to_diverged() {
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                ("0001-decision-request.md".into(), quorum_decision_request()),
                (
                    "0001-approval-olena.json".into(),
                    serde_json::json!({"chosen_option":"A","signed_at":"2026-08-05T00:00:00.000Z"})
                        .to_string(),
                ),
                (
                    "0001-approval-vitalii.json".into(),
                    serde_json::json!({"chosen_option":"B","signed_at":"2026-08-06T00:00:00.000Z"})
                        .to_string(),
                ),
            ],
        }];
        let disputes = open_disputes(&decisions_dirs, dt("2026-08-09T10:00:00.000Z"), 7.0).unwrap();
        assert_eq!(disputes.diverged.len(), 1);
        assert!(disputes.stale.is_empty());
    }

    #[test]
    fn stale_open_decision_past_threshold_goes_to_stale() {
        let request = [
            "---",
            "type: decision-request",
            "computed_owner: olena",
            "leverage_facets: { irreversible: false, blast_radius: node }",
            "decision_type: architecture",
            "opened_at: \"2026-07-01T00:00:00.000Z\"",
            "---",
            "## Контекст",
            "x",
        ]
        .join("\n");
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![("0001-decision-request.md".into(), request)],
        }];
        let disputes = open_disputes(&decisions_dirs, dt("2026-08-09T10:00:00.000Z"), 7.0).unwrap();
        assert_eq!(disputes.stale.len(), 1);
        assert_eq!(disputes.stale[0].nnnn, "0001");
        assert_eq!(disputes.stale[0].computed_owner.as_deref(), Some("olena"));
    }

    // --- materializeWidenProposals -------------------------------------------------------

    struct FixedKeyLoader(DeviceKeypair);
    #[async_trait::async_trait]
    impl ModelDeviceKeyLoader for FixedKeyLoader {
        async fn load_model_device_key(&self, _handle: &str) -> DeviceKeypair {
            self.0.clone()
        }
    }

    struct RecordingRegistrar(Mutex<Vec<(String, SignerRole, String)>>);
    #[async_trait::async_trait]
    impl DeviceRegistrar for RecordingRegistrar {
        async fn register_device(&self, handle: &str, role: SignerRole, pubkey_base64: &str) {
            self.0
                .lock()
                .unwrap()
                .push((handle.to_string(), role, pubkey_base64.to_string()));
        }
    }

    #[tokio::test]
    async fn materializes_change_proposal_per_candidate_via_ai_petition() {
        let io = MemoryIo::default();
        let model_key = generate_device_keypair();
        let mandates_file = MandatesFile {
            generation: 3,
            mandates: mandates_fixture(),
        };
        let candidates = vec![WidenCandidate {
            model_handle: "fable-5".into(),
            delegator_handle: Some("olena".into()),
            decisions_in_period: 5,
            override_free_in_period: 5,
        }];
        let loader = FixedKeyLoader(model_key.clone());
        let registrar = RecordingRegistrar(Mutex::new(Vec::new()));

        let created = materialize_widen_proposals(
            &io,
            "/root",
            &mandates_file,
            &candidates,
            &loader,
            Some(&registrar),
            &[],
            &[],
            Some(dt("2026-08-09T10:00:00.000Z")),
        )
        .await;
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].change_id, "review-3-fable-5");
        assert!(io.get(&created[0].decision_request_path).is_some());
        assert_eq!(
            registrar.0.lock().unwrap().as_slice(),
            &[(
                "fable-5".to_string(),
                SignerRole::Model,
                model_key.public_key_base64.clone()
            )]
        );

        let markdown = io.get(&created[0].decision_request_path).unwrap();
        assert!(markdown.contains("computed_owner: olena"));
    }

    #[tokio::test]
    async fn candidate_without_delegator_root_is_skipped() {
        let io = MemoryIo::default();
        let model_key = generate_device_keypair();
        let mandates_file = MandatesFile {
            generation: 3,
            mandates: mandates_fixture(),
        };
        let candidates = vec![WidenCandidate {
            model_handle: "vitalii".into(),
            delegator_handle: None,
            decisions_in_period: 5,
            override_free_in_period: 5,
        }];
        let loader = FixedKeyLoader(model_key);
        let created = materialize_widen_proposals(
            &io,
            "/root",
            &mandates_file,
            &candidates,
            &loader,
            None,
            &[],
            &[],
            Some(dt("2026-08-09T10:00:00.000Z")),
        )
        .await;
        assert!(created.is_empty());
    }

    // --- formatReviewAgendaMarkdown -------------------------------------------------------

    #[test]
    fn markdown_carries_all_three_sections() {
        let markdown = format_review_agenda_markdown(
            "2026-08-01T00:00:00.000Z",
            "2026-08-09T10:00:00.000Z",
            &[],
            &[],
            &[],
            &OpenDisputes {
                diverged: vec![],
                stale: vec![],
            },
        );
        assert!(markdown.contains("## Draft-пропозиції розширення"));
        assert!(markdown.contains("## Кандидати на звуження"));
        assert!(markdown.contains("## Відкриті розбіжності й застарілі розвилки"));
    }

    // --- reviewAgendaPath -----------------------------------------------------------------

    #[test]
    fn review_agenda_path_is_reviews_dir_with_date_prefix() {
        assert_eq!(
            review_agenda_path("/root", "2026-08-09T10:00:00.000Z"),
            "/root/.mt/reviews/2026-08-09-agenda.md"
        );
    }

    // --- reviewAgenda — повний потік ------------------------------------------------------

    #[tokio::test]
    async fn writes_file_and_auto_materializes_widen_candidate() {
        let io = MemoryIo::default();
        let model_key = generate_device_keypair();
        let device_registry = vec![DeviceRegistryEntry {
            handle: "fable-5".into(),
            role: SignerRole::Model,
            pubkey_base64: model_key.public_key_base64.clone(),
            registered_at: "2026-08-01T00:00:00.000Z".into(),
        }];
        let mandates_file = MandatesFile {
            generation: 3,
            mandates: mandates_fixture(),
        };
        let decisions_dirs = vec![model_decisions_dir(5, &model_key.public_key_base64)];
        let loader = FixedKeyLoader(model_key.clone());
        let registrar = RecordingRegistrar(Mutex::new(Vec::new()));

        let result = review_agenda(
            &io,
            "/root",
            &mandates_file,
            &decisions_dirs,
            &device_registry,
            &HashSet::new(),
            &loader,
            Some(&registrar),
            14,
            None,
            Some(dt("2026-08-09T10:00:00.000Z")),
        )
        .await
        .unwrap();

        assert_eq!(result.widen_candidates.len(), 1);
        assert_eq!(result.materialized.len(), 1);
        assert!(io.get(&result.path).is_some());
        assert!(result.markdown.contains("fable-5"));
        assert!(result.markdown.contains("чернетка готова"));
        assert_eq!(
            registrar.0.lock().unwrap().as_slice(),
            &[(
                "fable-5".to_string(),
                SignerRole::Model,
                model_key.public_key_base64.clone()
            )]
        );
    }
}
