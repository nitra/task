//! Per-file request journal — `<requests_dir>/<id>.json`.
//!
//! Shared by the lib's Tauri commands (in-app/webview) and the standalone
//! `journal` binary (spawned by the node MCP bin). All FS goes through Rust.
//! Records are JSON objects (messages/actions stay schemaless); we never delete
//! — only patch-update status/fields. Timestamps are epoch millis (UI formats).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use uuid::Uuid;

/// Resolve the requests directory: `TASK_REQUESTS_DIR` override, else the app's
/// local-data dir (`~/Library/Application Support/com.nitra.task/requests`).
/// The same path is produced by the Tauri command side, so both processes share it.
pub fn requests_dir() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("TASK_REQUESTS_DIR") {
        return Ok(PathBuf::from(dir));
    }
    let home = std::env::var_os("HOME").ok_or("HOME not set")?;
    Ok(PathBuf::from(home).join("Library/Application Support/com.nitra.task/requests"))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn record_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.json"))
}

fn write_record(path: &Path, record: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    fs::write(path, body).map_err(|e| e.to_string())
}

fn create_in(dir: &Path, intent: String, actor: Value) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    let now = now_millis();
    let record = json!({
        "id": id,
        "createdAt": now,
        "updatedAt": now,
        "actor": actor,
        "intent": intent,
        "status": "pending",
        "messages": [],
        "actions": [],
        "summary": Value::Null,
        "question": Value::Null,
        "error": Value::Null,
        "parentId": Value::Null,
    });
    write_record(&record_path(dir, &id), &record)?;
    Ok(id)
}

fn load_in(dir: &Path, id: &str) -> Result<Value, String> {
    let raw = fs::read_to_string(record_path(dir, id)).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn update_in(dir: &Path, id: &str, patch: Value) -> Result<(), String> {
    let path = record_path(dir, id);
    let mut record = load_in(dir, id)?;
    let obj = record.as_object_mut().ok_or("record is not an object")?;
    if let Value::Object(fields) = patch {
        for (k, v) in fields {
            obj.insert(k, v);
        }
    }
    obj.insert("updatedAt".to_string(), json!(now_millis()));
    write_record(&path, &record)
}

fn list_in(dir: &Path) -> Result<Vec<Value>, String> {
    let mut records: Vec<Value> = match fs::read_dir(dir) {
        Ok(entries) => entries
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
            .filter_map(|e| fs::read_to_string(e.path()).ok())
            .filter_map(|raw| serde_json::from_str::<Value>(&raw).ok())
            .collect(),
        Err(_) => Vec::new(),
    };
    records.sort_by_key(|r| {
        std::cmp::Reverse(r.get("createdAt").and_then(Value::as_u64).unwrap_or(0))
    });
    Ok(records)
}

/// Create a new record (status `pending`) and return its id.
pub fn create(intent: String, actor: Value) -> Result<String, String> {
    create_in(&requests_dir()?, intent, actor)
}

/// Load a record by id.
pub fn load(id: &str) -> Result<Value, String> {
    load_in(&requests_dir()?, id)
}

/// Merge `patch` (a JSON object) into the record and bump `updatedAt`.
pub fn update(id: &str, patch: Value) -> Result<(), String> {
    update_in(&requests_dir()?, id, patch)
}

/// List all records, newest first (by `createdAt`).
pub fn list() -> Result<Vec<Value>, String> {
    list_in(&requests_dir()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("task-journal-test-{}", Uuid::new_v4()))
    }

    #[test]
    fn create_then_load_roundtrips() {
        let dir = tmp_dir();
        let id = create_in(
            &dir,
            "do thing".into(),
            json!({ "kind": "agent", "id": "t" }),
        )
        .unwrap();
        let rec = load_in(&dir, &id).unwrap();
        assert_eq!(rec["intent"], "do thing");
        assert_eq!(rec["status"], "pending");
        assert_eq!(rec["actor"]["id"], "t");
        assert_eq!(rec["id"], id);
    }

    #[test]
    fn update_merges_fields() {
        let dir = tmp_dir();
        let id = create_in(&dir, "x".into(), Value::Null).unwrap();
        update_in(&dir, &id, json!({ "status": "done", "summary": "ok" })).unwrap();
        let rec = load_in(&dir, &id).unwrap();
        assert_eq!(rec["status"], "done");
        assert_eq!(rec["summary"], "ok");
        assert_eq!(rec["intent"], "x"); // untouched fields preserved
    }

    #[test]
    fn list_returns_all_records() {
        let dir = tmp_dir();
        create_in(&dir, "a".into(), Value::Null).unwrap();
        create_in(&dir, "b".into(), Value::Null).unwrap();
        assert_eq!(list_in(&dir).unwrap().len(), 2);
    }

    #[test]
    fn list_missing_dir_is_empty() {
        assert!(list_in(&tmp_dir()).unwrap().is_empty());
    }
}
