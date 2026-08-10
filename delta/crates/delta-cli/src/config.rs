//! Конфіг/fs-glue CLI-транспорту — той самий шлях-конвенції, що
//! `bin/delta.mjs` (Bun/node:fs) і `delta/src-tauri/src/config.rs` (Tauri):
//! `DELTA_CONFIG_PATH` override, інакше `~/Library/Application Support/
//! com.nitra.delta/config.json`; `device_key.json`/`knowledge.json`/
//! `model_keys/{handle}.json` — файли-сусіди `config.json`, поза git.

use std::fs;
use std::path::PathBuf;

use async_trait::async_trait;
use delta_core::io::{Io, KnowledgeIo};
use serde_json::{json, Value};

pub fn config_path() -> PathBuf {
    if let Some(p) = std::env::var_os("DELTA_CONFIG_PATH") {
        return PathBuf::from(p);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join("Library/Application Support/com.nitra.delta/config.json")
}

pub fn read_config() -> Value {
    fs::read_to_string(config_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!({}))
}

pub fn write_config_patch(patch: Value) -> std::io::Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut config = read_config();
    if let (Some(obj), Some(patch_obj)) = (config.as_object_mut(), patch.as_object()) {
        for (k, v) in patch_obj {
            obj.insert(k.clone(), v.clone());
        }
    }
    fs::write(path, serde_json::to_string_pretty(&config).unwrap())
}

fn sibling(name: &str) -> PathBuf {
    config_path().with_file_name(name)
}

pub fn device_key_path() -> PathBuf {
    sibling("device_key.json")
}

pub fn knowledge_path() -> PathBuf {
    sibling("knowledge.json")
}

pub fn model_key_path(handle: &str) -> PathBuf {
    sibling("model_keys").join(format!("{handle}.json"))
}

pub fn mandates_yaml_path(mandates_dir: &str) -> String {
    format!("{mandates_dir}/.mt/mandates.yaml")
}

pub fn device_registry_path(mandates_dir: &str) -> String {
    format!("{mandates_dir}/device-registry.json")
}

/// Завантажує (генерує при потребі й персистить) ключ пристрою за
/// довільним шляхом — спільний хелпер для людського `device_key.json` і
/// модельних `model_keys/{handle}.json` (`bin/delta.mjs:
/// loadDeviceKeyCli`/`loadOrCreateModelDeviceKeyCli`).
pub fn load_or_create_key_at(path: &PathBuf) -> delta_core::signing::DeviceKeypair {
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

pub fn read_llm_config() -> delta_core::quiz::LlmConfig {
    let config = read_config();
    let fallback = delta_core::quiz::default_llm_config();
    delta_core::quiz::LlmConfig {
        base_url: config
            .get("llm_base_url")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or(fallback.base_url),
        model: config
            .get("llm_model")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or(fallback.model),
    }
}

/// Скановує `<mandatesDir>/runs/{run-id}/decisions/` — та сама форма
/// `{dir, files}[]`, що `bin/delta.mjs: scanDecisionsDirs`.
pub fn scan_decisions_dirs(mandates_dir: &str) -> Vec<(String, Vec<(String, String)>)> {
    let runs_dir = PathBuf::from(mandates_dir).join("runs");
    let Ok(entries) = fs::read_dir(&runs_dir) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let decisions_dir = entry.path().join("decisions");
        let Ok(files) = fs::read_dir(&decisions_dir) else {
            continue;
        };
        let mut file_list = Vec::new();
        for f in files.flatten() {
            if f.path().is_file() {
                if let Ok(content) = fs::read_to_string(f.path()) {
                    file_list.push((f.file_name().to_string_lossy().to_string(), content));
                }
            }
        }
        result.push((decisions_dir.to_string_lossy().to_string(), file_list));
    }
    result
}

pub fn read_device_registry(
    mandates_dir: &str,
) -> Vec<delta_core::device_registry::DeviceRegistryEntry> {
    let text = fs::read_to_string(device_registry_path(mandates_dir)).ok();
    delta_core::device_registry::parse_device_registry(text.as_deref())
}

pub fn ensure_registered(
    mandates_dir: &str,
    handle: &str,
    role: delta_core::device_registry::SignerRole,
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

pub fn read_mandates_file(mandates_dir: &str) -> Result<mt_mandates::MandatesFile, String> {
    let path = mandates_yaml_path(mandates_dir);
    let text =
        fs::read_to_string(&path).map_err(|e| format!("не вдалося прочитати {path}: {e}"))?;
    mt_mandates::parse_mandates_str(&text).map_err(|e| e.to_string())
}

/// `Io`-реалізація над `std::fs` (в `spawn_blocking`, бо `Io` — async trait,
/// а `std::fs` синхронний — не блокує tokio-реактор async-стеку `reqwest`,
/// що ЦІ Ж виклики оточують у `decision_flow`/`quorum`).
pub struct FsIo;

#[async_trait]
impl Io for FsIo {
    async fn read_file(&self, path: &str) -> Option<String> {
        let path = path.to_string();
        tokio::task::spawn_blocking(move || fs::read_to_string(path).ok())
            .await
            .ok()
            .flatten()
    }

    async fn write_file(&self, path: &str, content: &str) {
        let path = path.to_string();
        let content = content.to_string();
        let _ = tokio::task::spawn_blocking(move || {
            if let Some(parent) = std::path::Path::new(&path).parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(path, content)
        })
        .await;
    }
}

pub struct FsKnowledgeIo;

#[async_trait]
impl KnowledgeIo for FsKnowledgeIo {
    async fn read(&self) -> Option<String> {
        tokio::task::spawn_blocking(|| fs::read_to_string(knowledge_path()).ok())
            .await
            .ok()
            .flatten()
    }

    async fn write(&self, content: &str) {
        let content = content.to_string();
        let _ = tokio::task::spawn_blocking(move || {
            let path = knowledge_path();
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(path, content)
        })
        .await;
    }
}
