//! Конфіг owner-застосунку — project search paths та ідентичність власника.
//!
//! Зберігається у `appLocalDataDir/config.json`
//! (`{ "project_paths": [...], "identity": "handle" }`).
//! Fallback-ланцюжок читання шляхів: власний конфіг → конфіг app
//! (`com.nitra.task`, щоб обидва застосунки бачили той самий ліс без
//! налаштування) → `~/www`. Ідентичність — handle (як `assignee` у `h.md`,
//! PII лишається поза git) — тільки з власного конфігу, без fallback.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

fn own_config_path() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("OWNER_CONFIG_PATH") {
        return Ok(PathBuf::from(p));
    }
    Ok(support_dir()?.join("com.nitra.owner/config.json"))
}

fn support_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME not set")?;
    Ok(PathBuf::from(home).join("Library/Application Support"))
}

fn read_paths_in(path: &Path) -> Option<Vec<String>> {
    let v: Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    let arr = v.get("project_paths")?.as_array()?;
    let paths: Vec<String> = arr
        .iter()
        .filter_map(|x| x.as_str().map(str::to_owned))
        .collect();
    (!paths.is_empty()).then_some(paths)
}

/// Project paths власника: свій конфіг → конфіг app → `~/www`.
pub fn get_project_paths() -> Vec<String> {
    if let Some(paths) = own_config_path().ok().and_then(|p| read_paths_in(&p)) {
        return paths;
    }
    if let Some(paths) = support_dir()
        .ok()
        .and_then(|d| read_paths_in(&d.join("com.nitra.task/config.json")))
    {
        return paths;
    }
    std::env::var_os("HOME")
        .map(|h| vec![PathBuf::from(h).join("www").to_string_lossy().into_owned()])
        .unwrap_or_default()
}

/// Читає весь власний конфіг (відсутній/битий файл — порожній обʼєкт).
fn read_own_config() -> Value {
    own_config_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| json!({}))
}

/// Мерджить один ключ у власний конфіг, зберігаючи решту ключів.
fn merge_own_config(key: &str, value: Value) -> Result<(), String> {
    let path = own_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut config = read_own_config();
    config
        .as_object_mut()
        .ok_or("config.json: корінь не обʼєкт")?
        .insert(key.to_string(), value);
    let body = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, body).map_err(|e| e.to_string())
}

/// Зберігає project paths у власний конфіг owner (інші ключі не чіпає).
pub fn set_project_paths(paths: Vec<String>) -> Result<(), String> {
    merge_own_config("project_paths", json!(paths))
}

/// Handle власника з конфігу (None — ідентичність ще не налаштована).
pub fn get_identity() -> Option<String> {
    let handle = read_own_config().get("identity")?.as_str()?.to_string();
    (!handle.is_empty()).then_some(handle)
}

/// Зберігає handle власника (порожній — скидає ідентичність).
pub fn set_identity(handle: String) -> Result<(), String> {
    merge_own_config("identity", json!(handle.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_paths_skips_missing_and_empty() {
        let dir = std::env::temp_dir().join("owner-config-test");
        fs::create_dir_all(&dir).unwrap();
        let missing = dir.join("absent.json");
        assert_eq!(read_paths_in(&missing), None);

        let empty = dir.join("empty.json");
        fs::write(&empty, r#"{ "project_paths": [] }"#).unwrap();
        assert_eq!(read_paths_in(&empty), None);

        let full = dir.join("full.json");
        fs::write(&full, r#"{ "project_paths": ["/a"] }"#).unwrap();
        assert_eq!(read_paths_in(&full), Some(vec!["/a".to_string()]));
    }
}
