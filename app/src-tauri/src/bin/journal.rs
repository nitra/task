//! Standalone `journal` binary — request-journal FS for the node MCP bin.
//! Reuses src/journal.rs without linking the Tauri GUI stack (FS-in-Rust).
//!
//! Usage: journal create '<json{intent,actor}>' | load <id> | update <id> '<patch>' | list
//! Prints JSON to stdout; exits 2 on error.

#[path = "../journal.rs"]
mod journal;

use std::process;

use serde_json::{json, Value};

fn dispatch(args: &[String]) -> Result<Value, String> {
    match args.first().map(String::as_str).unwrap_or("") {
        "create" => {
            let payload: Value = serde_json::from_str(args.get(1).ok_or("create: missing json")?)
                .map_err(|e| e.to_string())?;
            let intent = payload
                .get("intent")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let actor = payload.get("actor").cloned().unwrap_or(Value::Null);
            Ok(json!({ "id": journal::create(intent, actor)? }))
        }
        "load" => journal::load(args.get(1).ok_or("load: missing id")?),
        "update" => {
            let id = args.get(1).ok_or("update: missing id")?;
            let patch: Value = serde_json::from_str(args.get(2).ok_or("update: missing patch")?)
                .map_err(|e| e.to_string())?;
            journal::update(id, patch)?;
            Ok(json!({ "ok": true }))
        }
        "list" => Ok(Value::Array(journal::list()?)),
        other => Err(format!("unknown journal op: {other}")),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match dispatch(&args) {
        Ok(value) => println!("{}", serde_json::to_string(&value).unwrap()),
        Err(e) => {
            eprintln!("journal error: {e}");
            process::exit(2);
        }
    }
}
