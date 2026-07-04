use std::fs;
use std::path::PathBuf;

use mt_core::{CreateOpts, CreateOutcome, TaskNode, WorkspaceInfo};

// The request journal (journal_*) and omlx_config now come from the shared
// tauri-plugin-agent (invoked as plugin:agent|*). src/journal.rs stays only for
// the standalone `journal` binary used by the node MCP orchestrator.

mod config;

#[tauri::command]
fn scan_tasks(tasks_dir: String) -> Result<Vec<TaskNode>, String> {
    // Виявляємо активні worktree з git, як це робить CLI (`mt scan`).
    let worktrees = mt_core::discover_worktrees(&PathBuf::from(&tasks_dir));
    mt_core::scan_tasks(tasks_dir, worktrees)
}

#[tauri::command]
fn create_task(tasks_dir: String, name: String, opts: CreateOpts) -> Result<CreateOutcome, String> {
    mt_core::create_task(tasks_dir, name, opts)
}

#[tauri::command]
fn find_all_tasks_dirs() -> Result<Vec<WorkspaceInfo>, String> {
    // Single source: the configured project paths (default ~/www) — the SAME
    // roots the human's GUI uses, so the agent grounds against them too.
    Ok(list_projects_from_paths(config::get_project_paths()))
}

#[tauri::command]
fn read_task(tasks_dir: String, task_path: String) -> Result<String, String> {
    let path = PathBuf::from(&tasks_dir).join(&task_path).join("task.md");
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Version chain вузла: перелік артефактів (task/plan/run/fact/audit-*) з
/// frontmatter-витягом — дані для timeline у деталях задачі.
#[tauri::command]
fn node_artifacts(
    tasks_dir: String,
    task_path: String,
) -> Result<Vec<mt_core::artifacts::NodeArtifact>, String> {
    mt_core::artifacts::list_node_artifacts(&tasks_dir, &task_path)
}

/// Вміст одного артефакта вузла (allowlist імен — у mt-core).
#[tauri::command]
fn read_node_artifact(
    tasks_dir: String,
    task_path: String,
    file: String,
) -> Result<String, String> {
    mt_core::artifacts::read_node_artifact(&tasks_dir, &task_path, &file)
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

/// Scan mt/ task dirs across a list of project paths (internal helper for
/// `find_all_tasks_dirs`; non-existent paths are skipped).
fn list_projects_from_paths(paths: Vec<String>) -> Vec<WorkspaceInfo> {
    paths
        .iter()
        .filter(|p| PathBuf::from(p).is_dir())
        .flat_map(|p| mt_core::find_all_tasks_dirs_from(&PathBuf::from(p)))
        .collect()
}

/// Configured project search paths (single source; default ~/www).
#[tauri::command]
fn get_project_paths() -> Vec<String> {
    config::get_project_paths()
}

/// Persist the project search paths (shared by GUI, in-app agent and MCP bin).
#[tauri::command]
fn set_project_paths(paths: Vec<String>) -> Result<(), String> {
    config::set_project_paths(paths)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_agent::init())
        .invoke_handler(tauri::generate_handler![
            scan_tasks,
            create_task,
            find_all_tasks_dirs,
            read_task,
            node_artifacts,
            read_node_artifact,
            delete_task,
            get_project_paths,
            set_project_paths
        ]);

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    // relaunch() після встановлення оновлення — щоб застосунок сам
    // перезапустився в нову версію, а не чекав ручного рестарту.
    let builder = builder.plugin(tauri_plugin_process::init());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .setup(|app| {
            // Версія застосунку в заголовку вікна, щоб її було видно без About-діалогу
            #[cfg(desktop)]
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                let _ = window.set_title(&format!("task v{}", app.package_info().version));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
