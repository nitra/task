//! Tauri-команди фази B — GUI-транспорт для решти tools, портованих у
//! `delta-core` (knowledge/directory/watcher/what-system-knows/staff/
//! candor/drift/delegation/report/kill-switch/review). Той самий
//! інваріант, що `phase_a.rs`: Rust — тонкий транспортний шар, уся логіка
//! в `delta-core` (СПІЛЬНА з `delta-cli`, n-tool-surface); шляхи/io
//! перевикористовують `phase_a`-хелпери (`own_config_dir`/`FsIo`/
//! `FsKnowledgeIo`/`load_or_create_key_at`/...).

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

use async_trait::async_trait;
use delta_core::decision_flow::Answer;
use delta_core::decisions::DecisionRequestMeta;
use delta_core::device_registry::SignerRole;
use delta_core::io::{Io, KnowledgeIo};
use serde_json::{json, Value};

/// Індекс (0-based) чи текст обраної відповіді квізу/делегування — той
/// самий контракт, що `phase_a::answer_from_json` (окрема копія, той самий
/// підхід, що `delta-cli`/`phase_a.rs`: кожен транспорт тримає власний
/// маленький json→domain хелпер, не ділиться приватними типами).
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

fn answer_from_json(answer: Option<Value>) -> Option<AnswerOwned> {
    let v = answer?;
    if let Some(n) = v.as_i64() {
        Some(AnswerOwned::Index(n))
    } else {
        v.as_str().map(|s| AnswerOwned::Text(s.to_string()))
    }
}

use crate::phase_a::{
    device_key_path, ensure_registered, load_or_create_key_at, model_key_path, own_config_dir,
    read_device_registry, read_llm_config, read_mandates_file_or_empty, scan_decisions_dirs, FsIo,
    FsKnowledgeIo,
};

fn drift_path() -> PathBuf {
    own_config_dir().join("drift.json")
}

fn candor_read_marks_path() -> PathBuf {
    own_config_dir().join("candor_read.json")
}

fn directory_path(mandates_dir: &str) -> String {
    format!("{mandates_dir}/.mt/directory.json")
}

/// Загальна `KnowledgeIo`-реалізація над довільним файлом-сусідом
/// `config.json` — параметризований шляхом (drift.json/candor_read.json).
struct SiblingFileIo(PathBuf);

#[async_trait]
impl KnowledgeIo for SiblingFileIo {
    async fn read(&self) -> Option<String> {
        let path = self.0.clone();
        tokio::task::spawn_blocking(move || fs::read_to_string(path).ok())
            .await
            .ok()
            .flatten()
    }

    async fn write(&self, content: &str) {
        let path = self.0.clone();
        let content = content.to_string();
        let _ = tokio::task::spawn_blocking(move || {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(path, content)
        })
        .await;
    }
}

fn read_quiet_hours_config() -> Option<delta_core::watcher::QuietHours> {
    let (start, end) = crate::config::get_quiet_hours();
    match (start, end) {
        (Some(start), Some(end)) => Some(delta_core::watcher::QuietHours { start, end }),
        _ => None,
    }
}

fn scanned_dirs(mandates_dir: &str) -> Vec<delta_core::decisions::DecisionsDir> {
    scan_decisions_dirs(mandates_dir)
        .into_iter()
        .map(|(dir, files)| delta_core::decisions::DecisionsDir { dir, files })
        .collect()
}

#[tauri::command]
pub async fn knowledge_show() -> Value {
    let text = FsKnowledgeIo.read().await;
    let entries = delta_core::knowledge::parse_knowledge_file(text.as_deref());
    let digest = delta_core::knowledge::domain_digest(&entries);
    let trend = delta_core::knowledge::time_to_understanding_trend(&entries);
    json!({"digest": digest, "trend": trend, "entryCount": entries.len()})
}

#[tauri::command]
pub async fn directory_show(mandates_dir: String) -> Value {
    let text = Io::read_file(&FsIo, &directory_path(&mandates_dir)).await;
    let directory = delta_core::directory::parse_directory(text.as_deref());
    serde_json::to_value(&directory).unwrap()
}

#[tauri::command]
pub async fn directory_set(
    mandates_dir: String,
    handle: String,
    name: Option<String>,
    email: Option<String>,
    lang: Option<String>,
) -> Value {
    let path = directory_path(&mandates_dir);
    let text = Io::read_file(&FsIo, &path).await;
    let directory = delta_core::directory::parse_directory(text.as_deref());
    let patch = delta_core::directory::DirectoryPatch { name, email, lang };
    let updated = delta_core::directory::set_directory_entry(&directory, &handle, patch);
    Io::write_file(
        &FsIo,
        &path,
        &delta_core::directory::format_directory(&updated),
    )
    .await;
    serde_json::to_value(&updated[&handle]).unwrap()
}

#[tauri::command]
pub async fn watcher_scan(mandates_dir: String, config: Option<Value>) -> Value {
    let mandates_file =
        read_mandates_file_or_empty(&mandates_dir).unwrap_or(mt_mandates::MandatesFile {
            generation: 1,
            mandates: Vec::new(),
        });
    let kill_switch_ctx = delta_core::kill_switch::build_kill_switch_redirect(
        &FsIo,
        &mandates_dir,
        &mandates_file.mandates,
    )
    .await;
    let dirs = scanned_dirs(&mandates_dir);
    let watcher_config = config.and_then(|v| {
        Some(delta_core::watcher::WatcherConfig {
            sla_hours: v.get("slaHours")?.as_f64()?,
            grace_hours: v.get("graceHours")?.as_f64()?,
        })
    });
    let suppressed: HashSet<String> = kill_switch_ctx.redirect.keys().cloned().collect();
    delta_core::watcher::run_watcher_scan(
        &FsIo,
        &mandates_dir,
        &dirs,
        watcher_config,
        read_quiet_hours_config().as_ref(),
        Some(&suppressed),
        chrono::Utc::now(),
        chrono::Local::now(),
    )
    .await
}

#[tauri::command]
pub async fn notifications_show(mandates_dir: String, handle: String) -> Value {
    let path = delta_core::watcher::notifications_log_path(&mandates_dir, &handle);
    let text = Io::read_file(&FsIo, &path).await;
    Value::Array(delta_core::watcher::parse_notifications_log(
        text.as_deref(),
    ))
}

#[tauri::command]
pub fn get_quiet_hours() -> Value {
    match read_quiet_hours_config() {
        Some(qh) => json!({"start": qh.start, "end": qh.end}),
        None => Value::Null,
    }
}

#[tauri::command]
pub fn set_quiet_hours(start: String, end: String) -> Result<(), String> {
    crate::config::set_quiet_hours(start.trim().to_string(), end.trim().to_string())
}

#[tauri::command]
pub async fn what_system_knows(mandates_dir: String, handle: Option<String>) -> Value {
    let text = FsKnowledgeIo.read().await;
    let knowledge_entries = delta_core::knowledge::parse_knowledge_file(text.as_deref());
    let notifications = match &handle {
        Some(h) => {
            let path = delta_core::watcher::notifications_log_path(&mandates_dir, h);
            let text = Io::read_file(&FsIo, &path).await;
            delta_core::watcher::parse_notifications_log(text.as_deref())
        }
        None => Vec::new(),
    };
    let device_registry = read_device_registry(&mandates_dir);
    delta_core::what_system_knows::build_what_system_knows(
        handle.as_deref(),
        &knowledge_entries,
        &notifications,
        &device_registry,
    )
}

#[tauri::command]
pub async fn decision_brief(
    mandates_dir: String,
    run_id: String,
    nnnn: String,
) -> Result<Value, String> {
    let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
    let path = format!("{decisions_dir}/{nnnn}-decision-request.md");
    let text = Io::read_file(&FsIo, &path)
        .await
        .ok_or_else(|| format!("decision_brief: decision-request не знайдено: {nnnn}"))?;
    let dr = delta_core::decisions::parse_decision_request(
        &text,
        DecisionRequestMeta {
            nnnn: Some(nnnn.clone()),
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?;
    let llm_config = read_llm_config();
    let staff_llm_config = delta_core::staff::StaffLlmConfig {
        base_url: llm_config.base_url,
        model: llm_config.model,
    };
    let client = reqwest::Client::new();
    let (brief, compressed) =
        delta_core::staff::decision_brief(&client, &staff_llm_config, &dr).await;
    let mut value = serde_json::to_value(&brief).unwrap();
    value["compressed"] = json!(compressed);
    Ok(value)
}

#[tauri::command]
pub async fn ai_candor(
    mandates_dir: String,
    to_handle: String,
    from_model_handle: String,
    statement: String,
    audacity_level: String,
    evidence_refs: Option<Vec<String>>,
) -> Result<Value, String> {
    let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
    delta_core::candor::ai_candor(
        &FsIo,
        &mandates_dir,
        &to_handle,
        &from_model_handle,
        &statement,
        &evidence_refs.unwrap_or_default(),
        &audacity_level,
        &mandates_file,
        None,
    )
    .await
}

#[tauri::command]
pub async fn candor_show(mandates_dir: String, handle: String) -> Value {
    let read_marks_io = SiblingFileIo(candor_read_marks_path());
    Value::Array(
        delta_core::candor::candor_show(&FsIo, &mandates_dir, &handle, Some(&read_marks_io)).await,
    )
}

#[tauri::command]
pub async fn candor_mark_read(id: String) {
    let read_marks_io = SiblingFileIo(candor_read_marks_path());
    delta_core::candor::mark_candor_read(&read_marks_io, &id).await;
}

#[tauri::command]
pub async fn drift_scan(mandates_dir: String, handle: Option<String>) -> Value {
    let dirs = scanned_dirs(&mandates_dir);
    let drift_io = SiblingFileIo(drift_path());
    let cards = delta_core::drift::run_drift_scan(
        &dirs,
        handle.as_deref(),
        Some(&drift_io),
        None,
        chrono::Utc::now(),
    )
    .await;
    serde_json::to_value(&cards).unwrap()
}

#[tauri::command]
pub async fn drift_show() -> Value {
    let drift_io = SiblingFileIo(drift_path());
    let cards = delta_core::drift::load_drift_cards(Some(&drift_io)).await;
    serde_json::to_value(&cards).unwrap()
}

#[tauri::command]
pub async fn delegation_quiz(
    mandates_dir: String,
    run_id: String,
    nnnn: String,
    model_handle: String,
) -> Result<Value, String> {
    let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
    let path = format!("{decisions_dir}/{nnnn}-decision-request.md");
    let text = Io::read_file(&FsIo, &path)
        .await
        .ok_or_else(|| format!("delegation_quiz: decision-request не знайдено: {nnnn}"))?;
    delta_core::delegation::delegation_quiz(
        &FsIo,
        &decisions_dir,
        &nnnn,
        &model_handle,
        &text,
        None,
    )
    .await
}

#[tauri::command]
pub async fn decision_delegate(
    mandates_dir: String,
    run_id: String,
    nnnn: String,
    model_handle: String,
    delegated_by_handle: String,
    answer: Option<Value>,
) -> Result<Value, String> {
    let answer_owned = answer_from_json(answer);
    let answer_ref = answer_owned
        .as_ref()
        .map(AnswerOwned::as_answer)
        .ok_or_else(|| "decision_delegate: Missing required field: answer".to_string())?;
    let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
    let device_key = load_or_create_key_at(&device_key_path());
    delta_core::delegation::delegate_decision(
        &FsIo,
        &decisions_dir,
        &run_id,
        &nnnn,
        &model_handle,
        &delegated_by_handle,
        answer_ref,
        &device_key,
        None,
    )
    .await
}

#[tauri::command]
pub async fn delta_report(mandates_dir: String, period_days: Option<i64>) -> Result<Value, String> {
    let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
    let dirs = scanned_dirs(&mandates_dir);
    let output = delta_core::report::delta_report(
        &FsIo,
        &mandates_dir,
        &mandates_file,
        &dirs,
        period_days.unwrap_or(7),
        None,
    )
    .await?;
    Ok(serde_json::to_value(&output).unwrap())
}

#[tauri::command]
pub async fn kill_switch_on(mandates_dir: String, handle: String) -> Value {
    let device_key = load_or_create_key_at(&device_key_path());
    delta_core::kill_switch::kill_switch_on(&FsIo, &mandates_dir, &handle, &device_key, None).await
}

#[tauri::command]
pub async fn kill_switch_off(mandates_dir: String, handle: String) -> Value {
    let device_key = load_or_create_key_at(&device_key_path());
    delta_core::kill_switch::kill_switch_off(&FsIo, &mandates_dir, &handle, &device_key, None).await
}

#[tauri::command]
pub async fn kill_switch_status(mandates_dir: String, handle: String) -> Value {
    delta_core::kill_switch::kill_switch_status(&FsIo, &mandates_dir, &handle).await
}

/// `ModelDeviceKeyLoader`/`DeviceRegistrar` — GUI-транспорт: той самий
/// каталог, що людський `device_key.json` (`tool/index.js:
/// loadOrCreateModelDeviceKeyGui`/`ensureRegisteredGui`).
struct GuiModelDeviceKeyLoader;

#[async_trait]
impl delta_core::review::ModelDeviceKeyLoader for GuiModelDeviceKeyLoader {
    async fn load_model_device_key(&self, handle: &str) -> delta_core::signing::DeviceKeypair {
        load_or_create_key_at(&model_key_path(handle))
    }
}

struct GuiDeviceRegistrar {
    mandates_dir: String,
}

#[async_trait]
impl delta_core::review::DeviceRegistrar for GuiDeviceRegistrar {
    async fn register_device(&self, handle: &str, role: SignerRole, pubkey_base64: &str) {
        ensure_registered(&self.mandates_dir, handle, role, pubkey_base64);
    }
}

#[tauri::command]
pub async fn review_agenda(
    mandates_dir: String,
    period_days: Option<i64>,
) -> Result<Value, String> {
    let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
    let kill_switch_ctx = delta_core::kill_switch::build_kill_switch_redirect(
        &FsIo,
        &mandates_dir,
        &mandates_file.mandates,
    )
    .await;
    let dirs = scanned_dirs(&mandates_dir);
    let device_registry = read_device_registry(&mandates_dir);
    let loader = GuiModelDeviceKeyLoader;
    let registrar = GuiDeviceRegistrar {
        mandates_dir: mandates_dir.clone(),
    };
    let output = delta_core::review::review_agenda(
        &FsIo,
        &mandates_dir,
        &mandates_file,
        &dirs,
        &device_registry,
        &kill_switch_ctx.active_handles,
        &loader,
        Some(&registrar),
        period_days.unwrap_or(7),
        None,
        None,
    )
    .await?;
    Ok(serde_json::to_value(&output).unwrap())
}
