//! Конфіг delta-застосунку — ідентичність користувача і шлях до воркспейсу
//! з `.mt/mandates.yaml`.
//!
//! Зберігається у `appLocalDataDir/config.json`
//! (`{ "identity": "handle", "mandates_dir": "/abs/path" }`). Той самий
//! патерн, що owner/src-tauri/src/config.rs (identity — handle, PII поза
//! git); `mandates_dir` — власний ключ delta (owner для порівняння сканує
//! кілька `project_paths`, delta M0 читає один активний воркспейс).

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

fn own_config_path() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("DELTA_CONFIG_PATH") {
        return Ok(PathBuf::from(p));
    }
    let home = std::env::var_os("HOME").ok_or("HOME not set")?;
    Ok(PathBuf::from(home).join("Library/Application Support/com.nitra.delta/config.json"))
}

/// Читає весь конфіг (відсутній/битий файл — порожній обʼєкт).
fn read_config() -> Value {
    own_config_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!({}))
}

/// Мерджить один ключ у конфіг, зберігаючи решту ключів.
fn merge_config(key: &str, value: Value) -> Result<(), String> {
    let path = own_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut config = read_config();
    config
        .as_object_mut()
        .ok_or("config.json: корінь не обʼєкт")?
        .insert(key.to_string(), value);
    let body = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, body).map_err(|e| e.to_string())
}

/// Handle користувача з конфігу (None — ідентичність ще не налаштована).
pub fn get_identity() -> Option<String> {
    let handle = read_config().get("identity")?.as_str()?.to_string();
    (!handle.is_empty()).then_some(handle)
}

/// Зберігає handle користувача (порожній — скидає ідентичність).
pub fn set_identity(handle: String) -> Result<(), String> {
    merge_config("identity", json!(handle.trim()))
}

/// Шлях до воркспейсу з `.mt/mandates.yaml` (None — ще не налаштовано).
pub fn get_mandates_dir() -> Option<String> {
    let dir = read_config().get("mandates_dir")?.as_str()?.to_string();
    (!dir.is_empty()).then_some(dir)
}

/// Зберігає шлях до воркспейсу з `.mt/mandates.yaml`.
pub fn set_mandates_dir(dir: String) -> Result<(), String> {
    merge_config("mandates_dir", json!(dir.trim()))
}

/// Шлях до ключа пристрою (Ed25519, поза git) — файл-сусід `config.json`,
/// той самий каталог (`appLocalDataDir`), окреме імʼя. Приватний ключ ніколи
/// не потрапляє в репо: каталог поза git (та сама гарантія, що `config.json`
/// уже має — жоден із них не версіонується).
fn device_key_path() -> Result<PathBuf, String> {
    Ok(own_config_path()?.with_file_name("device_key.json"))
}

/// Сирий JSON-текст ключа пристрою (None — ще не згенеровано). Формат і
/// генерація — спільний JS-модуль `src/signing.js` (Web Crypto Ed25519),
/// Rust лишається тонким fs-шаром — той самий патерн, що читання
/// `mandates.yaml` у M0.
pub fn read_device_key() -> Option<String> {
    device_key_path().ok().and_then(|p| fs::read_to_string(p).ok())
}

/// Персистить ключ пристрою, згенерований JS-шаром (`signing.js:
/// generateDeviceKeypair`), на першому підписі.
pub fn write_device_key(json_text: String) -> Result<(), String> {
    let path = device_key_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, json_text).map_err(|e| e.to_string())
}

/// Адреса/модель локального LLM-ендпоінта для квіз-генератора (None — дефолт
/// із `src/quiz.js: defaultLlmConfig()` не перевизначено користувачем).
pub fn get_llm_config() -> (Option<String>, Option<String>) {
    let config = read_config();
    (
        config
            .get("llm_base_url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        config
            .get("llm_model")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    )
}

/// Зберігає адресу локального LLM-ендпоінта (порожній рядок — скидає до дефолту).
pub fn set_llm_base_url(base_url: String) -> Result<(), String> {
    merge_config("llm_base_url", json!(base_url.trim()))
}

/// Зберігає модель локального LLM-ендпоінта (порожній рядок — скидає до дефолту).
pub fn set_llm_model(model: String) -> Result<(), String> {
    merge_config("llm_model", json!(model.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Один тест на весь env-var-залежний сценарій: DELTA_CONFIG_PATH — процесний
    // глобальний стан, а cargo test за замовчуванням ганяє тести паралельно в
    // одному процесі — кілька тестів з окремими set_var/remove_var гоняться між
    // собою (флейки). Секвенційні кроки в одній функції — той самий підхід, що
    // owner/src-tauri/src/config.rs (там на цей інваріант — лише один env-тест).
    #[test]
    fn identity_and_mandates_dir_roundtrip_sequentially() {
        let tmp = tempfile::tempdir().unwrap();
        std::env::set_var("DELTA_CONFIG_PATH", tmp.path().join("config.json"));

        // ідентичність: трим, дефолт None
        assert_eq!(get_identity(), None);
        set_identity("  olena  ".to_string()).unwrap();
        assert_eq!(get_identity(), Some("olena".to_string()));

        // порожній handle скидає ідентичність
        set_identity("   ".to_string()).unwrap();
        assert_eq!(get_identity(), None);

        // mandates_dir: незалежний ключ, мердж не витирає сусідні поля
        set_identity("vitalii".to_string()).unwrap();
        assert_eq!(get_mandates_dir(), None);
        set_mandates_dir("/Users/vitalii/www/nitra/task".to_string()).unwrap();
        assert_eq!(
            get_mandates_dir(),
            Some("/Users/vitalii/www/nitra/task".to_string())
        );
        assert_eq!(get_identity(), Some("vitalii".to_string()));

        // ключ пристрою: окремий файл-сусід config.json, не сам config.json
        assert_eq!(read_device_key(), None);
        write_device_key("{\"publicKeyBase64\":\"abc\"}".to_string()).unwrap();
        assert_eq!(
            read_device_key(),
            Some("{\"publicKeyBase64\":\"abc\"}".to_string())
        );
        // sanity: device_key.json — сусід config.json, не сам config.json
        let device_key_file = tmp.path().join("device_key.json");
        assert!(device_key_file.exists());

        // llm-конфіг: незалежні ключі того самого config.json, дефолт — None
        assert_eq!(get_llm_config(), (None, None));
        set_llm_base_url("http://127.0.0.1:8080".to_string()).unwrap();
        set_llm_model("gemma-4-26b-a4b-it".to_string()).unwrap();
        assert_eq!(
            get_llm_config(),
            (
                Some("http://127.0.0.1:8080".to_string()),
                Some("gemma-4-26b-a4b-it".to_string())
            )
        );
        // мердж не витирає ідентичність/mandates_dir, встановлені вище
        assert_eq!(get_identity(), Some("vitalii".to_string()));
        assert_eq!(
            get_mandates_dir(),
            Some("/Users/vitalii/www/nitra/task".to_string())
        );

        std::env::remove_var("DELTA_CONFIG_PATH");
    }
}
