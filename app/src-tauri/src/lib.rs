use std::fs;
use std::path::PathBuf;

use mt_scanner::{CreateOpts, CreateOutcome, TaskNode, WorkspaceInfo};

mod journal;

/// Request-journal commands (webview side). Share src/journal.rs with the
/// standalone `journal` binary; both resolve the same requests dir.
#[tauri::command]
fn journal_create(intent: String, actor: serde_json::Value) -> Result<String, String> {
    journal::create(intent, actor)
}

#[tauri::command]
fn journal_load(id: String) -> Result<serde_json::Value, String> {
    journal::load(&id)
}

#[tauri::command]
fn journal_update(id: String, patch: serde_json::Value) -> Result<(), String> {
    journal::update(&id, patch)
}

#[tauri::command]
fn journal_list() -> Result<Vec<serde_json::Value>, String> {
    journal::list()
}

#[tauri::command]
fn scan_tasks(tasks_dir: String) -> Result<Vec<TaskNode>, String> {
    // Виявляємо активні worktree з git, як це робить CLI (`mt-scanner scan`).
    let worktrees = mt_scanner::discover_worktrees(&PathBuf::from(&tasks_dir));
    mt_scanner::scan_tasks(tasks_dir, worktrees)
}

#[tauri::command]
fn create_task(tasks_dir: String, name: String, opts: CreateOpts) -> Result<CreateOutcome, String> {
    mt_scanner::create_task(tasks_dir, name, opts)
}

#[tauri::command]
fn find_tasks_dir() -> Result<String, String> {
    mt_scanner::find_tasks_dir()
}

#[tauri::command]
fn find_all_tasks_dirs() -> Result<Vec<WorkspaceInfo>, String> {
    mt_scanner::find_all_tasks_dirs()
}

#[tauri::command]
fn read_task(tasks_dir: String, task_path: String) -> Result<String, String> {
    let path = PathBuf::from(&tasks_dir).join(&task_path).join("task.md");
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Destructive: remove a task node directory. Executed only with authority
/// (human directly, or human-approved agent request — never by the agent).
/// Validates the name and confirms the resolved path stays under `tasks_dir`.
#[tauri::command]
fn delete_task(tasks_dir: String, name: String) -> Result<(), String> {
    if name.is_empty() || name.contains("..") || name.starts_with('/') {
        return Err(format!("invalid task name: {name}"));
    }
    let base = PathBuf::from(&tasks_dir)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = base.join(&name).canonicalize().map_err(|e| e.to_string())?;
    if !target.starts_with(&base) {
        return Err("path escapes tasks dir".to_string());
    }
    fs::remove_dir_all(&target).map_err(|e| e.to_string())
}

/// Returns the user's home directory for use as a base path in the project picker.
#[tauri::command]
fn home_dir() -> Option<String> {
    std::env::var_os("HOME").map(|h| h.to_string_lossy().into_owned())
}

/// List all mt/ task directories reachable from `root` using the scanner's
/// workspace discovery (respects .mt.json, .gitignore, depth ≤ 6).
#[tauri::command]
fn list_project_workspaces(root: String) -> Vec<WorkspaceInfo> {
    mt_scanner::find_all_tasks_dirs_from(&PathBuf::from(root))
}

/// List mt/ task directories from an explicit list of project paths.
/// Each path is scanned independently via the scanner's workspace discovery.
/// Paths that don't exist are silently skipped.
#[tauri::command]
fn list_projects_from_paths(paths: Vec<String>) -> Vec<WorkspaceInfo> {
    paths
        .iter()
        .filter(|p| PathBuf::from(p).is_dir())
        .flat_map(|p| mt_scanner::find_all_tasks_dirs_from(&PathBuf::from(p)))
        .collect()
}

/// Конфіг omlx: ключ і базовий URL, щоб не задавати їх окремо в кожній програмі.
/// Порожні значення → `None`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OmlxConfig {
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
}

/// Витягуємо `(base_url, api_key)` з `~/.omlx/settings.json` — того самого файлу,
/// що читає omlx-сервер. Портативно: `$HOME` резолвиться на кожній машині, тож
/// жодних env/launchd налаштувань per-host. Будь-яка помилка читання → `(None, None)`.
fn omlx_from_settings() -> (Option<String>, Option<String>) {
    let Some(home) = std::env::var_os("HOME") else {
        return (None, None);
    };
    let path = PathBuf::from(home).join(".omlx/settings.json");
    let Ok(raw) = fs::read_to_string(&path) else {
        return (None, None);
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return (None, None);
    };
    let str_at = |obj: &str, key: &str| {
        json.get(obj)
            .and_then(|o| o.get(key))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    let host = str_at("server", "host");
    let port = json
        .get("server")
        .and_then(|s| s.get("port"))
        .and_then(serde_json::Value::as_u64);
    let base_url = match (host, port) {
        (Some(h), Some(p)) => Some(format!("http://{h}:{p}/v1")),
        _ => None,
    };
    (base_url, str_at("auth", "api_key"))
}

#[tauri::command]
fn omlx_config() -> OmlxConfig {
    let (base_url, api_key) = omlx_from_settings();
    OmlxConfig {
        base_url,
        model: None,
        api_key,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_tasks,
            create_task,
            find_tasks_dir,
            find_all_tasks_dirs,
            list_project_workspaces,
            list_projects_from_paths,
            home_dir,
            read_task,
            delete_task,
            omlx_config,
            journal_create,
            journal_load,
            journal_update,
            journal_list
        ]);

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
