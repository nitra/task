//! Per-file request journal — `<requests_dir>/<id>.json`.
//!
//! Shared by the lib's Tauri commands (in-app/webview) and the standalone
//! `journal` binary (spawned by the node MCP bin). All FS goes through Rust.
//! Records are JSON objects (messages/actions stay schemaless); we never delete
//! — only patch-update status/fields. Timestamps are epoch millis (UI formats).

use std::fs;
use std::path::PathBuf;
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

fn record_path(id: &str) -> Result<PathBuf, String> {
    Ok(requests_dir()?.join(format!("{id}.json")))
}

fn write_record(path: &PathBuf, record: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    fs::write(path, body).map_err(|e| e.to_string())
}

/// Create a new record (status `pending`) and return its id.
pub fn create(intent: String, actor: Value) -> Result<String, String> {
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
    write_record(&record_path(&id)?, &record)?;
    Ok(id)
}

/// Load a record by id.
pub fn load(id: &str) -> Result<Value, String> {
    let raw = fs::read_to_string(record_path(id)?).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// Merge `patch` (a JSON object) into the record and bump `updatedAt`.
pub fn update(id: &str, patch: Value) -> Result<(), String> {
    let path = record_path(id)?;
    let mut record = load(id)?;
    let obj = record.as_object_mut().ok_or("record is not an object")?;
    if let Value::Object(fields) = patch {
        for (k, v) in fields {
            obj.insert(k, v);
        }
    }
    obj.insert("updatedAt".to_string(), json!(now_millis()));
    write_record(&path, &record)
}

/// List all records, newest first (by filename = uuid is not time-ordered, so
/// sort by `createdAt`).
pub fn list() -> Result<Vec<Value>, String> {
    let dir = requests_dir()?;
    let mut records: Vec<Value> = match fs::read_dir(&dir) {
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
