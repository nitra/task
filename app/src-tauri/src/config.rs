//! App config — the single source of the user's project search paths.
//!
//! Stored at `appLocalDataDir/config.json` (`{ "project_paths": [...] }`) so the
//! GUI, the in-app agent and the node MCP bin all read the SAME roots (FS→Rust).
//! Empty/absent → defaults to `~/www`.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

fn config_path() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("TASK_CONFIG_PATH") {
        return Ok(PathBuf::from(p));
    }
    let home = std::env::var_os("HOME").ok_or("HOME not set")?;
    Ok(PathBuf::from(home).join("Library/Application Support/com.nitra.task/config.json"))
}

/// Default project roots when nothing is configured yet: `~/www`.
fn default_paths() -> Vec<String> {
    std::env::var_os("HOME")
        .map(|h| vec![PathBuf::from(h).join("www").to_string_lossy().into_owned()])
        .unwrap_or_default()
}

fn read_in(path: &Path) -> Option<Vec<String>> {
    let raw = fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let arr = v.get("project_paths").and_then(Value::as_array)?;
    Some(
        arr.iter()
            .filter_map(|x| x.as_str().map(str::to_owned))
            .collect(),
    )
}

fn write_in(path: &Path, paths: &[String]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(&json!({ "project_paths": paths }))
        .map_err(|e| e.to_string())?;
    fs::write(path, body).map_err(|e| e.to_string())
}

/// User's project search paths; defaults to `~/www` when unset/empty.
pub fn get_project_paths() -> Vec<String> {
    match config_path().ok().and_then(|p| read_in(&p)) {
        Some(paths) if !paths.is_empty() => paths,
        _ => default_paths(),
    }
}

/// Persist the user's project search paths.
pub fn set_project_paths(paths: Vec<String>) -> Result<(), String> {
    write_in(&config_path()?, &paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn tmp() -> PathBuf {
        std::env::temp_dir().join(format!("task-config-{}.json", Uuid::new_v4()))
    }

    #[test]
    fn write_then_read_roundtrips() {
        let path = tmp();
        write_in(&path, &["/a".to_string(), "/b".to_string()]).unwrap();
        assert_eq!(
            read_in(&path),
            Some(vec!["/a".to_string(), "/b".to_string()])
        );
    }

    #[test]
    fn read_missing_is_none() {
        assert_eq!(read_in(&tmp()), None);
    }

    #[test]
    fn default_paths_point_at_www() {
        let got = default_paths();
        assert!(got.iter().all(|p| p.ends_with("/www")));
    }
}
