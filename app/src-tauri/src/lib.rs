use std::fs;
use std::path::PathBuf;

use mt_scanner::{CreateOpts, CreateOutcome, TaskNode, WorkspaceInfo};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            scan_tasks,
            create_task,
            find_tasks_dir,
            find_all_tasks_dirs,
            read_task
        ]);

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
