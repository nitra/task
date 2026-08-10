//! Дельта-звіт (M6) — порт `delta/src/report.js`. ЖОДНОГО LLM: звіт мусить
//! бути ВІДТВОРЮВАНИМ byte-у-byte для того самого знімка файлової системи.
//! Чотири секції (задача M6, п.2): (а) рух межі — застосовані mandate-
//! change за період; (б) рішення за період — людські/модельні/кворумні; (в)
//! ціна гейта — Σ час до розуміння × ставка, + кількість заблокованих
//! розвилок з `deadline_cost`; (г) глибина делегування; (д) агреговано БЕЗ
//! приватного — лише count кандор-заяв/kill-switch-активацій, ніколи вміст.

use std::collections::{BTreeSet, HashMap, HashSet};

use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::candor::{candor_log_path, parse_candor_log};
use crate::change_proposal::describe_mandate_diff_lines;
use crate::decisions::{
    derive_quorum_status, parse_decision_request, requires_quorum, DecisionRequest,
    DecisionRequestMeta, DecisionsDir, QuorumState,
};
use crate::io::Io;
use crate::kill_switch::kill_switch_log_path;
use crate::mandates::model_mandates;
use crate::org::load_org_config;
use mt_mandates::{Mandate, MandateKind, MandatesFile, Scope, Thresholds};

fn run_id_of(dir: &str) -> Option<String> {
    let parts: Vec<&str> = dir.split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 {
        return None;
    }
    Some(parts[parts.len() - 2].to_string())
}

fn is_mandate_change_run(run_id: &str) -> bool {
    run_id.starts_with("mandate-change-")
}

fn all_file_owners(old: &MandatesFile, new_file: &MandatesFile) -> Vec<String> {
    let mut set: BTreeSet<String> = BTreeSet::new();
    for m in &old.mandates {
        set.insert(m.owner.clone());
    }
    for m in &new_file.mandates {
        set.insert(m.owner.clone());
    }
    set.into_iter().collect()
}

fn within_period(iso: Option<&str>, start: DateTime<Utc>, end: DateTime<Utc>) -> bool {
    let Some(iso) = iso else { return false };
    let Ok(dt) = DateTime::parse_from_rfc3339(iso) else {
        return false;
    };
    let dt = dt.with_timezone(&Utc);
    dt >= start && dt <= end
}

/// Витягує `time_to_understanding_sec` СИРИМ regex над фронтматером квіз-
/// файлу — той самий підхід, що `drift::quiz_iterations`: звіт навмисно не
/// залежить від того, Q&A це чи teach-back формат (`report.js:
/// quizTimeToUnderstandingSec`).
fn quiz_time_to_understanding_sec(quiz_text: Option<&str>) -> Option<f64> {
    let text = quiz_text?;
    let re =
        Regex::new(r"(?m)^time_to_understanding_sec: ([\d.]+)$").expect("статичний regex валідний");
    re.captures(text).and_then(|c| c[1].parse::<f64>().ok())
}

fn owner_kind(mandates: &[Mandate], owner: Option<&str>) -> MandateKind {
    owner
        .and_then(|o| mandates.iter().find(|m| m.owner == o))
        .map(|m| m.kind)
        .unwrap_or(MandateKind::Person)
}

fn decision_request_nnnn(name: &str) -> Option<String> {
    let re = Regex::new(r"^(\d{4})-decision-request\.md$").expect("статичний regex валідний");
    re.captures(name).map(|c| c[1].to_string())
}

// --- (а) Рух межі: класифікація зміни мандата ------------------------------

fn set_widened(old: &[String], new: &[String]) -> bool {
    new.iter().any(|v| !old.contains(v))
}

fn decision_types_widened(old: &[String], new: &[String]) -> bool {
    if old.iter().any(|t| t == "*") {
        return false;
    }
    if new.iter().any(|t| t == "*") {
        return true;
    }
    set_widened(old, new)
}

fn scope_widened(old: &Scope, new: &Scope) -> bool {
    set_widened(&old.refs, &new.refs)
        || decision_types_widened(&old.decision_types, &new.decision_types)
}

fn scope_narrowed(old: &Scope, new: &Scope) -> bool {
    set_widened(&new.refs, &old.refs)
        || decision_types_widened(&new.decision_types, &old.decision_types)
}

/// `null` = без стелі (найширше значення) — розширено, якщо стеля піднялась
/// або зникла зовсім (`mandate-change.js: numericWidened`/`ordWidened`).
fn ord_widened<T: PartialOrd>(old: Option<T>, new: Option<T>) -> bool {
    match (old, new) {
        (Some(_), None) => true,
        (None, _) => false,
        (Some(o), Some(n)) => n > o,
    }
}

fn thresholds_widened(old: &Thresholds, new: &Thresholds, kind: MandateKind) -> bool {
    let budget = ord_widened(old.budget_eur, new.budget_eur);
    let risk = ord_widened(old.risk, new.risk);
    let irreversible = !old.irreversible_or_default() && new.irreversible_or_default();
    let audacity =
        kind == MandateKind::Model && new.audacity_or_default() > old.audacity_or_default();
    budget || risk || irreversible || audacity
}

fn thresholds_narrowed(old: &Thresholds, new: &Thresholds, kind: MandateKind) -> bool {
    let budget = ord_widened(new.budget_eur, old.budget_eur);
    let risk = ord_widened(new.risk, old.risk);
    let irreversible = old.irreversible_or_default() && !new.irreversible_or_default();
    let audacity =
        kind == MandateKind::Model && old.audacity_or_default() > new.audacity_or_default();
    budget || risk || irreversible || audacity
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MandateChangeKind {
    Added,
    Removed,
    KindChanged,
    EscalatesToChanged,
    Widened,
    Narrowed,
    Unchanged,
}

impl MandateChangeKind {
    /// Людиночитабельна мітка українською (`report.js: moveLabel`).
    pub fn label(&self) -> &'static str {
        match self {
            MandateChangeKind::Added => "додано мандат",
            MandateChangeKind::Removed => "видалено мандат",
            MandateChangeKind::KindChanged => "змінено kind",
            MandateChangeKind::EscalatesToChanged => "змінено делегатора",
            MandateChangeKind::Widened => "розширено",
            MandateChangeKind::Narrowed => "звужено",
            MandateChangeKind::Unchanged => "без змін",
        }
    }
}

/// Класифікує зміну ОДНОГО owner-мандата між `old`/`new` — 1:1 з
/// `mt_mandates::change::classify` (приватний у crate, тому портований тут
/// напряму) (`mandate-change.js: classifyMandateChange`).
pub fn classify_mandate_change(old: Option<&Mandate>, new: Option<&Mandate>) -> MandateChangeKind {
    match (old, new) {
        (None, Some(_)) => MandateChangeKind::Added,
        (Some(_), None) => MandateChangeKind::Removed,
        (None, None) => MandateChangeKind::Unchanged,
        (Some(o), Some(n)) => {
            if o.kind != n.kind {
                return MandateChangeKind::KindChanged;
            }
            if o.escalates_to != n.escalates_to {
                return MandateChangeKind::EscalatesToChanged;
            }
            if scope_widened(&o.scope, &n.scope)
                || thresholds_widened(&o.thresholds, &n.thresholds, o.kind)
            {
                return MandateChangeKind::Widened;
            }
            if scope_narrowed(&o.scope, &n.scope)
                || thresholds_narrowed(&o.thresholds, &n.thresholds, o.kind)
            {
                return MandateChangeKind::Narrowed;
            }
            MandateChangeKind::Unchanged
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BoundaryMove {
    #[serde(rename = "runId")]
    pub run_id: String,
    #[serde(rename = "changeId")]
    pub change_id: String,
    pub owner: String,
    pub kind: MandateChangeKind,
    #[serde(rename = "diffLines")]
    pub diff_lines: Vec<String>,
    #[serde(rename = "delegatorHandle")]
    pub delegator_handle: Option<String>,
    #[serde(rename = "appliedAt")]
    pub applied_at: String,
}

#[derive(Deserialize)]
struct ChangeMarker {
    old: MandatesFile,
    #[serde(rename = "new")]
    new_file: MandatesFile,
}

/// (а) «Рух межі» — застосовані mandate-change за період, зі знайденого
/// маркера `0001-applied.json` (`report.js: deriveBoundaryMoves`).
pub fn derive_boundary_moves(
    decisions_dirs: &[DecisionsDir],
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> Vec<BoundaryMove> {
    let mut moves = Vec::new();
    for d in decisions_dirs {
        let Some(run_id) = run_id_of(&d.dir) else {
            continue;
        };
        if !is_mandate_change_run(&run_id) {
            continue;
        }
        let files_by_name: HashMap<&str, &str> = d
            .files
            .iter()
            .map(|(n, c)| (n.as_str(), c.as_str()))
            .collect();
        let (Some(applied_text), Some(change_text)) = (
            files_by_name.get("0001-applied.json"),
            files_by_name.get("0001-change.json"),
        ) else {
            continue;
        };
        let (Ok(applied), Ok(change)) = (
            serde_json::from_str::<Value>(applied_text),
            serde_json::from_str::<ChangeMarker>(change_text),
        ) else {
            continue; // битий маркер/change.json — не рахуємо, не валимо весь звіт
        };
        let applied_at = applied.get("appliedAt").and_then(|v| v.as_str());
        if !within_period(applied_at, period_start, period_end) {
            continue;
        }
        let applied_at = applied_at
            .expect("within_period вже підтвердив Some")
            .to_string();
        let delegator_handle = applied
            .get("handle")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let change_id = run_id
            .strip_prefix("mandate-change-")
            .unwrap_or(&run_id)
            .to_string();

        for owner in all_file_owners(&change.old, &change.new_file) {
            let old_mandate = change.old.mandates.iter().find(|m| m.owner == owner);
            let new_mandate = change.new_file.mandates.iter().find(|m| m.owner == owner);
            let kind = classify_mandate_change(old_mandate, new_mandate);
            if kind == MandateChangeKind::Unchanged {
                continue;
            }
            let diff_lines = match (old_mandate, new_mandate) {
                (Some(o), Some(n)) => describe_mandate_diff_lines(o, n),
                _ => Vec::new(),
            };
            moves.push(BoundaryMove {
                run_id: run_id.clone(),
                change_id: change_id.clone(),
                owner,
                kind,
                diff_lines,
                delegator_handle: delegator_handle.clone(),
                applied_at: applied_at.clone(),
            });
        }
    }
    moves.sort_by(|a, b| a.applied_at.cmp(&b.applied_at));
    moves
}

// --- (б) Рішення за період --------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Classification {
    Human,
    Model,
    Quorum,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ClosedDecision {
    #[serde(rename = "runId")]
    pub run_id: Option<String>,
    pub nnnn: String,
    #[serde(rename = "decisionType")]
    pub decision_type: String,
    pub classification: Classification,
    #[serde(rename = "chosenOption")]
    pub chosen_option: Option<String>,
    #[serde(rename = "closedAt")]
    pub closed_at: String,
    #[serde(rename = "quizTimeToUnderstandingSec")]
    pub quiz_time_to_understanding_sec: f64,
}

struct ResolvedClosure {
    classification: Classification,
    chosen_option: Option<String>,
    closed_at: Option<String>,
    quiz_time_to_understanding_sec: f64,
}

fn closed_quorum_decision(
    parsed: &DecisionRequest,
    files_by_name: &HashMap<String, String>,
    nnnn: &str,
) -> Option<ResolvedClosure> {
    let quorum = derive_quorum_status(parsed, files_by_name);
    if quorum.status != QuorumState::Closed {
        return None;
    }
    let mut closed_at: Option<String> = None;
    let mut time_sec = 0.0;
    for s in &quorum.signed {
        if let Some(signed_at) = &s.signed_at {
            if closed_at.as_ref().is_none_or(|c| signed_at > c) {
                closed_at = Some(signed_at.clone());
            }
        }
        time_sec += quiz_time_to_understanding_sec(
            files_by_name
                .get(&format!("{nnnn}-quiz-{}.md", s.handle))
                .map(String::as_str),
        )
        .unwrap_or(0.0);
    }
    Some(ResolvedClosure {
        classification: Classification::Quorum,
        chosen_option: quorum.signed.first().and_then(|s| s.chosen_option.clone()),
        closed_at,
        quiz_time_to_understanding_sec: time_sec,
    })
}

fn closed_solo_decision(
    parsed: &DecisionRequest,
    files_by_name: &HashMap<String, String>,
    nnnn: &str,
    mandates: &[Mandate],
) -> Option<ResolvedClosure> {
    let approval_text = files_by_name.get(&format!("{nnnn}-approval.json"))?;
    let approval: Value = serde_json::from_str(approval_text).ok()?;
    let mut effective_owner = parsed.computed_owner.clone();
    if let Some(delegation_text) = files_by_name.get(&format!("{nnnn}-delegation.json")) {
        if let Ok(delegation) = serde_json::from_str::<Value>(delegation_text) {
            if let Some(delegated_to) = delegation.get("delegated_to").and_then(|v| v.as_str()) {
                effective_owner = Some(delegated_to.to_string());
            }
        }
    }
    let classification = if owner_kind(mandates, effective_owner.as_deref()) == MandateKind::Model {
        Classification::Model
    } else {
        Classification::Human
    };
    let time_sec = quiz_time_to_understanding_sec(
        files_by_name
            .get(&format!("{nnnn}-quiz.md"))
            .map(String::as_str),
    )
    .unwrap_or(0.0);
    Some(ResolvedClosure {
        classification,
        chosen_option: approval
            .get("chosen_option")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        closed_at: approval
            .get("signed_at")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        quiz_time_to_understanding_sec: time_sec,
    })
}

/// (б) Рішення, закриті за період — людські/модельні/кворумні, з квіз-часом
/// для метрики «ціна гейта» (`report.js: deriveDecisionsSummary`).
pub fn derive_decisions_summary(
    decisions_dirs: &[DecisionsDir],
    mandates: &[Mandate],
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> Result<Vec<ClosedDecision>, String> {
    let mut closed = Vec::new();
    for d in decisions_dirs {
        let files_by_name: HashMap<String, String> = d.files.iter().cloned().collect();
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
            let resolved = if requires_quorum(&parsed.leverage_facets) {
                closed_quorum_decision(&parsed, &files_by_name, &nnnn)
            } else {
                closed_solo_decision(&parsed, &files_by_name, &nnnn, mandates)
            };
            let Some(resolved) = resolved else { continue };
            if !within_period(resolved.closed_at.as_deref(), period_start, period_end) {
                continue;
            }
            closed.push(ClosedDecision {
                run_id,
                nnnn,
                decision_type: parsed
                    .decision_type
                    .clone()
                    .unwrap_or_else(|| "general".to_string()),
                classification: resolved.classification,
                chosen_option: resolved.chosen_option,
                closed_at: resolved
                    .closed_at
                    .expect("within_period вже підтвердив Some"),
                quiz_time_to_understanding_sec: resolved.quiz_time_to_understanding_sec,
            });
        }
    }
    Ok(closed)
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct ByClassification {
    pub human: usize,
    pub model: usize,
    pub quorum: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DecisionTypeSummary {
    #[serde(rename = "decisionType")]
    pub decision_type: String,
    pub human: usize,
    pub model: usize,
    pub quorum: usize,
    pub total: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DecisionsSummary {
    pub total: usize,
    #[serde(rename = "byClassification")]
    pub by_classification: ByClassification,
    #[serde(rename = "byType")]
    pub by_type: Vec<DecisionTypeSummary>,
}

/// Агрегує закриті рішення по класифікації і по `decision_type`
/// (`report.js: summarizeDecisions`).
pub fn summarize_decisions(closed: &[ClosedDecision]) -> DecisionsSummary {
    let mut by_classification = ByClassification::default();
    let mut by_type: Vec<DecisionTypeSummary> = Vec::new();
    for d in closed {
        match d.classification {
            Classification::Human => by_classification.human += 1,
            Classification::Model => by_classification.model += 1,
            Classification::Quorum => by_classification.quorum += 1,
        }
        let bucket = match by_type
            .iter_mut()
            .find(|b| b.decision_type == d.decision_type)
        {
            Some(b) => b,
            None => {
                by_type.push(DecisionTypeSummary {
                    decision_type: d.decision_type.clone(),
                    human: 0,
                    model: 0,
                    quorum: 0,
                    total: 0,
                });
                by_type.last_mut().expect("щойно вставлено")
            }
        };
        match d.classification {
            Classification::Human => bucket.human += 1,
            Classification::Model => bucket.model += 1,
            Classification::Quorum => bucket.quorum += 1,
        }
        bucket.total += 1;
    }
    by_type.sort_by_key(|b| std::cmp::Reverse(b.total));
    DecisionsSummary {
        total: closed.len(),
        by_classification,
        by_type,
    }
}

/// (в) «Ціна гейта» — Σ `time_to_understanding_sec` людських/кворумних
/// підписів (модельні НЕ рахуються) × ставка (`report.js: gateCostEur`).
pub fn gate_cost_eur(closed: &[ClosedDecision], hourly_rate_eur: f64) -> f64 {
    let total_seconds: f64 = closed
        .iter()
        .filter(|d| {
            matches!(
                d.classification,
                Classification::Human | Classification::Quorum
            )
        })
        .map(|d| d.quiz_time_to_understanding_sec)
        .sum();
    ((total_seconds / 3600.0) * hourly_rate_eur * 100.0).round() / 100.0
}

/// Кількість ВІДКРИТИХ розвилок з непорожнім `deadline_cost` — поточний
/// знімок (`report.js: countBlockedWithDeadlineCost`).
pub fn count_blocked_with_deadline_cost(decisions_dirs: &[DecisionsDir]) -> Result<usize, String> {
    let mut count = 0;
    for d in decisions_dirs {
        let files_by_name: HashMap<String, String> = d.files.iter().cloned().collect();
        for (name, content) in &d.files {
            let Some(nnnn) = decision_request_nnnn(name) else {
                continue;
            };
            let parsed = parse_decision_request(
                content,
                DecisionRequestMeta {
                    nnnn: Some(nnnn.clone()),
                    ..Default::default()
                },
            )
            .map_err(|e| e.to_string())?;
            if parsed.deadline_cost.as_deref().unwrap_or("").is_empty() {
                continue;
            }
            if requires_quorum(&parsed.leverage_facets) {
                if derive_quorum_status(&parsed, &files_by_name).status == QuorumState::Closed {
                    continue;
                }
            } else if files_by_name.contains_key(&format!("{nnnn}-approval.json")) {
                continue;
            }
            count += 1;
        }
    }
    Ok(count)
}

// --- (г) Глибина делегування -------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct DelegationDepth {
    #[serde(rename = "modelOwnedDecisionTypes")]
    pub model_owned_decision_types: usize,
    #[serde(rename = "delegationsInPeriod")]
    pub delegations_in_period: usize,
}

/// (г) «Глибина делегування» — класи рішень із model-власником у карті +
/// делегування підписані за період (`report.js: delegationDepth`).
pub fn delegation_depth(
    mandates: &[Mandate],
    decisions_dirs: &[DecisionsDir],
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> DelegationDepth {
    let mut model_decision_types: HashSet<String> = HashSet::new();
    for model in model_mandates(mandates) {
        for t in &model.scope.decision_types {
            model_decision_types.insert(t.clone());
        }
    }
    let re = Regex::new(r"^(\d{4})-delegation\.json$").expect("статичний regex валідний");
    let mut delegations_in_period = 0;
    for d in decisions_dirs {
        for (name, content) in &d.files {
            if !re.is_match(name) {
                continue;
            }
            let Ok(record) = serde_json::from_str::<Value>(content) else {
                continue;
            };
            if within_period(
                record.get("signed_at").and_then(|v| v.as_str()),
                period_start,
                period_end,
            ) {
                delegations_in_period += 1;
            }
        }
    }
    DelegationDepth {
        model_owned_decision_types: model_decision_types.len(),
        delegations_in_period,
    }
}

// --- (д) Агреговано без приватного -------------------------------------------

/// (д) Кандор-заяв доставлено за період — АГРЕГОВАНА кількість по УСІХ
/// person-owner, НІКОЛИ не повертає вміст (`report.js: candorDeliveredCount`).
pub async fn candor_delivered_count(
    io: &dyn Io,
    mandates_dir: &str,
    mandates: &[Mandate],
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> usize {
    let mut recipients: Vec<&str> = mandates
        .iter()
        .filter(|m| m.kind != MandateKind::Model)
        .map(|m| m.owner.as_str())
        .collect();
    recipients.sort_unstable();
    recipients.dedup();
    let mut count = 0;
    for handle in recipients {
        let Some(text) = io.read_file(&candor_log_path(mandates_dir, handle)).await else {
            continue;
        };
        for record in parse_candor_log(Some(&text)) {
            if within_period(
                record.get("created_at").and_then(|v| v.as_str()),
                period_start,
                period_end,
            ) {
                count += 1;
            }
        }
    }
    count
}

/// (д) Активацій kill-switch за період — лише `action: 'on'`
/// (`report.js: killSwitchActivationsCount`).
pub async fn kill_switch_activations_count(
    io: &dyn Io,
    mandates_dir: &str,
    period_start: DateTime<Utc>,
    period_end: DateTime<Utc>,
) -> usize {
    let Some(text) = io.read_file(&kill_switch_log_path(mandates_dir)).await else {
        return 0;
    };
    let mut count = 0;
    for line in text
        .split(['\r', '\n'])
        .map(str::trim)
        .filter(|l| !l.is_empty())
    {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if record.get("action").and_then(|v| v.as_str()) == Some("on")
            && within_period(
                record.get("at").and_then(|v| v.as_str()),
                period_start,
                period_end,
            )
        {
            count += 1;
        }
    }
    count
}

/// `.mt/reports/YYYY-MM-DD-delta.md` (`report.js: reportPath`).
pub fn report_path(mandates_dir: &str, period_end_iso: &str) -> String {
    let date = period_end_iso.get(0..10).unwrap_or(period_end_iso);
    format!("{mandates_dir}/.mt/reports/{date}-delta.md")
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DeltaReport {
    #[serde(rename = "periodDays")]
    pub period_days: i64,
    #[serde(rename = "periodStart")]
    pub period_start: String,
    #[serde(rename = "periodEnd")]
    pub period_end: String,
    #[serde(rename = "boundaryMoves")]
    pub boundary_moves: Vec<BoundaryMove>,
    pub decisions: DecisionsSummary,
    #[serde(rename = "gateCostEur")]
    pub gate_cost_eur: f64,
    #[serde(rename = "hourlyRateEur")]
    pub hourly_rate_eur: f64,
    #[serde(rename = "blockedWithDeadlineCost")]
    pub blocked_with_deadline_cost: usize,
    #[serde(rename = "delegationDepth")]
    pub delegation_depth: DelegationDepth,
    #[serde(rename = "candorDelivered")]
    pub candor_delivered: usize,
    #[serde(rename = "killSwitchActivations")]
    pub kill_switch_activations: usize,
}

/// Деривує повну модель дельта-звіту (без рендеру в markdown) — окрема
/// функція з {@link format_delta_report_markdown} (`report.js:
/// buildDeltaReport`).
pub async fn build_delta_report(
    io: &dyn Io,
    mandates_dir: &str,
    mandates_file: &MandatesFile,
    decisions_dirs: &[DecisionsDir],
    period_days: i64,
    now: Option<DateTime<Utc>>,
) -> Result<DeltaReport, String> {
    let period_end = now.unwrap_or_else(Utc::now);
    let period_start = period_end - chrono::Duration::days(period_days);
    let mandates = &mandates_file.mandates;

    let boundary_moves = derive_boundary_moves(decisions_dirs, period_start, period_end);
    let closed_decisions =
        derive_decisions_summary(decisions_dirs, mandates, period_start, period_end)?;
    let decisions = summarize_decisions(&closed_decisions);
    let org_config = load_org_config(io, mandates_dir).await;
    let gate_cost = gate_cost_eur(&closed_decisions, org_config.hourly_rate_eur);
    let blocked_with_deadline_cost = count_blocked_with_deadline_cost(decisions_dirs)?;
    let delegation = delegation_depth(mandates, decisions_dirs, period_start, period_end);
    let candor_delivered =
        candor_delivered_count(io, mandates_dir, mandates, period_start, period_end).await;
    let kill_switch_activations =
        kill_switch_activations_count(io, mandates_dir, period_start, period_end).await;

    Ok(DeltaReport {
        period_days,
        period_start: period_start.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        period_end: period_end.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        boundary_moves,
        decisions,
        gate_cost_eur: gate_cost,
        hourly_rate_eur: org_config.hourly_rate_eur,
        blocked_with_deadline_cost,
        delegation_depth: delegation,
        candor_delivered,
        kill_switch_activations,
    })
}

/// Рендерить повну модель звіту у ДЕТЕРМІНОВАНИЙ markdown — жодного LLM
/// (`report.js: formatDeltaReportMarkdown`).
pub fn format_delta_report_markdown(report: &DeltaReport) -> String {
    let mut lines = vec![
        format!(
            "# Дельта-звіт: {} — {}",
            &report.period_start[..10.min(report.period_start.len())],
            &report.period_end[..10.min(report.period_end.len())]
        ),
        String::new(),
        "## Рух межі".to_string(),
        String::new(),
    ];

    if report.boundary_moves.is_empty() {
        lines.push("Жодного застосованого mandate-change за період.".to_string());
        lines.push(String::new());
    } else {
        for m in &report.boundary_moves {
            lines.push(format!(
                "- **{}** — {} (підписав делегатор `{}`, {})",
                m.owner,
                m.kind.label(),
                m.delegator_handle.as_deref().unwrap_or("—"),
                m.applied_at
            ));
            for diff_line in &m.diff_lines {
                lines.push(format!("  - {diff_line}"));
            }
        }
        lines.push(String::new());
    }

    lines.push("## Рішення за період".to_string());
    lines.push(String::new());
    lines.push(format!(
        "Усього закрито: **{}** (людських: {}, модельних: {}, кворумних: {}).",
        report.decisions.total,
        report.decisions.by_classification.human,
        report.decisions.by_classification.model,
        report.decisions.by_classification.quorum
    ));
    lines.push(String::new());
    if !report.decisions.by_type.is_empty() {
        lines.push("| Клас рішень | людських | модельних | кворумних | усього |".to_string());
        lines.push("| --- | --- | --- | --- | --- |".to_string());
        for t in &report.decisions.by_type {
            lines.push(format!(
                "| {} | {} | {} | {} | {} |",
                t.decision_type, t.human, t.model, t.quorum, t.total
            ));
        }
        lines.push(String::new());
    }

    lines.push("## Ціна гейта".to_string());
    lines.push(String::new());
    lines.push(format!(
        "Σ час до розуміння × ставка ({} €/год): **{} €**.",
        report.hourly_rate_eur, report.gate_cost_eur
    ));
    lines.push(format!(
        "Заблокованих розвилок з непорожнім deadline_cost (поточний знімок): **{}**.",
        report.blocked_with_deadline_cost
    ));
    lines.push(String::new());
    lines.push("## Глибина делегування".to_string());
    lines.push(String::new());
    lines.push(format!(
        "Класів рішень із model-власником у mandates.yaml: **{}**.",
        report.delegation_depth.model_owned_decision_types
    ));
    lines.push(format!(
        "Делегувань одним квізом за період: **{}**.",
        report.delegation_depth.delegations_in_period
    ));
    lines.push(String::new());
    lines.push("## Агреговано (без приватного)".to_string());
    lines.push(String::new());
    lines.push(format!(
        "Кандор-заяв доставлено: **{}**.",
        report.candor_delivered
    ));
    lines.push(format!(
        "Активацій kill-switch: **{}**.",
        report.kill_switch_activations
    ));
    lines.push(String::new());

    format!("{}\n", lines.join("\n"))
}

pub struct DeltaReportOutput {
    pub report: DeltaReport,
    pub markdown: String,
    pub path: String,
}

/// Повний потік `delta_report`: деривує звіт, рендерить markdown і пише
/// `.mt/reports/YYYY-MM-DD-delta.md` (`report.js: deltaReport`).
pub async fn delta_report(
    io: &dyn Io,
    mandates_dir: &str,
    mandates_file: &MandatesFile,
    decisions_dirs: &[DecisionsDir],
    period_days: i64,
    now: Option<DateTime<Utc>>,
) -> Result<DeltaReportOutput, String> {
    let report = build_delta_report(
        io,
        mandates_dir,
        mandates_file,
        decisions_dirs,
        period_days,
        now,
    )
    .await?;
    let markdown = format_delta_report_markdown(&report);
    let path = report_path(mandates_dir, &report.period_end);
    io.write_file(&path, &markdown).await;
    Ok(DeltaReportOutput {
        report,
        markdown,
        path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemoryIo;
    use mt_mandates::{AudacityLevel, RiskLevel};
    use serde_json::json;

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

    fn quiz_file(time_sec: f64, iterations: u32) -> String {
        format!("---\nschema_version: 1\ndepth: one-tap\niterations: {iterations}\ntime_to_understanding_sec: {time_sec}\n---\n")
    }

    fn solo_decision_request(decision_type: &str, deadline_cost: Option<&str>) -> String {
        let mut lines = vec![
            "---".to_string(),
            "type: decision-request".to_string(),
            "computed_owner: olena".to_string(),
            "escalation_chain: [olena, vitalii]".to_string(),
            "leverage_facets: { irreversible: false, blast_radius: node }".to_string(),
            format!("decision_type: {decision_type}"),
        ];
        if let Some(dc) = deadline_cost {
            lines.push(format!("deadline_cost: \"{dc}\""));
        }
        lines.push("---".to_string());
        lines.push("## Контекст".to_string());
        lines.push("x".to_string());
        lines.join("\n")
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

    // --- deriveDecisionsSummary ---------------------------------------------

    #[test]
    fn solo_human_decision_within_period_is_human() {
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                (
                    "0001-decision-request.md".into(),
                    solo_decision_request("architecture", None),
                ),
                (
                    "0001-approval.json".into(),
                    json!({"chosen_option":"A","signed_at":"2026-08-05T00:00:00.000Z"}).to_string(),
                ),
                ("0001-quiz.md".into(), quiz_file(120.0, 1)),
            ],
        }];
        let closed = derive_decisions_summary(
            &decisions_dirs,
            &mandates_fixture(),
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        )
        .unwrap();
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0].classification, Classification::Human);
        assert_eq!(closed[0].decision_type, "architecture");
        assert_eq!(closed[0].quiz_time_to_understanding_sec, 120.0);
    }

    #[test]
    fn delegated_to_model_is_model_despite_computed_owner() {
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                ("0001-decision-request.md".into(), solo_decision_request("ops", None)),
                ("0001-delegation.json".into(), json!({"delegated_to":"fable-5","delegated_by":"olena","signed_at":"2026-08-05T00:00:00.000Z"}).to_string()),
                ("0001-approval.json".into(), json!({"chosen_option":"A","signed_at":"2026-08-06T00:00:00.000Z"}).to_string()),
            ],
        }];
        let closed = derive_decisions_summary(
            &decisions_dirs,
            &mandates_fixture(),
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        )
        .unwrap();
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0].classification, Classification::Model);
        assert_eq!(closed[0].quiz_time_to_understanding_sec, 0.0);
    }

    #[test]
    fn outside_period_window_is_not_counted() {
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                (
                    "0001-decision-request.md".into(),
                    solo_decision_request("architecture", None),
                ),
                (
                    "0001-approval.json".into(),
                    json!({"chosen_option":"A","signed_at":"2026-01-01T00:00:00.000Z"}).to_string(),
                ),
            ],
        }];
        let closed = derive_decisions_summary(
            &decisions_dirs,
            &mandates_fixture(),
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        )
        .unwrap();
        assert!(closed.is_empty());
    }

    #[test]
    fn still_open_without_approval_is_not_counted() {
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![(
                "0001-decision-request.md".into(),
                solo_decision_request("architecture", None),
            )],
        }];
        let closed = derive_decisions_summary(
            &decisions_dirs,
            &mandates_fixture(),
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        )
        .unwrap();
        assert!(closed.is_empty());
    }

    #[test]
    fn quorum_closed_sums_time_of_all_signers() {
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                ("0001-decision-request.md".into(), quorum_decision_request()),
                (
                    "0001-approval-olena.json".into(),
                    json!({"chosen_option":"A","signed_at":"2026-08-05T00:00:00.000Z"}).to_string(),
                ),
                (
                    "0001-approval-vitalii.json".into(),
                    json!({"chosen_option":"A","signed_at":"2026-08-06T00:00:00.000Z"}).to_string(),
                ),
                ("0001-quiz-olena.md".into(), quiz_file(300.0, 1)),
                ("0001-quiz-vitalii.md".into(), quiz_file(200.0, 1)),
            ],
        }];
        let closed = derive_decisions_summary(
            &decisions_dirs,
            &mandates_fixture(),
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        )
        .unwrap();
        assert_eq!(closed.len(), 1);
        assert_eq!(closed[0].classification, Classification::Quorum);
        assert_eq!(closed[0].quiz_time_to_understanding_sec, 500.0);
        assert_eq!(closed[0].closed_at, "2026-08-06T00:00:00.000Z");
    }

    #[test]
    fn quorum_diverged_pending_is_not_counted() {
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                ("0001-decision-request.md".into(), quorum_decision_request()),
                (
                    "0001-approval-olena.json".into(),
                    json!({"chosen_option":"A","signed_at":"2026-08-05T00:00:00.000Z"}).to_string(),
                ),
            ],
        }];
        let closed = derive_decisions_summary(
            &decisions_dirs,
            &mandates_fixture(),
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        )
        .unwrap();
        assert!(closed.is_empty());
    }

    // --- summarizeDecisions --------------------------------------------------

    #[test]
    fn summarize_by_classification_and_type() {
        let closed = vec![
            ClosedDecision {
                run_id: None,
                nnnn: "0001".into(),
                decision_type: "ops".into(),
                classification: Classification::Model,
                chosen_option: None,
                closed_at: "x".into(),
                quiz_time_to_understanding_sec: 0.0,
            },
            ClosedDecision {
                run_id: None,
                nnnn: "0002".into(),
                decision_type: "ops".into(),
                classification: Classification::Human,
                chosen_option: None,
                closed_at: "x".into(),
                quiz_time_to_understanding_sec: 60.0,
            },
            ClosedDecision {
                run_id: None,
                nnnn: "0003".into(),
                decision_type: "architecture".into(),
                classification: Classification::Quorum,
                chosen_option: None,
                closed_at: "x".into(),
                quiz_time_to_understanding_sec: 500.0,
            },
        ];
        let summary = summarize_decisions(&closed);
        assert_eq!(summary.total, 3);
        assert_eq!(
            summary.by_classification,
            ByClassification {
                human: 1,
                model: 1,
                quorum: 1
            }
        );
        assert_eq!(summary.by_type.len(), 2);
        assert_eq!(
            summary.by_type[0],
            DecisionTypeSummary {
                decision_type: "ops".into(),
                human: 1,
                model: 1,
                quorum: 0,
                total: 2
            }
        );
        assert_eq!(
            summary.by_type[1],
            DecisionTypeSummary {
                decision_type: "architecture".into(),
                human: 0,
                model: 0,
                quorum: 1,
                total: 1
            }
        );
    }

    // --- gateCostEur -----------------------------------------------------------

    #[test]
    fn gate_cost_counts_only_human_and_quorum() {
        let closed = vec![
            ClosedDecision {
                run_id: None,
                nnnn: "1".into(),
                decision_type: "x".into(),
                classification: Classification::Human,
                chosen_option: None,
                closed_at: "x".into(),
                quiz_time_to_understanding_sec: 3600.0,
            },
            ClosedDecision {
                run_id: None,
                nnnn: "2".into(),
                decision_type: "x".into(),
                classification: Classification::Quorum,
                chosen_option: None,
                closed_at: "x".into(),
                quiz_time_to_understanding_sec: 1800.0,
            },
            ClosedDecision {
                run_id: None,
                nnnn: "3".into(),
                decision_type: "x".into(),
                classification: Classification::Model,
                chosen_option: None,
                closed_at: "x".into(),
                quiz_time_to_understanding_sec: 999999.0,
            },
        ];
        assert_eq!(gate_cost_eur(&closed, 60.0), 90.0);
    }

    #[test]
    fn gate_cost_empty_list_is_zero() {
        assert_eq!(gate_cost_eur(&[], 60.0), 0.0);
    }

    // --- countBlockedWithDeadlineCost -------------------------------------------

    #[test]
    fn counts_open_decisions_with_deadline_cost_snapshot() {
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                (
                    "0001-decision-request.md".into(),
                    solo_decision_request("architecture", Some("блокує реліз")),
                ),
                (
                    "0002-decision-request.md".into(),
                    solo_decision_request("architecture", Some("блокує SLA")),
                ),
                (
                    "0002-approval.json".into(),
                    json!({"chosen_option":"A"}).to_string(),
                ),
                (
                    "0003-decision-request.md".into(),
                    solo_decision_request("architecture", None),
                ),
            ],
        }];
        assert_eq!(
            count_blocked_with_deadline_cost(&decisions_dirs).unwrap(),
            1
        );
    }

    // --- delegationDepth ---------------------------------------------------------

    #[test]
    fn counts_model_owned_types_and_delegations_in_period() {
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                (
                    "0001-delegation.json".into(),
                    json!({"delegated_to":"fable-5","signed_at":"2026-08-05T00:00:00.000Z"})
                        .to_string(),
                ),
                (
                    "0002-delegation.json".into(),
                    json!({"delegated_to":"fable-5","signed_at":"2026-01-01T00:00:00.000Z"})
                        .to_string(),
                ),
            ],
        }];
        let result = delegation_depth(
            &mandates_fixture(),
            &decisions_dirs,
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        );
        assert_eq!(
            result,
            DelegationDepth {
                model_owned_decision_types: 1,
                delegations_in_period: 1
            }
        );
    }

    // --- candorDeliveredCount ----------------------------------------------------

    #[tokio::test]
    async fn candor_delivered_aggregates_across_person_owners_within_period() {
        let record = json!({"from_model":"fable-5","statement":"x","audacity_level":"low","created_at":"2026-08-05T00:00:00.000Z"});
        let mut old_record = record.clone();
        old_record["created_at"] = json!("2026-01-01T00:00:00.000Z");
        let io = MemoryIo::new([
            (
                "/root/.mt/candor/olena.jsonl".to_string(),
                format!("{record}\n{old_record}\n"),
            ),
            (
                "/root/.mt/candor/vitalii.jsonl".to_string(),
                format!("{record}\n"),
            ),
        ]);
        let count = candor_delivered_count(
            &io,
            "/root",
            &mandates_fixture(),
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        )
        .await;
        assert_eq!(count, 2);
    }

    // --- killSwitchActivationsCount ------------------------------------------------

    #[tokio::test]
    async fn counts_only_on_actions_within_period() {
        let log = format!(
            "{}\n{}\n{}\n",
            json!({"handle":"olena","action":"on","at":"2026-08-05T00:00:00.000Z"}),
            json!({"handle":"olena","action":"off","at":"2026-08-06T00:00:00.000Z"}),
            json!({"handle":"olena","action":"on","at":"2026-01-01T00:00:00.000Z"})
        );
        let io = MemoryIo::new([("/root/.mt/kill-switch/log.jsonl".to_string(), log)]);
        let count = kill_switch_activations_count(
            &io,
            "/root",
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        )
        .await;
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn missing_log_is_zero() {
        let io = MemoryIo::default();
        let count = kill_switch_activations_count(
            &io,
            "/root",
            dt("1970-01-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        )
        .await;
        assert_eq!(count, 0);
    }

    // --- deriveBoundaryMoves ------------------------------------------------------

    fn old_and_new_files() -> (MandatesFile, MandatesFile) {
        let old = MandatesFile {
            generation: 3,
            mandates: mandates_fixture(),
        };
        let mut new_mandates = mandates_fixture();
        new_mandates[0].thresholds.audacity = Some(AudacityLevel::High);
        let new_file = MandatesFile {
            generation: 4,
            mandates: new_mandates,
        };
        (old, new_file)
    }

    #[test]
    fn applied_marker_within_window_is_a_boundary_move_with_diff_lines() {
        let (old, new_file) = old_and_new_files();
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/mandate-change-demo-1/decisions".into(),
            files: vec![
                (
                    "0001-change.json".into(),
                    json!({"old": old, "new": new_file}).to_string(),
                ),
                (
                    "0001-applied.json".into(),
                    json!({"appliedAt":"2026-08-05T00:00:00.000Z","handle":"olena","role":"human"})
                        .to_string(),
                ),
            ],
        }];
        let moves = derive_boundary_moves(
            &decisions_dirs,
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z"),
        );
        assert_eq!(moves.len(), 1);
        assert_eq!(moves[0].owner, "fable-5");
        assert_eq!(moves[0].kind, MandateChangeKind::Widened);
        assert_eq!(moves[0].delegator_handle.as_deref(), Some("olena"));
        assert!(moves[0].diff_lines.iter().any(|l| l.contains("audacity")));
    }

    #[test]
    fn missing_applied_marker_is_not_counted() {
        let (old, new_file) = old_and_new_files();
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/mandate-change-demo-1/decisions".into(),
            files: vec![(
                "0001-change.json".into(),
                json!({"old": old, "new": new_file}).to_string(),
            )],
        }];
        assert!(derive_boundary_moves(
            &decisions_dirs,
            dt("1970-01-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z")
        )
        .is_empty());
    }

    #[test]
    fn applied_outside_window_is_not_counted() {
        let (old, new_file) = old_and_new_files();
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/mandate-change-demo-1/decisions".into(),
            files: vec![
                (
                    "0001-change.json".into(),
                    json!({"old": old, "new": new_file}).to_string(),
                ),
                (
                    "0001-applied.json".into(),
                    json!({"appliedAt":"2026-01-01T00:00:00.000Z","handle":"olena","role":"human"})
                        .to_string(),
                ),
            ],
        }];
        assert!(derive_boundary_moves(
            &decisions_dirs,
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z")
        )
        .is_empty());
    }

    #[test]
    fn non_mandate_change_run_is_ignored() {
        let (old, new_file) = old_and_new_files();
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                (
                    "0001-change.json".into(),
                    json!({"old": old, "new": new_file}).to_string(),
                ),
                (
                    "0001-applied.json".into(),
                    json!({"appliedAt":"2026-08-05T00:00:00.000Z","handle":"olena","role":"human"})
                        .to_string(),
                ),
            ],
        }];
        assert!(derive_boundary_moves(
            &decisions_dirs,
            dt("2026-08-01T00:00:00.000Z"),
            dt("2026-08-09T10:00:00.000Z")
        )
        .is_empty());
    }

    // --- buildDeltaReport / formatDeltaReportMarkdown — детермінізм ------------------

    #[tokio::test]
    async fn same_input_produces_byte_identical_markdown() {
        let io = MemoryIo::new([(
            "/root/.mt/org.json".to_string(),
            r#"{"hourly_rate_eur": 50}"#.to_string(),
        )]);
        let mandates_file = MandatesFile {
            generation: 3,
            mandates: mandates_fixture(),
        };
        let decisions_dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-1/decisions".into(),
            files: vec![
                (
                    "0001-decision-request.md".into(),
                    solo_decision_request("architecture", None),
                ),
                (
                    "0001-approval.json".into(),
                    json!({"chosen_option":"A","signed_at":"2026-08-05T00:00:00.000Z"}).to_string(),
                ),
                ("0001-quiz.md".into(), quiz_file(600.0, 1)),
            ],
        }];
        let now = Some(dt("2026-08-09T10:00:00.000Z"));
        let report1 = build_delta_report(&io, "/root", &mandates_file, &decisions_dirs, 14, now)
            .await
            .unwrap();
        let report2 = build_delta_report(&io, "/root", &mandates_file, &decisions_dirs, 14, now)
            .await
            .unwrap();
        assert_eq!(
            format_delta_report_markdown(&report1),
            format_delta_report_markdown(&report2)
        );
        assert!((report1.gate_cost_eur - (600.0 / 3600.0) * 50.0).abs() < 0.1);
        assert_eq!(report1.hourly_rate_eur, 50.0);
        assert_eq!(report1.decisions.total, 1);
    }

    #[tokio::test]
    async fn markdown_has_task_sections_and_never_leaks_private_content() {
        let io = MemoryIo::new([(
            "/root/.mt/candor/olena.jsonl".to_string(),
            format!(
                "{}\n",
                json!({"from_model":"fable-5","statement":"ДУЖЕ ПРИВАТНЕ","audacity_level":"low","created_at":"2026-08-05T00:00:00.000Z"})
            ),
        )]);
        let mandates_file = MandatesFile {
            generation: 3,
            mandates: mandates_fixture(),
        };
        let report = build_delta_report(
            &io,
            "/root",
            &mandates_file,
            &[],
            14,
            Some(dt("2026-08-09T10:00:00.000Z")),
        )
        .await
        .unwrap();
        let markdown = format_delta_report_markdown(&report);
        assert!(markdown.contains("## Рух межі"));
        assert!(markdown.contains("## Рішення за період"));
        assert!(markdown.contains("## Ціна гейта"));
        assert!(markdown.contains("## Глибина делегування"));
        assert!(markdown.contains("## Агреговано (без приватного)"));
        assert!(!markdown.contains("ДУЖЕ ПРИВАТНЕ"));
        assert_eq!(report.candor_delivered, 1);
    }

    // --- reportPath ----------------------------------------------------------------

    #[test]
    fn report_path_is_reports_dir_with_date_prefix() {
        assert_eq!(
            report_path("/root", "2026-08-09T10:00:00.000Z"),
            "/root/.mt/reports/2026-08-09-delta.md"
        );
    }

    // --- deltaReport — повний потік --------------------------------------------------

    #[tokio::test]
    async fn writes_file_at_report_path_and_returns_markdown_plus_model() {
        let io = MemoryIo::default();
        let mandates_file = MandatesFile {
            generation: 3,
            mandates: mandates_fixture(),
        };
        let result = delta_report(
            &io,
            "/root",
            &mandates_file,
            &[],
            7,
            Some(dt("2026-08-09T10:00:00.000Z")),
        )
        .await
        .unwrap();
        assert_eq!(result.path, "/root/.mt/reports/2026-08-09-delta.md");
        assert_eq!(
            io.get(&result.path).as_deref(),
            Some(result.markdown.as_str())
        );
    }
}
