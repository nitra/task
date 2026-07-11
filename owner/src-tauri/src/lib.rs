//! Owner-бекенд: тонка обгортка над mt-core для черги рішень власника —
//! скан лісу, plan-review (approve/reject), прийняття роботи людиною,
//! чернетки планів декомпозиції (M1-плановик).
//! Виконання агентів тут свідомо немає: owner-вікно вирішує, app виконує.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use mt_core::{CreateOpts, CreateOutcome, TaskNode, WorkspaceInfo};
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

/// Вузол-ціль для декомпозиції: штатний шаблонний контракт mt-core.
#[tauri::command]
fn create_task(tasks_dir: String, name: String, opts: CreateOpts) -> Result<CreateOutcome, String> {
    mt_core::create_task(tasks_dir, name, opts)
}

/// Наступний вільний номер plan_NNN.md у директорії вузла.
fn next_plan_nnn(dir: &Path) -> u64 {
    let max = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            e.file_name()
                .to_str()?
                .strip_prefix("plan_")?
                .strip_suffix(".md")?
                .parse::<u64>()
                .ok()
        })
        .max()
        .unwrap_or(0);
    max + 1
}

/// Чернетка плану декомпозиції від плановика: наступний immutable
/// `plan_NNN.md` (`## Context` / `## Children` / `## Risks`). Children
/// валідуються парсером mt-core ДО запису (fail-closed) — вузол одразу
/// переходить у derived-стан plan_review і потрапляє в чергу рішень.
#[tauri::command]
fn draft_plan(
    tasks_dir: String,
    task_path: String,
    context: String,
    children_yaml: String,
    risks: Option<String>,
) -> Result<String, String> {
    mt_core::validate_name(&task_path)?;
    let dir = PathBuf::from(&tasks_dir).join(&task_path);
    if !dir.join("task.md").is_file() {
        return Err(format!("node not found: {task_path}"));
    }
    let children = mt_core::spawn::parse_children(&children_yaml)?;
    if children.is_empty() {
        return Err("## Children порожня — плановик не дав жодної дитини".to_string());
    }
    let file = format!("plan_{:03}.md", next_plan_nnn(&dir));
    let created_at = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    let yaml = if children_yaml.ends_with('\n') {
        children_yaml
    } else {
        format!("{children_yaml}\n")
    };
    let risks = risks.unwrap_or_default();
    let body = format!(
        "---\nschema_version: 1\ncreated_at: {created_at}\ndecision: composite\n---\n\n## Context\n\n{context}\n\n## Children\n\n```yaml\n{yaml}```\n\n## Risks\n\n{risks}\n",
    );
    fs::write(dir.join(&file), body).map_err(|e| e.to_string())?;
    Ok(file)
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
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            scan_tasks,
            find_all_tasks_dirs,
            get_project_paths,
            set_project_paths,
            create_task,
            draft_plan,
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

#[cfg(test)]
mod tests {
    use super::*;

    const CHILDREN: &str = "children:\n  - id: collect\n    mode: agent\n    deps: []\n    task: Зібрати дані\n  - id: verify\n    mode: human\n    deps: [collect]\n    task: Перевірити\n";

    fn goal_node() -> (tempfile::TempDir, String) {
        let tmp = tempfile::tempdir().unwrap();
        let node = tmp.path().join("goal");
        fs::create_dir_all(&node).unwrap();
        fs::write(node.join("task.md"), "---\nschema_version: 1\n---\n\n## Task\n").unwrap();
        (tmp, node.to_string_lossy().into_owned())
    }

    #[test]
    fn draft_plan_writes_next_nnn_and_parses_back() {
        let (tmp, node) = goal_node();
        fs::write(Path::new(&node).join("plan_001.md"), "старий план").unwrap();
        let tasks_dir = tmp.path().to_string_lossy().into_owned();

        let file = draft_plan(
            tasks_dir.clone(),
            "goal".to_string(),
            "інтент власника".to_string(),
            CHILDREN.to_string(),
            Some("ризики".to_string()),
        )
        .unwrap();
        assert_eq!(file, "plan_002.md");

        // Записаний план читається штатною read-моделлю mt-core.
        let review = mt_core::spawn::plan_review(&tasks_dir, "goal").unwrap();
        assert_eq!(review.nnn, 2);
        assert_eq!(review.children.len(), 2);
        assert_eq!(review.children[1].deps, ["collect"]);
        assert!(!review.decided);
    }

    #[test]
    fn draft_plan_rejects_invalid_children_without_writing() {
        let (tmp, node) = goal_node();
        let tasks_dir = tmp.path().to_string_lossy().into_owned();
        let err = draft_plan(
            tasks_dir,
            "goal".to_string(),
            "інтент".to_string(),
            "children: []\n".to_string(),
            None,
        )
        .unwrap_err();
        assert!(err.contains("Children"));
        assert!(!Path::new(&node).join("plan_001.md").exists());
    }
}
