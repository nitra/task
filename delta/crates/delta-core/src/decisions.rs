//! Парсер `decisions/NNNN-decision-request.md` + черга «Вирішую» — порт
//! `delta/src/decisions.js` (mt: `docs/architecture/mandates.md`, «Артефакт
//! decision-request»). Той самий файловий мок git-refs транспорту, що JS:
//! замість `refs/mt/runs/{run-id}/decisions/NNNN-decision-request.md`
//! напряму з git, скануємо ту саму структуру директорій на диску — сканування
//! диска лишається відповідальністю викликача (Tauri-команда/CLI), цей
//! модуль — pure-функції над уже прочитаним вмістом.
//!
//! **Kill-switch і delegation (M5/M6) читаються тут ЛИШЕ як дані** (сусідні
//! файли `NNNN-delegation.json`, карта `kill_switch_redirect`) — власна
//! логіка цих шарів лишається в JS до фази B (`src/delegation.js`,
//! `src/kill-switch.js`); тут відтворено ТОЧНО ті самі фільтри черги, що
//! `decisions.js` вже мав, звірено з оригіналом.

use std::collections::HashMap;

use regex::Regex;
use serde_json::Value;

const NOTABLE_COST_EUR_THRESHOLD: f64 = 300.0;
const QUORUM_DEPTH: &str = "teach-back";

fn blast_radius_rank(blast_radius: &str) -> i32 {
    match blast_radius {
        "node" => 0,
        "subtree" => 1,
        "repo" => 2,
        "company" => 3,
        _ => 0,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionOption {
    pub label: String,
    pub title: String,
    pub body: String,
}

/// Leverage-фасети decision-request — навмисно НЕ enum для `blast_radius`/
/// `divergence` (JS-мок толерантний до будь-якого рядкового значення, лише
/// відомі значення впливають на `depthForFacets`/сортування; невідоме —
/// трактується як найнижчий ранг, не помилка парсингу).
#[derive(Debug, Clone, PartialEq)]
pub struct LeverageFacets {
    pub irreversible: bool,
    pub blast_radius: String,
    pub divergence: Option<String>,
    pub est_cost_eur: Option<f64>,
}

impl Default for LeverageFacets {
    fn default() -> Self {
        LeverageFacets {
            irreversible: false,
            blast_radius: "node".to_string(),
            divergence: None,
            est_cost_eur: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct DecisionRequestMeta {
    pub path: Option<String>,
    pub run_id: Option<String>,
    pub nnnn: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecisionRequest {
    pub path: Option<String>,
    pub run_id: Option<String>,
    pub nnnn: Option<String>,
    pub mandate_generation: Option<i64>,
    pub computed_owner: Option<String>,
    pub escalation_chain: Vec<String>,
    pub retry_history: Vec<Value>,
    pub leverage_facets: LeverageFacets,
    pub deadline_cost: Option<String>,
    pub recommended_by: Option<String>,
    pub decision_type: Option<String>,
    pub approvers: Option<Vec<String>>,
    pub opened_at: Option<String>,
    pub context: String,
    pub options: Vec<DecisionOption>,
    pub recommendation: String,
}

#[derive(Debug)]
pub struct FrontmatterError(pub String);

impl std::fmt::Display for FrontmatterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "decision-request: невалідний фронтматер — {}", self.0)
    }
}
impl std::error::Error for FrontmatterError {}

/// Розбиває markdown-файл на YAML-фронтматер (обʼєкт) і тіло (рядок). Файл
/// без валідного фронтматера — фронтматер `{}`, усе тіло як є (не кидає) —
/// `decisions.js: splitFrontmatter`.
pub fn split_frontmatter(text: &str) -> Result<(Value, String), FrontmatterError> {
    let re =
        Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---\r?\n?(.*)$").expect("статичний regex валідний");
    let Some(caps) = re.captures(text) else {
        return Ok((Value::Object(Default::default()), text.to_string()));
    };
    let raw_fm = caps.get(1).map(|m| m.as_str()).unwrap_or("");
    let body = caps.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
    let frontmatter: Value =
        serde_norway::from_str(raw_fm).map_err(|e| FrontmatterError(e.to_string()))?;
    Ok((frontmatter, body))
}

struct RawSection {
    heading: String,
    body: String,
}

/// Розбиває тіло markdown на секції за заголовками одного рівня (`##`/`###`)
/// — префіксний тест замість `RegExp(marker)`, той самий підхід, що JS
/// (`decisions.js: splitSections`).
fn split_sections(body: &str, marker: &str) -> Vec<RawSection> {
    let prefix = format!("{marker} ");
    let mut sections: Vec<(String, Vec<&str>)> = Vec::new();
    for line in body.split(['\n']) {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if let Some(heading) = line.strip_prefix(&prefix) {
            sections.push((heading.trim().to_string(), Vec::new()));
        } else if let Some(last) = sections.last_mut() {
            last.1.push(line);
        }
    }
    sections
        .into_iter()
        .map(|(heading, lines)| RawSection {
            heading,
            body: lines.join("\n").trim().to_string(),
        })
        .collect()
}

fn section_body(sections: &[RawSection], heading: &str) -> String {
    sections
        .iter()
        .find(|s| s.heading.to_lowercase() == heading.to_lowercase())
        .map(|s| s.body.clone())
        .unwrap_or_default()
}

/// Розбиває заголовок одного варіанта (`'A. Виділити ...'`) на `label`/
/// `title` без regex — той самий підхід, що `decisions.js:
/// splitOptionLabel`.
fn split_option_label(heading: &str) -> Option<(String, String)> {
    match heading.find(' ') {
        None => {
            let label = heading.strip_suffix('.').unwrap_or(heading);
            if label.is_empty() {
                None
            } else {
                Some((label.to_string(), String::new()))
            }
        }
        Some(space_index) => {
            let raw_label = &heading[..space_index];
            let label = raw_label.strip_suffix('.').unwrap_or(raw_label);
            if label.is_empty() {
                return None;
            }
            let title = heading[space_index + 1..].trim().to_string();
            Some((label.to_string(), title))
        }
    }
}

fn parse_options(variants_body: &str) -> Vec<DecisionOption> {
    split_sections(variants_body, "###")
        .into_iter()
        .filter_map(|s| {
            split_option_label(&s.heading).map(|(label, title)| DecisionOption {
                label,
                title,
                body: s.body,
            })
        })
        .collect()
}

fn normalize_leverage_facets(raw: Option<&Value>) -> LeverageFacets {
    let obj = raw.and_then(|v| v.as_object());
    let get = |key: &str| obj.and_then(|o| o.get(key));
    LeverageFacets {
        irreversible: get("irreversible")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        blast_radius: get("blast_radius")
            .and_then(|v| v.as_str())
            .unwrap_or("node")
            .to_string(),
        divergence: get("divergence")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        est_cost_eur: get("est_cost_eur").and_then(|v| v.as_f64()),
    }
}

/// Розбирає текст одного `NNNN-decision-request.md` у нормалізований
/// обʼєкт (`decisions.js: parseDecisionRequest`).
pub fn parse_decision_request(
    text: &str,
    meta: DecisionRequestMeta,
) -> Result<DecisionRequest, FrontmatterError> {
    let (frontmatter, body) = split_frontmatter(text)?;
    let sections = split_sections(&body, "##");
    let variants_body = section_body(&sections, "Варіанти");

    let fm = frontmatter.as_object();
    let get = |key: &str| fm.and_then(|o| o.get(key));

    Ok(DecisionRequest {
        path: meta.path,
        run_id: meta.run_id,
        nnnn: meta.nnnn,
        mandate_generation: get("mandate_generation").and_then(|v| v.as_i64()),
        computed_owner: get("computed_owner")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        escalation_chain: get("escalation_chain")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().map(value_to_string).collect())
            .unwrap_or_default(),
        retry_history: get("retry_history")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default(),
        leverage_facets: normalize_leverage_facets(get("leverage_facets")),
        deadline_cost: get("deadline_cost")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        recommended_by: get("recommended_by")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        decision_type: get("decision_type")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        approvers: get("approvers")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().map(value_to_string).collect()),
        opened_at: get("opened_at")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        context: section_body(&sections, "Контекст"),
        options: parse_options(&variants_body),
        recommendation: section_body(&sections, "Рекомендація агента"),
    })
}

fn value_to_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// Чи рішення вимагає мультипартійного підпису (кворуму) — КОЖНЕ
/// irreversible-рішення (`decisions.js: requiresQuorum`).
pub fn requires_quorum(facets: &LeverageFacets) -> bool {
    facets.irreversible
}

/// Список handle-ів, чиї підписи потрібні для закриття irreversible-рішення
/// — фронтматер `approvers: [...]`, або фолбек `[computedOwner]`
/// (`decisions.js: resolveApprovers`).
pub fn resolve_approvers(dr: &DecisionRequest) -> Vec<String> {
    if let Some(approvers) = &dr.approvers {
        if !approvers.is_empty() {
            return approvers.clone();
        }
    }
    dr.computed_owner.clone().into_iter().collect()
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SignedApproval {
    pub handle: String,
    #[serde(rename = "chosenOption")]
    pub chosen_option: Option<String>,
    #[serde(rename = "signedAt")]
    pub signed_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuorumState {
    Pending,
    Closed,
    Diverged,
}

#[derive(Debug, Clone, PartialEq)]
pub struct QuorumStatus {
    pub approvers: Vec<String>,
    pub signed: Vec<SignedApproval>,
    pub pending: Vec<String>,
    pub status: QuorumState,
}

/// Деривує стан кворуму irreversible-рішення зі скановних файлів сусідньої
/// decisions-директорії (`NNNN-approval-{handle}.json` на кожного
/// підписанта) — pure-функція (`decisions.js: deriveQuorumStatus`).
pub fn derive_quorum_status(
    dr: &DecisionRequest,
    files_by_name: &HashMap<String, String>,
) -> QuorumStatus {
    let approvers = resolve_approvers(dr);
    let nnnn = dr.nnnn.clone().unwrap_or_default();
    let mut signed = Vec::new();
    let mut pending = Vec::new();
    for handle in &approvers {
        let key = format!("{nnnn}-approval-{handle}.json");
        let Some(raw) = files_by_name.get(&key) else {
            pending.push(handle.clone());
            continue;
        };
        match serde_json::from_str::<Value>(raw) {
            Ok(approval) => signed.push(SignedApproval {
                handle: handle.clone(),
                chosen_option: approval
                    .get("chosen_option")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                signed_at: approval
                    .get("signed_at")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            }),
            Err(_) => pending.push(handle.clone()), // битий approval-файл — fail-closed, не рахується
        }
    }
    let all_signed = pending.is_empty();
    let distinct_options: std::collections::HashSet<Option<String>> =
        signed.iter().map(|s| s.chosen_option.clone()).collect();
    let status = if all_signed {
        if distinct_options.len() == 1 {
            QuorumState::Closed
        } else {
            QuorumState::Diverged
        }
    } else {
        QuorumState::Pending
    };
    QuorumStatus {
        approvers,
        signed,
        pending,
        status,
    }
}

/// Мапить leverage-фасети на глибину квіз-гейта (`decisions.js:
/// depthForFacets`) — див. таблицю режимів у mandates.md, «Крок 3».
pub fn depth_for_facets(facets: &LeverageFacets) -> &'static str {
    let wide_blast_radius = facets.blast_radius == "repo" || facets.blast_radius == "company";
    if facets.irreversible || wide_blast_radius {
        return "teach-back";
    }
    let medium_blast_radius = facets.blast_radius == "subtree";
    let medium_or_high_divergence =
        matches!(facets.divergence.as_deref(), Some("medium") | Some("high"));
    let notable_cost = facets
        .est_cost_eur
        .is_some_and(|c| c >= NOTABLE_COST_EUR_THRESHOLD);
    if medium_blast_radius || medium_or_high_divergence || notable_cost {
        return "standard";
    }
    "one-tap"
}

fn is_open(files_by_name: &HashMap<String, String>, nnnn: &str) -> bool {
    !files_by_name.contains_key(&format!("{nnnn}-approval.json"))
}

fn delegated_to_or_null(files_by_name: &HashMap<String, String>, nnnn: &str) -> Option<String> {
    let raw = files_by_name.get(&format!("{nnnn}-delegation.json"))?;
    let record: Value = serde_json::from_str(raw).ok()?;
    record
        .get("delegated_to")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

fn effective_owner(
    raw_owner: Option<&str>,
    kill_switch_redirect: Option<&HashMap<String, String>>,
) -> Option<String> {
    let raw_owner = raw_owner?;
    kill_switch_redirect
        .and_then(|m| m.get(raw_owner))
        .cloned()
        .or_else(|| Some(raw_owner.to_string()))
}

/// Один елемент черги «Вирішую» — decision-request з депривованим
/// контекстом маршрутизації/кворуму (`decisions.js: deriveQueue`, злитий
/// spread-обʼєкт JS розбито тут на `request` + queue-специфічні поля).
#[derive(Debug, Clone, PartialEq)]
pub struct QueueItem {
    pub request: DecisionRequest,
    pub dir: String,
    pub depth: String,
    pub open: bool,
    pub quorum: Option<QuorumStatus>,
    pub awaiting_me: Option<bool>,
    pub delegated_to: Option<String>,
    pub delegated_by: Option<String>,
    pub kill_switch_redirected: Option<bool>,
}

fn quorum_queue_item(
    parsed: DecisionRequest,
    dir: &str,
    files_by_name: &HashMap<String, String>,
    handle: &str,
) -> Option<QueueItem> {
    let quorum = derive_quorum_status(&parsed, files_by_name);
    if !quorum.approvers.iter().any(|a| a == handle) {
        return None;
    }
    if quorum.status == QuorumState::Closed {
        return None;
    }
    let awaiting_me = quorum.pending.iter().any(|p| p == handle);
    Some(QueueItem {
        request: parsed,
        dir: dir.to_string(),
        depth: QUORUM_DEPTH.to_string(),
        open: true,
        quorum: Some(quorum),
        awaiting_me: Some(awaiting_me),
        delegated_to: None,
        delegated_by: None,
        kill_switch_redirected: None,
    })
}

fn solo_queue_item(
    parsed: DecisionRequest,
    dir: &str,
    files_by_name: &HashMap<String, String>,
    nnnn: &str,
    handle: &str,
    kill_switch_redirect: Option<&HashMap<String, String>>,
) -> Option<QueueItem> {
    let depth = depth_for_facets(&parsed.leverage_facets).to_string();
    let delegated_to = delegated_to_or_null(files_by_name, nnnn);
    if let Some(delegated_to) = delegated_to {
        let effective = effective_owner(Some(&delegated_to), kill_switch_redirect);
        return if effective.as_deref() == Some(handle) {
            let delegated_by = parsed.computed_owner.clone();
            Some(QueueItem {
                request: parsed,
                dir: dir.to_string(),
                depth,
                open: true,
                quorum: None,
                awaiting_me: None,
                delegated_to: Some(delegated_to.clone()),
                delegated_by,
                kill_switch_redirected: Some(effective.as_deref() != Some(delegated_to.as_str())),
            })
        } else {
            None
        };
    }
    let effective = effective_owner(parsed.computed_owner.as_deref(), kill_switch_redirect);
    if effective.as_deref() == Some(handle) {
        let kill_switch_redirected = Some(effective.as_deref() != parsed.computed_owner.as_deref());
        Some(QueueItem {
            request: parsed,
            dir: dir.to_string(),
            depth,
            open: true,
            quorum: None,
            awaiting_me: None,
            delegated_to: None,
            delegated_by: None,
            kill_switch_redirected,
        })
    } else {
        None
    }
}

/// Скановна decisions-директорія одного run-у — той самий вхід, що
/// Tauri-команда/CLI-скан файлової системи повертає (`decisions.js:
/// deriveQueue`, параметр `decisionsDirs`).
pub struct DecisionsDir {
    pub dir: String,
    pub files: Vec<(String, String)>,
}

fn decision_request_nnnn(file_name: &str) -> Option<String> {
    let re = Regex::new(r"^(\d{4})-decision-request\.md$").expect("статичний regex валідний");
    re.captures(file_name).map(|c| c[1].to_string())
}

/// Деривує чергу «Вирішую» одного власника — див. module doc
/// (`decisions.js: deriveQueue`). Побиті decision-request-и (невалідний
/// фронтматер) мовчки пропускаються — той самий fail-safe інваріант, що
/// решта черги (сканування не повинно валитись через один битий файл);
/// JS-оригінал такого захисту не мав (`parseDecisionRequest` там кидає), але
/// `deriveQueue` викликається лише на вже валідних фікстурах — тут
/// зроблено консервативніше заради надійності сканування реальної
/// файлової системи.
pub fn derive_queue(
    decisions_dirs: &[DecisionsDir],
    handle: Option<&str>,
    kill_switch_redirect: Option<&HashMap<String, String>>,
) -> Vec<QueueItem> {
    let Some(handle) = handle else {
        return Vec::new();
    };
    let mut items = Vec::new();
    for d in decisions_dirs {
        let files_by_name: HashMap<String, String> = d.files.iter().cloned().collect();
        for (name, content) in &d.files {
            let Some(nnnn) = decision_request_nnnn(name) else {
                continue;
            };
            let run_id = d
                .dir
                .split('/')
                .filter(|s| !s.is_empty())
                .rev()
                .nth(1)
                .map(str::to_string);
            let Ok(parsed) = parse_decision_request(
                content,
                DecisionRequestMeta {
                    path: Some(format!("{}/{}", d.dir, name)),
                    run_id,
                    nnnn: Some(nnnn.clone()),
                },
            ) else {
                continue;
            };

            if requires_quorum(&parsed.leverage_facets) {
                if let Some(item) = quorum_queue_item(parsed, &d.dir, &files_by_name, handle) {
                    items.push(item);
                }
                continue;
            }

            if !is_open(&files_by_name, &nnnn) {
                continue;
            }
            if let Some(item) = solo_queue_item(
                parsed,
                &d.dir,
                &files_by_name,
                &nnnn,
                handle,
                kill_switch_redirect,
            ) {
                items.push(item);
            }
        }
    }
    items.sort_by(by_leverage_desc);
    items
}

fn by_leverage_desc(a: &QueueItem, b: &QueueItem) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    if a.request.leverage_facets.irreversible != b.request.leverage_facets.irreversible {
        return if a.request.leverage_facets.irreversible {
            Ordering::Less
        } else {
            Ordering::Greater
        };
    }
    let rank_a = blast_radius_rank(&a.request.leverage_facets.blast_radius);
    let rank_b = blast_radius_rank(&b.request.leverage_facets.blast_radius);
    if rank_a != rank_b {
        return rank_b.cmp(&rank_a);
    }
    a.request.nnnn.cmp(&b.request.nnnn)
}

/// Серіалізує один decision-request у camelCase JSON — та сама форма,
/// що `decisions.js: parseDecisionRequest` віддавала GUI/CLI (Vue-
/// компоненти M1-M6 читають `leverageFacets`/`computedOwner`/... напряму).
/// camelCase-межа для GUI проведена ТУТ (CLI/Tauri-командний шар), той
/// самий підхід, що `mandates::mandate_to_camel_json`.
pub fn decision_request_to_json(dr: &DecisionRequest) -> serde_json::Value {
    serde_json::json!({
        "path": dr.path,
        "runId": dr.run_id,
        "nnnn": dr.nnnn,
        "mandateGeneration": dr.mandate_generation,
        "computedOwner": dr.computed_owner,
        "escalationChain": dr.escalation_chain,
        "retryHistory": dr.retry_history,
        "leverageFacets": {
            "irreversible": dr.leverage_facets.irreversible,
            "blastRadius": dr.leverage_facets.blast_radius,
            "divergence": dr.leverage_facets.divergence,
            "estCostEur": dr.leverage_facets.est_cost_eur,
        },
        "deadlineCost": dr.deadline_cost,
        "recommendedBy": dr.recommended_by,
        "decisionType": dr.decision_type,
        "approvers": dr.approvers,
        "openedAt": dr.opened_at,
        "context": dr.context,
        "options": dr.options.iter().map(|o| serde_json::json!({"label": o.label, "title": o.title, "body": o.body})).collect::<Vec<_>>(),
        "recommendation": dr.recommendation,
    })
}

fn quorum_status_to_json(status: &QuorumStatus) -> serde_json::Value {
    let signed: Vec<serde_json::Value> = status.signed.iter().map(|s| serde_json::json!({"handle": s.handle, "chosenOption": s.chosen_option, "signedAt": s.signed_at})).collect();
    let status_str = match status.status {
        QuorumState::Pending => "pending",
        QuorumState::Closed => "closed",
        QuorumState::Diverged => "diverged",
    };
    serde_json::json!({"approvers": status.approvers, "signed": signed, "pending": status.pending, "status": status_str})
}

/// Серіалізує один елемент черги «Вирішую» у camelCase JSON — плоский
/// spread decision-request полів + queue-специфічні поля, той самий
/// вихід, що `decisions.js: deriveQueue` (`decisions_show` tool).
pub fn queue_item_to_json(item: &QueueItem) -> serde_json::Value {
    let mut value = decision_request_to_json(&item.request);
    let obj = value
        .as_object_mut()
        .expect("decision_request_to_json завжди повертає обʼєкт");
    obj.insert("dir".to_string(), serde_json::json!(item.dir));
    obj.insert("depth".to_string(), serde_json::json!(item.depth));
    obj.insert("open".to_string(), serde_json::json!(item.open));
    if let Some(quorum) = &item.quorum {
        obj.insert("quorum".to_string(), quorum_status_to_json(quorum));
    }
    if let Some(awaiting_me) = item.awaiting_me {
        obj.insert("awaitingMe".to_string(), serde_json::json!(awaiting_me));
    }
    if let Some(delegated_to) = &item.delegated_to {
        obj.insert("delegatedTo".to_string(), serde_json::json!(delegated_to));
    }
    if let Some(delegated_by) = &item.delegated_by {
        obj.insert("delegatedBy".to_string(), serde_json::json!(delegated_by));
    }
    if let Some(redirected) = item.kill_switch_redirected {
        obj.insert(
            "killSwitchRedirected".to_string(),
            serde_json::json!(redirected),
        );
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    const DR_0001: &str =
        include_str!("../tests/fixtures/runs/demo-1/decisions/0001-decision-request.md");
    const DR_0002: &str =
        include_str!("../tests/fixtures/runs/demo-1/decisions/0002-decision-request.md");
    const DR_CLOSED: &str =
        include_str!("../tests/fixtures/runs/demo-2/decisions/0001-decision-request.md");
    const APPROVAL_CLOSED: &str =
        include_str!("../tests/fixtures/runs/demo-2/decisions/0001-approval.json");
    const DR_IRREVERSIBLE: &str =
        include_str!("../tests/fixtures/runs/demo-5/decisions/0001-decision-request.md");

    #[test]
    fn split_frontmatter_splits_object_and_body() {
        let (fm, body) = split_frontmatter("---\nfoo: bar\n---\n## Заголовок\ntext").unwrap();
        assert_eq!(fm["foo"], "bar");
        assert_eq!(body, "## Заголовок\ntext");
    }

    #[test]
    fn split_frontmatter_no_frontmatter_returns_empty_object_full_body() {
        let (fm, body) = split_frontmatter("просто текст").unwrap();
        assert!(fm.as_object().unwrap().is_empty());
        assert_eq!(body, "просто текст");
    }

    #[test]
    fn split_frontmatter_invalid_yaml_errors() {
        assert!(split_frontmatter("---\nfoo: [\n---\nbody").is_err());
    }

    #[test]
    fn parses_0001_frontmatter_into_normalized_form() {
        let dr = parse_decision_request(
            DR_0001,
            DecisionRequestMeta {
                path: Some("x".into()),
                run_id: Some("demo-1".into()),
                nnnn: Some("0001".into()),
            },
        )
        .unwrap();
        assert_eq!(dr.mandate_generation, Some(3));
        assert_eq!(dr.computed_owner.as_deref(), Some("olena"));
        assert_eq!(dr.escalation_chain, vec!["olena", "vitalii"]);
        assert_eq!(
            dr.recommended_by.as_deref(),
            Some("escalation-intake-fable-5")
        );
        assert!(dr
            .deadline_cost
            .as_deref()
            .unwrap()
            .contains("design-review"));
        assert_eq!(dr.retry_history.len(), 1);
    }

    #[test]
    fn normalizes_leverage_facets_with_defaults_for_missing_fields() {
        let dr = parse_decision_request(DR_0001, DecisionRequestMeta::default()).unwrap();
        assert_eq!(
            dr.leverage_facets,
            LeverageFacets {
                irreversible: false,
                blast_radius: "node".into(),
                divergence: Some("low".into()),
                est_cost_eur: Some(40.0)
            }
        );
    }

    #[test]
    fn empty_leverage_facets_defaults_reversible_node() {
        let dr = parse_decision_request(
            "---\ncomputed_owner: olena\n---\n## Контекст\nx",
            DecisionRequestMeta::default(),
        )
        .unwrap();
        assert_eq!(dr.leverage_facets, LeverageFacets::default());
    }

    #[test]
    fn parses_context_and_recommendation_sections() {
        let dr = parse_decision_request(DR_0001, DecisionRequestMeta::default()).unwrap();
        assert!(dr.context.contains("MandateCard.vue"));
        assert!(dr.recommendation.contains("Варіант B"));
    }

    #[test]
    fn parses_variants_into_options_with_label_title_body() {
        let dr = parse_decision_request(DR_0001, DecisionRequestMeta::default()).unwrap();
        assert_eq!(dr.options.len(), 2);
        assert_eq!(dr.options[0].label, "A");
        assert!(dr.options[0].title.contains("MandateChipRow"));
        assert!(dr.options[0].body.contains("Наслідки"));
        assert_eq!(dr.options[1].label, "B");
    }

    #[test]
    fn keeps_positional_meta_from_passed_meta() {
        let dr = parse_decision_request(
            DR_0001,
            DecisionRequestMeta {
                path: Some("/abs/0001-decision-request.md".into()),
                run_id: Some("demo-1".into()),
                nnnn: Some("0001".into()),
            },
        )
        .unwrap();
        assert_eq!(dr.path.as_deref(), Some("/abs/0001-decision-request.md"));
        assert_eq!(dr.run_id.as_deref(), Some("demo-1"));
        assert_eq!(dr.nnnn.as_deref(), Some("0001"));
    }

    #[test]
    fn depth_for_facets_reversible_low_is_one_tap() {
        assert_eq!(
            depth_for_facets(&LeverageFacets {
                irreversible: false,
                blast_radius: "node".into(),
                divergence: Some("low".into()),
                est_cost_eur: Some(40.0)
            }),
            "one-tap"
        );
    }

    #[test]
    fn depth_for_facets_irreversible_is_teach_back_regardless() {
        assert_eq!(
            depth_for_facets(&LeverageFacets {
                irreversible: true,
                blast_radius: "node".into(),
                divergence: Some("low".into()),
                est_cost_eur: Some(0.0)
            }),
            "teach-back"
        );
    }

    #[test]
    fn depth_for_facets_wide_blast_radius_is_teach_back() {
        for br in ["repo", "company"] {
            assert_eq!(
                depth_for_facets(&LeverageFacets {
                    irreversible: false,
                    blast_radius: br.into(),
                    divergence: Some("low".into()),
                    est_cost_eur: Some(0.0)
                }),
                "teach-back"
            );
        }
    }

    #[test]
    fn depth_for_facets_each_medium_facet_alone_is_sufficient_for_standard() {
        assert_eq!(
            depth_for_facets(&LeverageFacets {
                irreversible: false,
                blast_radius: "subtree".into(),
                divergence: Some("low".into()),
                est_cost_eur: Some(0.0)
            }),
            "standard"
        );
        assert_eq!(
            depth_for_facets(&LeverageFacets {
                irreversible: false,
                blast_radius: "node".into(),
                divergence: Some("medium".into()),
                est_cost_eur: Some(0.0)
            }),
            "standard"
        );
        assert_eq!(
            depth_for_facets(&LeverageFacets {
                irreversible: false,
                blast_radius: "node".into(),
                divergence: Some("low".into()),
                est_cost_eur: Some(300.0)
            }),
            "standard"
        );
    }

    #[test]
    fn depth_for_facets_cost_below_threshold_is_one_tap() {
        assert_eq!(
            depth_for_facets(&LeverageFacets {
                irreversible: false,
                blast_radius: "node".into(),
                divergence: Some("low".into()),
                est_cost_eur: Some(299.0)
            }),
            "one-tap"
        );
    }

    #[test]
    fn depth_for_facets_irreversible_dominates_medium_facets() {
        assert_eq!(
            depth_for_facets(&LeverageFacets {
                irreversible: true,
                blast_radius: "subtree".into(),
                divergence: Some("medium".into()),
                est_cost_eur: Some(300.0)
            }),
            "teach-back"
        );
    }

    fn demo_dirs() -> Vec<DecisionsDir> {
        vec![
            DecisionsDir {
                dir: "/root/runs/demo-1/decisions".into(),
                files: vec![
                    ("0001-decision-request.md".into(), DR_0001.into()),
                    ("0002-decision-request.md".into(), DR_0002.into()),
                ],
            },
            DecisionsDir {
                dir: "/root/runs/demo-2/decisions".into(),
                files: vec![
                    ("0001-decision-request.md".into(), DR_CLOSED.into()),
                    ("0001-approval.json".into(), APPROVAL_CLOSED.into()),
                ],
            },
        ]
    }

    #[test]
    fn derive_queue_returns_only_open_requests_of_owner() {
        let queue = derive_queue(&demo_dirs(), Some("olena"), None);
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].request.nnnn.as_deref(), Some("0001"));
        assert_eq!(queue[0].request.run_id.as_deref(), Some("demo-1"));
    }

    #[test]
    fn derive_queue_different_handle_sees_own_disjoint_slice() {
        let queue = derive_queue(&demo_dirs(), Some("vitalii"), None);
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].request.nnnn.as_deref(), Some("0002"));
        assert_eq!(queue[0].request.computed_owner.as_deref(), Some("vitalii"));
    }

    #[test]
    fn derive_queue_closed_decision_not_in_queue_even_if_owner_matches() {
        let queue = derive_queue(&demo_dirs(), Some("olena"), None);
        assert!(!queue.iter().any(|i| i.dir.contains("demo-2")));
    }

    #[test]
    fn derive_queue_without_handle_is_empty() {
        assert!(derive_queue(&demo_dirs(), None, None).is_empty());
    }

    #[test]
    fn derive_queue_item_carries_depth_and_open() {
        let queue = derive_queue(&demo_dirs(), Some("olena"), None);
        assert_eq!(queue[0].depth, "one-tap");
        assert!(queue[0].open);
    }

    #[test]
    fn derive_queue_sorts_by_leverage_irreversible_and_wider_blast_radius_first() {
        let irreversible_dr = DR_0001.replace("irreversible: false", "irreversible: true");
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/sort/decisions".into(),
            files: vec![
                ("0001-decision-request.md".into(), DR_0001.into()),
                (
                    "0002-decision-request.md".into(),
                    irreversible_dr.replace("0001", "0002"),
                ),
            ],
        }];
        let queue = derive_queue(&dirs, Some("olena"), None);
        assert!(queue[0].request.leverage_facets.irreversible);
        assert_eq!(queue[0].request.nnnn.as_deref(), Some("0002"));
    }

    #[test]
    fn parses_approvers_and_opened_at_for_irreversible_fixture() {
        let dr = parse_decision_request(
            DR_IRREVERSIBLE,
            DecisionRequestMeta {
                path: Some("x".into()),
                run_id: Some("demo-5".into()),
                nnnn: Some("0001".into()),
            },
        )
        .unwrap();
        assert_eq!(
            dr.approvers,
            Some(vec!["olena".to_string(), "vitalii".to_string()])
        );
        assert_eq!(dr.opened_at.as_deref(), Some("2026-08-01T09:00:00.000Z"));
        assert!(dr.leverage_facets.irreversible);
    }

    #[test]
    fn missing_approvers_and_opened_at_is_none_not_error() {
        let dr = parse_decision_request(DR_0001, DecisionRequestMeta::default()).unwrap();
        assert_eq!(dr.approvers, None);
        assert_eq!(dr.opened_at, None);
    }

    #[test]
    fn requires_quorum_true_for_irreversible() {
        assert!(requires_quorum(&LeverageFacets {
            irreversible: true,
            ..Default::default()
        }));
    }

    #[test]
    fn requires_quorum_false_for_reversible() {
        assert!(!requires_quorum(&LeverageFacets {
            irreversible: false,
            ..Default::default()
        }));
    }

    #[test]
    fn resolve_approvers_explicit_frontmatter_returned_as_is() {
        let dr = parse_decision_request(
            DR_IRREVERSIBLE,
            DecisionRequestMeta {
                nnnn: Some("0001".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(resolve_approvers(&dr), vec!["olena", "vitalii"]);
    }

    #[test]
    fn resolve_approvers_falls_back_to_computed_owner() {
        let dr = parse_decision_request(DR_0001, DecisionRequestMeta::default()).unwrap();
        assert_eq!(resolve_approvers(&dr), vec!["olena"]);
    }

    #[test]
    fn resolve_approvers_none_when_neither_present() {
        let dr = DecisionRequest {
            path: None,
            run_id: None,
            nnnn: None,
            mandate_generation: None,
            computed_owner: None,
            escalation_chain: vec![],
            retry_history: vec![],
            leverage_facets: LeverageFacets::default(),
            deadline_cost: None,
            recommended_by: None,
            decision_type: None,
            approvers: None,
            opened_at: None,
            context: String::new(),
            options: vec![],
            recommendation: String::new(),
        };
        assert!(resolve_approvers(&dr).is_empty());
    }

    fn irreversible_dr() -> DecisionRequest {
        parse_decision_request(
            DR_IRREVERSIBLE,
            DecisionRequestMeta {
                nnnn: Some("0001".into()),
                ..Default::default()
            },
        )
        .unwrap()
    }

    #[test]
    fn quorum_status_no_approval_files_all_pending() {
        let status = derive_quorum_status(&irreversible_dr(), &HashMap::new());
        assert_eq!(status.approvers, vec!["olena", "vitalii"]);
        assert!(status.signed.is_empty());
        assert_eq!(status.pending, vec!["olena", "vitalii"]);
        assert_eq!(status.status, QuorumState::Pending);
    }

    #[test]
    fn quorum_status_one_of_two_signed_still_pending() {
        let mut files = HashMap::new();
        files.insert(
            "0001-approval-olena.json".to_string(),
            r#"{"chosen_option":"A","signed_at":"2026-08-02T00:00:00.000Z"}"#.to_string(),
        );
        let status = derive_quorum_status(&irreversible_dr(), &files);
        assert_eq!(status.status, QuorumState::Pending);
        assert_eq!(status.pending, vec!["vitalii"]);
        assert_eq!(
            status.signed,
            vec![SignedApproval {
                handle: "olena".into(),
                chosen_option: Some("A".into()),
                signed_at: Some("2026-08-02T00:00:00.000Z".into())
            }]
        );
    }

    #[test]
    fn quorum_status_both_signed_same_option_is_closed() {
        let mut files = HashMap::new();
        files.insert(
            "0001-approval-olena.json".to_string(),
            r#"{"chosen_option":"A","signed_at":"2026-08-02T00:00:00.000Z"}"#.to_string(),
        );
        files.insert(
            "0001-approval-vitalii.json".to_string(),
            r#"{"chosen_option":"A","signed_at":"2026-08-03T00:00:00.000Z"}"#.to_string(),
        );
        let status = derive_quorum_status(&irreversible_dr(), &files);
        assert_eq!(status.status, QuorumState::Closed);
        assert!(status.pending.is_empty());
    }

    #[test]
    fn quorum_status_both_signed_different_option_is_diverged() {
        let mut files = HashMap::new();
        files.insert(
            "0001-approval-olena.json".to_string(),
            r#"{"chosen_option":"A","signed_at":"2026-08-02T00:00:00.000Z"}"#.to_string(),
        );
        files.insert(
            "0001-approval-vitalii.json".to_string(),
            r#"{"chosen_option":"B","signed_at":"2026-08-03T00:00:00.000Z"}"#.to_string(),
        );
        let status = derive_quorum_status(&irreversible_dr(), &files);
        assert_eq!(status.status, QuorumState::Diverged);
    }

    #[test]
    fn quorum_status_corrupt_approval_file_stays_pending_fail_closed() {
        let mut files = HashMap::new();
        files.insert(
            "0001-approval-olena.json".to_string(),
            "{not json".to_string(),
        );
        let status = derive_quorum_status(&irreversible_dr(), &files);
        assert!(status.pending.contains(&"olena".to_string()));
    }

    fn quorum_dirs() -> Vec<DecisionsDir> {
        vec![DecisionsDir {
            dir: "/root/runs/demo-5/decisions".into(),
            files: vec![("0001-decision-request.md".into(), DR_IRREVERSIBLE.into())],
        }]
    }

    #[test]
    fn both_approvers_see_card_while_quorum_pending() {
        assert_eq!(derive_queue(&quorum_dirs(), Some("olena"), None).len(), 1);
        assert_eq!(derive_queue(&quorum_dirs(), Some("vitalii"), None).len(), 1);
    }

    #[test]
    fn non_approver_does_not_see_card() {
        assert!(derive_queue(&quorum_dirs(), Some("fable-5"), None).is_empty());
    }

    #[test]
    fn quorum_card_depth_is_teach_back_and_awaiting_me_true() {
        let queue = derive_queue(&quorum_dirs(), Some("olena"), None);
        assert_eq!(queue[0].depth, "teach-back");
        assert_eq!(queue[0].awaiting_me, Some(true));
        assert_eq!(
            queue[0].quorum.as_ref().unwrap().status,
            QuorumState::Pending
        );
    }

    #[test]
    fn one_signed_card_stays_visible_to_both_awaiting_me_differs() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-5/decisions".into(),
            files: vec![
                ("0001-decision-request.md".into(), DR_IRREVERSIBLE.into()),
                (
                    "0001-approval-olena.json".into(),
                    r#"{"chosen_option":"A","signed_at":"2026-08-02T00:00:00.000Z"}"#.into(),
                ),
            ],
        }];
        let olena_item = &derive_queue(&dirs, Some("olena"), None)[0];
        assert_eq!(olena_item.awaiting_me, Some(false));
        assert_eq!(
            olena_item.quorum.as_ref().unwrap().status,
            QuorumState::Pending
        );
        let vitalii_item = &derive_queue(&dirs, Some("vitalii"), None)[0];
        assert_eq!(vitalii_item.awaiting_me, Some(true));
        assert_eq!(
            vitalii_item.quorum.as_ref().unwrap().status,
            QuorumState::Pending
        );
    }

    #[test]
    fn two_of_two_same_option_closes_card_for_both() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-5/decisions".into(),
            files: vec![
                ("0001-decision-request.md".into(), DR_IRREVERSIBLE.into()),
                (
                    "0001-approval-olena.json".into(),
                    r#"{"chosen_option":"A","signed_at":"2026-08-02T00:00:00.000Z"}"#.into(),
                ),
                (
                    "0001-approval-vitalii.json".into(),
                    r#"{"chosen_option":"A","signed_at":"2026-08-03T00:00:00.000Z"}"#.into(),
                ),
            ],
        }];
        assert!(derive_queue(&dirs, Some("olena"), None).is_empty());
        assert!(derive_queue(&dirs, Some("vitalii"), None).is_empty());
    }

    #[test]
    fn two_of_two_different_option_diverged_stays_visible_not_auto_resolved() {
        let dirs = vec![DecisionsDir {
            dir: "/root/runs/demo-5/decisions".into(),
            files: vec![
                ("0001-decision-request.md".into(), DR_IRREVERSIBLE.into()),
                (
                    "0001-approval-olena.json".into(),
                    r#"{"chosen_option":"A","signed_at":"2026-08-02T00:00:00.000Z"}"#.into(),
                ),
                (
                    "0001-approval-vitalii.json".into(),
                    r#"{"chosen_option":"B","signed_at":"2026-08-03T00:00:00.000Z"}"#.into(),
                ),
            ],
        }];
        let olena_item = &derive_queue(&dirs, Some("olena"), None)[0];
        let vitalii_item = &derive_queue(&dirs, Some("vitalii"), None)[0];
        assert_eq!(
            olena_item.quorum.as_ref().unwrap().status,
            QuorumState::Diverged
        );
        assert_eq!(
            vitalii_item.quorum.as_ref().unwrap().status,
            QuorumState::Diverged
        );
        assert_eq!(olena_item.awaiting_me, Some(false));
        assert_eq!(vitalii_item.awaiting_me, Some(false));
    }
}
