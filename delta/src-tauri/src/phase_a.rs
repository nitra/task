//! Tauri-команди фази A — GUI-транспорт для tools, портованих у
//! `delta-core` (мандати/decisions/квіз-гейт/кворум/mandate-change/довіра).
//! Той самий інваріант, що решта `lib.rs`: Rust — тонкий транспортний шар,
//! уся логіка в `delta-core` (СПІЛЬНА з `delta-cli`, n-tool-surface).
//! Path-конвенції дзеркалять `config.rs`/`delta-cli/src/config.rs`:
//! `device_key.json`/`knowledge.json`/`model_keys/{handle}.json` — файли-
//! сусіди `config.json` (поза git); `device-registry.json` — у
//! `mandatesDir` (комітиться).

use std::fs;
use std::path::PathBuf;

use async_trait::async_trait;
use delta_core::decision_flow::Answer;
use delta_core::device_registry::SignerRole;
use delta_core::io::{Io, KnowledgeIo};
use delta_core::signing::DeviceKeypair;
use delta_core::track_record::DecisionsDirScan;
use mt_mandates::MandatesFile;
use serde_json::{json, Value};

pub(crate) fn own_config_dir() -> PathBuf {
    if let Some(p) = std::env::var_os("DELTA_CONFIG_PATH") {
        return PathBuf::from(p)
            .parent()
            .map(PathBuf::from)
            .unwrap_or_default();
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join("Library/Application Support/com.nitra.delta")
}

pub(crate) fn device_key_path() -> PathBuf {
    own_config_dir().join("device_key.json")
}

pub(crate) fn model_key_path(handle: &str) -> PathBuf {
    own_config_dir()
        .join("model_keys")
        .join(format!("{handle}.json"))
}

pub(crate) fn mandates_yaml_path(mandates_dir: &str) -> String {
    format!("{mandates_dir}/.mt/mandates.yaml")
}

pub(crate) fn device_registry_path(mandates_dir: &str) -> String {
    format!("{mandates_dir}/device-registry.json")
}

pub(crate) fn load_or_create_key_at(path: &PathBuf) -> DeviceKeypair {
    let existing = fs::read_to_string(path).ok();
    let key = delta_core::signing::load_or_create_device_key(existing.as_deref());
    if key.created {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(path, serde_json::to_string(&key.keypair).unwrap());
    }
    key.keypair
}

/// Re-export спільної (з `delta-cli::config`) `std::fs`-реалізації — раніше
/// тут була 1:1 копія `scan_decisions_dirs`/`FsIo`, винесена в `delta-fs-io`
/// (jscpd duplicate-clone).
pub(crate) use delta_fs_io::{scan_decisions_dirs, FsIo};

pub(crate) fn build_dir_scans(
    raw: &[(String, Vec<(String, String)>)],
) -> Vec<DecisionsDirScan<'_>> {
    raw.iter()
        .map(|(dir, files)| DecisionsDirScan { dir, files })
        .collect()
}

pub(crate) fn read_device_registry(
    mandates_dir: &str,
) -> Vec<delta_core::device_registry::DeviceRegistryEntry> {
    let text = fs::read_to_string(device_registry_path(mandates_dir)).ok();
    delta_core::device_registry::parse_device_registry(text.as_deref())
}

pub(crate) fn ensure_registered(
    mandates_dir: &str,
    handle: &str,
    role: SignerRole,
    pubkey_base64: &str,
) {
    let entries = read_device_registry(mandates_dir);
    let updated = delta_core::device_registry::upsert_device(
        &entries,
        handle,
        role,
        pubkey_base64,
        chrono::Utc::now(),
    );
    let path = device_registry_path(mandates_dir);
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(
        path,
        delta_core::device_registry::format_device_registry(&updated),
    );
}

/// Файл відсутній — доброзичливий empty state (M0-інваріант); файл ІСНУЄ,
/// але структурно невалідний — пропагує помилку `mt_mandates`.
pub(crate) fn read_mandates_file_or_empty(mandates_dir: &str) -> Result<MandatesFile, String> {
    let path = mandates_yaml_path(mandates_dir);
    if !std::path::Path::new(&path).exists() {
        return Ok(MandatesFile {
            generation: 1,
            mandates: Vec::new(),
        });
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    mt_mandates::parse_mandates_str(&text).map_err(|e| e.to_string())
}

pub(crate) struct FsKnowledgeIo;

#[async_trait]
impl KnowledgeIo for FsKnowledgeIo {
    async fn read(&self) -> Option<String> {
        let path = own_config_dir().join("knowledge.json");
        tokio::task::spawn_blocking(move || fs::read_to_string(path).ok())
            .await
            .ok()
            .flatten()
    }

    async fn write(&self, content: &str) {
        let content = content.to_string();
        let _ = tokio::task::spawn_blocking(move || {
            let path = own_config_dir().join("knowledge.json");
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(path, content)
        })
        .await;
    }
}

pub(crate) fn read_llm_config() -> delta_core::quiz::LlmConfig {
    let (base_url, model) = crate::config::get_llm_config();
    let fallback = delta_core::quiz::default_llm_config();
    delta_core::quiz::LlmConfig {
        base_url: base_url.unwrap_or(fallback.base_url),
        model: model.unwrap_or(fallback.model),
    }
}

fn answer_from_json(answer: Option<Value>) -> Option<AnswerOwned> {
    let v = answer?;
    if let Some(n) = v.as_i64() {
        Some(AnswerOwned::Index(n))
    } else {
        v.as_str().map(|s| AnswerOwned::Text(s.to_string()))
    }
}

enum AnswerOwned {
    Index(i64),
    Text(String),
}

impl AnswerOwned {
    fn as_answer(&self) -> Answer<'_> {
        match self {
            AnswerOwned::Index(n) => Answer::Index(*n),
            AnswerOwned::Text(s) => Answer::Text(s),
        }
    }
}

#[tauri::command]
pub fn mandates_show(mandates_dir: String, handle: Option<String>) -> Result<Value, String> {
    let file = read_mandates_file_or_empty(&mandates_dir)?;
    let view = delta_core::mandates::derive_mandates_view(&file.mandates, handle.as_deref());
    Ok(delta_core::mandates::mandates_view_to_json(&view))
}

#[tauri::command]
pub fn decisions_show(mandates_dir: String, handle: Option<String>) -> Value {
    let raw = scan_decisions_dirs(&mandates_dir);
    let dirs: Vec<delta_core::decisions::DecisionsDir> = raw
        .into_iter()
        .map(|(dir, files)| delta_core::decisions::DecisionsDir { dir, files })
        .collect();
    let queue = delta_core::decisions::derive_queue(&dirs, handle.as_deref(), None);
    Value::Array(
        queue
            .iter()
            .map(delta_core::decisions::queue_item_to_json)
            .collect(),
    )
}

/// Крок гейт-незалежного «на виріст» (п.2(г), delta_core::profiles module
/// doc) — best-effort: якщо `domain` результату — заявлена зона росту
/// computed_owner-а розвилки, вставляє окреме поле `growthEdge` у відповідь
/// ПІСЛЯ звичайного квіз-гейта (ніколи не входить у квіз-файл/questions[]).
async fn attach_growth_edge(
    mandates_dir: &str,
    decisions_dir: &str,
    nnnn: &str,
    result: &mut Value,
) {
    let Some(domain) = result
        .as_object()
        .and_then(|o| o.get("domain"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
    else {
        return;
    };
    let dr_path = format!("{decisions_dir}/{nnnn}-decision-request.md");
    let Some(dr_text) = Io::read_file(&FsIo, &dr_path).await else {
        return;
    };
    let Ok(dr) = delta_core::decisions::parse_decision_request(
        &dr_text,
        delta_core::decisions::DecisionRequestMeta::default(),
    ) else {
        return;
    };
    let Some(owner) = dr.computed_owner.clone() else {
        return;
    };
    let profile_path = delta_core::profiles::profile_path(mandates_dir, &owner);
    let profile_text = Io::read_file(&FsIo, &profile_path).await;
    let growth_edge = delta_core::profiles::parse_growth_edge_profile(profile_text.as_deref());
    if let Some(field) = delta_core::profiles::build_growth_edge_field(&growth_edge, &domain, &dr) {
        if let Some(obj) = result.as_object_mut() {
            obj.insert("growthEdge".to_string(), field);
        }
    }
}

#[tauri::command]
pub async fn decision_quiz(
    mandates_dir: String,
    run_id: String,
    nnnn: String,
    chosen_option: String,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let llm_config = read_llm_config();
    let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
    let mut result = delta_core::decision_flow::decision_quiz(
        &FsIo,
        &client,
        &llm_config,
        &decisions_dir,
        &nnnn,
        &chosen_option,
        Some(&FsKnowledgeIo),
        None,
    )
    .await?;
    attach_growth_edge(&mandates_dir, &decisions_dir, &nnnn, &mut result).await;
    Ok(result)
}

#[tauri::command]
pub async fn profile_show(mandates_dir: String, handle: String) -> Result<Value, String> {
    let path = delta_core::profiles::profile_path(&mandates_dir, &handle);
    let text = Io::read_file(&FsIo, &path).await;
    let growth_edge = delta_core::profiles::parse_growth_edge_profile(text.as_deref());
    Ok(json!({"handle": handle, "growthEdge": growth_edge}))
}

#[tauri::command]
pub async fn profile_set_growth_edge(
    mandates_dir: String,
    handle: String,
    growth_edge: Vec<String>,
) -> Result<Value, String> {
    let path = delta_core::profiles::profile_path(&mandates_dir, &handle);
    Io::write_file(
        &FsIo,
        &path,
        &delta_core::profiles::format_growth_edge_profile(&growth_edge),
    )
    .await;
    Ok(json!({"handle": handle, "growthEdge": growth_edge}))
}

#[tauri::command]
pub async fn decision_approve(
    mandates_dir: String,
    run_id: String,
    nnnn: String,
    chosen_option: String,
    answer: Option<Value>,
    transcript: Option<String>,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let llm_config = read_llm_config();
    let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
    let device_key = load_or_create_key_at(&device_key_path());
    let answer_owned = answer_from_json(answer);
    let answer_ref = answer_owned.as_ref().map(|a| a.as_answer());
    delta_core::decision_flow::decision_approve(
        &FsIo,
        &client,
        &llm_config,
        &decisions_dir,
        &run_id,
        &nnnn,
        &chosen_option,
        answer_ref,
        transcript.as_deref(),
        &device_key,
        Some(&FsKnowledgeIo),
        None,
    )
    .await
}

#[tauri::command]
pub fn device_pubkey() -> Value {
    let device_key = load_or_create_key_at(&device_key_path());
    json!({"publicKeyBase64": device_key.public_key_base64})
}

#[tauri::command]
pub fn trust_show(mandates_dir: String, handle: Option<String>) -> Result<Value, String> {
    let file = read_mandates_file_or_empty(&mandates_dir)?;
    let registry = read_device_registry(&mandates_dir);
    let raw = scan_decisions_dirs(&mandates_dir);
    let dirs = build_dir_scans(&raw);
    Ok(delta_core::trust::derive_trust_view(
        &file,
        &registry,
        &dirs,
        handle.as_deref(),
    ))
}

#[tauri::command]
pub async fn mandate_narrow(mandates_dir: String, owner_handle: String) -> Result<Value, String> {
    let old = read_mandates_file_or_empty(&mandates_dir)?;
    let mandate = old
        .mandates
        .iter()
        .find(|m| m.owner == owner_handle)
        .ok_or_else(|| {
            format!("mandate_narrow: owner '{owner_handle}' не знайдено в mandates.yaml")
        })?;
    let role = if mandate.kind == mt_mandates::MandateKind::Model {
        SignerRole::Model
    } else {
        SignerRole::Human
    };
    let new_file = delta_core::trust::with_mandate_replaced(
        &old,
        &owner_handle,
        delta_core::trust::narrow_mandate_one_step,
    );
    let device_key = if role == SignerRole::Model {
        load_or_create_key_at(&model_key_path(&owner_handle))
    } else {
        load_or_create_key_at(&device_key_path())
    };
    ensure_registered(
        &mandates_dir,
        &owner_handle,
        role,
        &device_key.public_key_base64,
    );
    Ok(delta_core::change_proposal::apply_mandate_narrow(
        &FsIo,
        &mandates_yaml_path(&mandates_dir),
        &old,
        &new_file,
        &owner_handle,
        role,
        &device_key,
    )
    .await)
}

#[tauri::command]
pub async fn mandate_widen_propose(
    mandates_dir: String,
    owner_handle: String,
    initiated_by_handle: String,
    change_id: Option<String>,
) -> Result<Value, String> {
    let old = read_mandates_file_or_empty(&mandates_dir)?;
    let mandate = old
        .mandates
        .iter()
        .find(|m| m.owner == owner_handle)
        .ok_or_else(|| {
            format!("mandate_widen_propose: owner '{owner_handle}' не знайдено в mandates.yaml")
        })?;
    let delegator = mandate.escalates_to.clone().ok_or_else(|| format!("mandate_widen_propose: '{owner_handle}' — кореневий мандат, немає делегатора для підпису"))?;
    let new_file = delta_core::trust::with_mandate_replaced(
        &old,
        &owner_handle,
        delta_core::trust::widen_mandate_one_step,
    );
    let change_id =
        change_id.unwrap_or_else(|| format!("mc-{}", chrono::Utc::now().timestamp_millis()));
    let reason = format!("{initiated_by_handle} пропонує розширити мандат '{owner_handle}' на один щабель (audacity/budget_eur).");
    let written = delta_core::change_proposal::write_change_proposal(
        &FsIo,
        &mandates_dir,
        &change_id,
        &old,
        &new_file,
        &owner_handle,
        &delegator,
        &initiated_by_handle,
        &reason,
        None,
    )
    .await;
    Ok(
        json!({"changeId": change_id, "delegatorHandle": delegator, "decisionRequestPath": written.decision_request_path, "changeJsonPath": written.change_json_path}),
    )
}

#[tauri::command]
pub async fn ai_petition(
    mandates_dir: String,
    model_handle: String,
    change_id: Option<String>,
) -> Result<Value, String> {
    let old = read_mandates_file_or_empty(&mandates_dir)?;
    let mandate = old
        .mandates
        .iter()
        .find(|m| m.owner == model_handle)
        .ok_or_else(|| {
            format!("ai_petition: model '{model_handle}' не знайдено в mandates.yaml")
        })?;
    if mandate.kind != mt_mandates::MandateKind::Model {
        return Err(format!(
            "ai_petition: owner '{model_handle}' не kind: model"
        ));
    }
    let delegator = mandate.escalates_to.clone().ok_or_else(|| {
        format!("ai_petition: '{model_handle}' — кореневий мандат, немає делегатора для петиції")
    })?;
    let new_file = delta_core::trust::with_mandate_replaced(
        &old,
        &model_handle,
        delta_core::trust::widen_mandate_one_step,
    );
    let change_id =
        change_id.unwrap_or_else(|| format!("mc-{}", chrono::Utc::now().timestamp_millis()));
    let raw = scan_decisions_dirs(&mandates_dir);
    let dirs = build_dir_scans(&raw);
    let registry = read_device_registry(&mandates_dir);
    let track =
        delta_core::track_record::derive_track_record(&dirs, &registry, &model_handle, None);
    let model_key = load_or_create_key_at(&model_key_path(&model_handle));
    ensure_registered(
        &mandates_dir,
        &model_handle,
        SignerRole::Model,
        &model_key.public_key_base64,
    );
    let result = delta_core::ai_petition::ai_petition(
        &FsIo,
        &mandates_dir,
        &change_id,
        &old,
        &new_file,
        &model_handle,
        &delegator,
        &track,
        &model_key,
        None,
    )
    .await
    .ok_or("ai_petition: ключ пристрою моделі несумісний з ed25519-dalek")?;
    Ok(json!({
        "changeId": change_id, "delegatorHandle": delegator,
        "petitionPath": result.petition_path,
        "decisionRequestPath": result.written.decision_request_path,
        "changeJsonPath": result.written.change_json_path,
        "evidenceText": result.evidence_text,
        "petition": result.petition,
    }))
}

/// Симуляція на історії (конституція п.12, `delta_core::simulation` module
/// doc) — детермінований прогноз перед підписом; матчить лише вісь
/// `decision_types` (свідома межа обсягу, `refs` немає в decision-request
/// мок-схемі).
#[tauri::command]
pub fn simulate_mandate_scope(
    mandates_dir: String,
    decision_types: Vec<String>,
    exclude_decision_types: Option<Vec<String>>,
    period_days: Option<i64>,
) -> Value {
    let raw = scan_decisions_dirs(&mandates_dir);
    let dirs: Vec<delta_core::decisions::DecisionsDir> = raw
        .into_iter()
        .map(|(dir, files)| delta_core::decisions::DecisionsDir { dir, files })
        .collect();
    let scope = mt_mandates::Scope {
        refs: vec!["refs/mt/**".into()],
        decision_types,
    };
    let exclude_scope = exclude_decision_types.map(|decision_types| mt_mandates::Scope {
        refs: vec!["refs/mt/**".into()],
        decision_types,
    });
    let result = delta_core::simulation::simulate_scope(
        &dirs,
        &scope,
        exclude_scope.as_ref(),
        period_days.unwrap_or(90),
        chrono::Utc::now(),
    );
    delta_core::simulation::simulation_to_json(&result)
}

#[tauri::command]
pub async fn mandate_change_apply(
    mandates_dir: String,
    change_id: String,
    handle: String,
    role: Option<String>,
) -> Result<Value, String> {
    let role = if role.as_deref() == Some("model") {
        SignerRole::Model
    } else {
        SignerRole::Human
    };
    let (old, new_file) =
        delta_core::change_proposal::read_change_proposal(&FsIo, &mandates_dir, &change_id)
            .await
            .ok_or_else(|| {
                format!("mandate_change_apply: change-proposal '{change_id}' не знайдено")
            })?;
    let decisions_dir =
        delta_core::change_proposal::change_proposal_decisions_dir(&mandates_dir, &change_id);
    let approval_path = format!("{decisions_dir}/0001-approval.json");
    let approval_text = Io::read_file(&FsIo, &approval_path).await.ok_or_else(|| {
        format!(
            "mandate_change_apply: decision-request change-proposal '{change_id}' ще не підписано (немає 0001-approval.json) — спершу пройди decision_quiz/decision_approve з runId '{}'",
            delta_core::change_proposal::change_proposal_run_id(&change_id)
        )
    })?;
    let approval: Value = serde_json::from_str(&approval_text).map_err(|e| e.to_string())?;
    let device_key = if role == SignerRole::Model {
        load_or_create_key_at(&model_key_path(&handle))
    } else {
        load_or_create_key_at(&device_key_path())
    };
    ensure_registered(&mandates_dir, &handle, role, &device_key.public_key_base64);
    let applied_marker = format!("{decisions_dir}/0001-applied.json");
    Ok(delta_core::change_proposal::apply_mandate_change_proposal(
        &FsIo,
        &mandates_yaml_path(&mandates_dir),
        &old,
        &new_file,
        &approval,
        &handle,
        role,
        &device_key,
        vec![],
        Some(&applied_marker),
        None,
    )
    .await)
}

// Онбординг = перший мандат (конституція п.10, `delta_core::onboarding`
// module doc). Кроки (а)/(б) — `mandate_request_propose` (тим самим
// `ChangeKind::Added`-шляхом, що розширення ШІ-мандата); крок (в) —
// наявні `decision_quiz`/`decision_approve`/`mandate_change_apply` вище,
// жодного нового tool-а не потрібно; крок (г) — `entry_quiz_start`/
// `entry_quiz_submit`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn mandate_request_propose(
    mandates_dir: String,
    handle: String,
    delegator_handle: String,
    initiated_by_handle: Option<String>,
    kind: Option<String>,
    refs: Vec<String>,
    decision_types: Vec<String>,
    change_id: Option<String>,
    reason: Option<String>,
) -> Result<Value, String> {
    let old = read_mandates_file_or_empty(&mandates_dir)?;
    let mandate_kind = match kind.as_deref() {
        Some("model") => mt_mandates::MandateKind::Model,
        _ => mt_mandates::MandateKind::Person,
    };
    let scope = mt_mandates::Scope {
        refs,
        decision_types,
    };
    let new_file = delta_core::onboarding::build_onboarding_mandate_file(
        &old,
        &handle,
        &delegator_handle,
        mandate_kind,
        scope,
    )?;
    let change_id =
        change_id.unwrap_or_else(|| delta_core::onboarding::onboarding_change_id(&handle));
    let initiated_by = initiated_by_handle.unwrap_or_else(|| handle.clone());
    let reason = reason.unwrap_or_else(|| {
        format!(
            "Онбординг: '{handle}' запросив(ла) перший мандат під делегатором '{delegator_handle}' (докладніше: docs/specs/260809-delta-app.md, конституція п.10)."
        )
    });
    let written = delta_core::change_proposal::write_change_proposal(
        &FsIo,
        &mandates_dir,
        &change_id,
        &old,
        &new_file,
        &handle,
        &delegator_handle,
        &initiated_by,
        &reason,
        None,
    )
    .await;
    Ok(json!({
        "changeId": change_id,
        "runId": delta_core::change_proposal::change_proposal_run_id(&change_id),
        "delegatorHandle": delegator_handle,
        "decisionRequestPath": written.decision_request_path,
        "changeJsonPath": written.change_json_path,
    }))
}

#[tauri::command]
pub async fn onboarding_status(mandates_dir: String, handle: String) -> Result<Value, String> {
    let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
    let needs_onboarding = delta_core::onboarding::needs_onboarding(&mandates_file, &handle);
    let entry_quiz_complete =
        delta_core::onboarding::entry_quiz_completed(&FsIo, &mandates_dir, &handle).await;
    Ok(json!({
        "needsOnboarding": needs_onboarding,
        "entryQuizComplete": entry_quiz_complete,
        "onboardingComplete": !needs_onboarding && entry_quiz_complete,
    }))
}

#[tauri::command]
pub async fn entry_quiz_start(mandates_dir: String, handle: String) -> Result<Value, String> {
    let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
    let mandate = mandates_file
        .mandates
        .iter()
        .find(|m| m.owner == handle)
        .ok_or_else(|| format!("entry_quiz_start: '{handle}' ще не має мандата в mandates.yaml — спершу mandate_request_propose → decision_quiz/decision_approve делегатора → mandate_change_apply"))?;
    Ok(delta_core::onboarding::entry_quiz_start(
        &FsIo,
        &mandates_dir,
        &handle,
        mandate,
        mandates_file.generation,
        None,
    )
    .await)
}

#[tauri::command]
pub async fn entry_quiz_submit(
    mandates_dir: String,
    handle: String,
    answers: Vec<i64>,
) -> Result<Value, String> {
    delta_core::onboarding::entry_quiz_submit(&FsIo, &mandates_dir, &handle, &answers, None).await
}

#[tauri::command]
pub async fn quorum_quiz(
    mandates_dir: String,
    run_id: String,
    nnnn: String,
    signer_handle: String,
) -> Result<Value, String> {
    let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
    delta_core::quorum::quorum_quiz(&FsIo, &decisions_dir, &nnnn, &signer_handle, None).await
}

#[tauri::command]
pub async fn quorum_approve(
    mandates_dir: String,
    run_id: String,
    nnnn: String,
    signer_handle: String,
    chosen_option: String,
    transcript: String,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let llm_config = read_llm_config();
    let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
    let device_key = load_or_create_key_at(&device_key_path());
    delta_core::quorum::quorum_approve(
        &FsIo,
        &client,
        &llm_config,
        &decisions_dir,
        &run_id,
        &nnnn,
        &signer_handle,
        &chosen_option,
        &transcript,
        &device_key,
        None,
    )
    .await
}

#[tauri::command]
pub async fn quorum_status(
    mandates_dir: String,
    run_id: String,
    nnnn: String,
) -> Result<Value, String> {
    let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
    delta_core::quorum::load_quorum_status(&FsIo, &decisions_dir, &nnnn).await
}
