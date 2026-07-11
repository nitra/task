//! Owner-бекенд: тонка обгортка над mt-core для черги рішень власника —
//! скан лісу, plan-review (approve/reject), прийняття роботи людиною.
//! Виконання агентів тут свідомо немає: owner-вікно вирішує, app виконує.

use std::path::PathBuf;
use std::sync::Mutex;

use mt_core::{TaskNode, WorkspaceInfo};
use notify::Watcher;
use tauri::{Emitter, Manager as _};

mod config;

#[tauri::command]
fn scan_tasks(tasks_dir: String) -> Result<Vec<TaskNode>, String> {
    let worktrees = mt_core::discover_worktrees(&PathBuf::from(&tasks_dir));
    mt_core::scan_tasks(tasks_dir, worktrees)
}

#[tauri::command]
fn find_all_tasks_dirs() -> Result<Vec<WorkspaceInfo>, String> {
    Ok(config::get_project_paths()
        .iter()
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .flat_map(|p| mt_core::find_all_tasks_dirs_from(&p))
        .collect())
}

#[tauri::command]
fn get_project_paths() -> Vec<String> {
    config::get_project_paths()
}

#[tauri::command]
fn set_project_paths(paths: Vec<String>) -> Result<(), String> {
    config::set_project_paths(paths)
}

/// Read-модель plan-review: актуальний план вузла з розібраними `## Children`.
#[tauri::command]
fn plan_review_info(
    tasks_dir: String,
    task_path: String,
) -> Result<mt_core::spawn::PlanReview, String> {
    mt_core::spawn::plan_review(&tasks_dir, &task_path)
}

/// Вердикт власника: approve плану → валідація + матеріалізація дітей.
#[tauri::command]
fn spawn_approve(
    tasks_dir: String,
    task_path: String,
) -> Result<mt_core::spawn::SpawnOutcome, String> {
    mt_core::spawn::spawn_approve(&tasks_dir, &task_path)
}

/// Вердикт власника: reject плану з причиною → plan-rejected_NNN.md.
#[tauri::command]
fn spawn_reject(tasks_dir: String, task_path: String, reason: String) -> Result<String, String> {
    mt_core::spawn::spawn_reject(&tasks_dir, &task_path, &reason)
}

/// Вердикт власника «прийнято як виконане»: fact (якщо ще немає) + done
/// із прогоном `## Check` і composite-агрегацією вгору.
#[tauri::command]
fn human_done(
    tasks_dir: String,
    task_path: String,
    summary: String,
) -> Result<mt_core::signal::SignalOutcome, String> {
    if let Err(e) = mt_core::signal::write_fact(&tasks_dir, &task_path, &summary, None) {
        // Порожній/битий Summary — справжня помилка; наявний fact — ні
        // (retry після Check-фейлу не перетирає його).
        if e.contains("Summary") {
            return Err(e);
        }
    }
    mt_core::signal::done(&tasks_dir, &task_path, "human")
}

/// Активний FS-watcher tasks-директорій (замінюється при повторному виклику).
struct WatchState(Mutex<Option<notify::RecommendedWatcher>>);

/// Стежить за лісом і шле `mt-changed`; frontend дебаунсить і перескановує.
#[tauri::command]
fn watch_tasks_dirs(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchState>,
    dirs: Vec<String>,
) -> Result<(), String> {
    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                if let Some(path) = event.paths.first() {
                    let _ = app.emit("mt-changed", path.display().to_string());
                }
            }
        })
        .map_err(|e| e.to_string())?;
    for dir in dirs.iter().map(PathBuf::from).filter(|d| d.is_dir()) {
        watcher
            .watch(&dir, notify::RecursiveMode::Recursive)
            .map_err(|e| e.to_string())?;
    }
    *state.0.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(WatchState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            scan_tasks,
            find_all_tasks_dirs,
            get_project_paths,
            set_project_paths,
            plan_review_info,
            spawn_approve,
            spawn_reject,
            human_done,
            watch_tasks_dirs
        ]);

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .setup(|app| {
            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&format!("owner v{}", app.package_info().version));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
