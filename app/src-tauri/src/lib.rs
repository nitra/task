use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use mt_core::{CreateOpts, CreateOutcome, TaskNode, WorkspaceInfo};
use notify::Watcher;
use tauri::{Emitter, Manager};

// The request journal (journal_*) and omlx_config now come from the shared
// tauri-plugin-agent (invoked as plugin:agent|*). src/journal.rs stays only for
// the standalone `journal` binary used by the node MCP orchestrator.

mod config;
mod git_util;
mod pipeline;

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

/// Cost/time ledger воркспейсу: агрегація wall_sec/tokens/cost_usd по всіх
/// run_NNN.md графу (per-node + TOTAL) — дані для аналітичного екрана.
#[tauri::command]
fn cost_ledger(tasks_dir: String) -> Result<mt_core::ledger::CostLedger, String> {
    mt_core::ledger::build_cost_ledger(&tasks_dir)
}

/// Вміст `run-draft.md` — git-ignored чернетка, яку виконавець веде під час
/// рану (## Completed/## Blockers/## Next Attempt). Не частина version chain
/// (не проходить allowlist artifacts) — читається окремо для live-стрічки
/// GUI поки вузол `running`. Відсутній файл → порожній рядок, не помилка.
#[tauri::command]
fn read_run_draft(tasks_dir: String, task_path: String) -> Result<String, String> {
    mt_core::validate_name(&task_path)?;
    let path = PathBuf::from(&tasks_dir)
        .join(&task_path)
        .join("run-draft.md");
    Ok(fs::read_to_string(&path).unwrap_or_default())
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

/// Plan-review read-модель: актуальний план вузла з розібраними `## Children`.
#[tauri::command]
fn plan_review_info(
    tasks_dir: String,
    task_path: String,
) -> Result<mt_core::spawn::PlanReview, String> {
    mt_core::spawn::plan_review(&tasks_dir, &task_path)
}

/// Plan-review рішення: approve → валідація + матеріалізація дітей.
#[tauri::command]
fn spawn_approve(
    tasks_dir: String,
    task_path: String,
) -> Result<mt_core::spawn::SpawnOutcome, String> {
    mt_core::spawn::spawn_approve(&tasks_dir, &task_path)
}

/// Plan-review рішення: reject із причиною → plan-rejected_NNN.md.
#[tauri::command]
fn spawn_reject(tasks_dir: String, task_path: String, reason: String) -> Result<String, String> {
    mt_core::spawn::spawn_reject(&tasks_dir, &task_path, &reason)
}

/// Перемикає виконавця вузла (a.md ↔ h.md).
#[tauri::command]
fn set_executor(
    tasks_dir: String,
    task_path: String,
    mode: String,
    model_tier: Option<String>,
    qualification: Option<String>,
) -> Result<String, String> {
    let mode = match mode.as_str() {
        "agent" => mt_core::Mode::Agent,
        "human" => mt_core::Mode::Human,
        other => return Err(format!("invalid mode: {other}")),
    };
    mt_core::spawn::set_executor(
        &tasks_dir,
        &task_path,
        mode,
        model_tier.as_deref(),
        None,
        qualification.as_deref(),
    )
}

/// Запуск агентського вузла локальним runner-ом: preflight синхронно (помилки
/// blocked/running видно одразу), сам ран — у фоновому потоці; прогрес GUI
/// бачить через running_* маркер і FS-watcher, фінал — подія mt-run-finished.
#[tauri::command]
fn run_node(
    app: tauri::AppHandle,
    tasks_dir: String,
    task_path: String,
) -> Result<mt_core::runner::RunPlan, String> {
    let plan = mt_core::runner::preflight(&tasks_dir, &task_path)?;
    std::thread::spawn(move || {
        let outcome = mt_core::runner::run_node(&tasks_dir, &task_path);
        let payload = match outcome {
            Ok(o) => serde_json::json!({ "path": task_path, "result": o.result }),
            Err(e) => serde_json::json!({ "path": task_path, "result": "error", "error": e }),
        };
        let _ = app.emit("mt-run-finished", payload);
    });
    Ok(plan)
}

/// Активні `run --auto` оркестратори (по tasks_dir) — guard від подвійного
/// запуску одного воркспейсу; знімається сам собою по завершенню потоку.
struct AutoState(Mutex<std::collections::HashSet<String>>);

/// `agent_concurrency` з `.mt.json` воркспейсу (project root = parent tasks_dir).
fn read_agent_concurrency(tasks_dir: &str) -> usize {
    let project_root = PathBuf::from(tasks_dir)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let raw = fs::read_to_string(project_root.join(".mt.json")).ok();
    let config = mt_core::config::merge_config(raw.as_deref());
    config
        .get("agent_concurrency")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(5) as usize
}

/// `agent_concurrency` воркспейсу — для індикатора `[slots: X/N]` у GUI
/// (спека «Ліміти worktree»).
#[tauri::command]
fn get_agent_concurrency(tasks_dir: String) -> usize {
    read_agent_concurrency(&tasks_dir)
}

/// Запускає `run --auto` для воркспейсу: одноразовий batch-прохід усіх
/// waiting-агентських вузлів у фоновому потоці; прогрес видно через
/// running_*-маркери + FS-watcher (`mt-changed`), підсумок — `mt-auto-finished`.
#[tauri::command]
fn run_auto(
    app: tauri::AppHandle,
    state: tauri::State<'_, AutoState>,
    tasks_dir: String,
) -> Result<(), String> {
    {
        let mut running = state.0.lock().map_err(|e| e.to_string())?;
        if !running.insert(tasks_dir.clone()) {
            return Err("run --auto вже виконується для цього воркспейсу".to_string());
        }
    }
    let concurrency = read_agent_concurrency(&tasks_dir);
    std::thread::spawn(move || {
        let outcome = mt_core::orchestrate::run_auto(&tasks_dir, concurrency);
        let payload = match outcome {
            Ok(results) => serde_json::json!({ "tasksDir": tasks_dir, "results": results }),
            Err(e) => serde_json::json!({ "tasksDir": tasks_dir, "results": [], "error": e }),
        };
        if let Ok(mut running) = app.state::<AutoState>().0.lock() {
            running.remove(&tasks_dir);
        }
        let _ = app.emit("mt-auto-finished", payload);
    });
    Ok(())
}

/// Human done/audit: пише fact (якщо ще немає), ганяє ## Check, пише run;
/// audit відкриває аудит-цикл; done тягне composite-агрегацію вгору.
#[tauri::command]
fn human_signal(
    tasks_dir: String,
    task_path: String,
    signal: String,
    summary: String,
) -> Result<mt_core::signal::SignalOutcome, String> {
    // fact пишемо лише якщо його ще немає (retry після Check-фейлу не перетирає).
    if let Err(e) = mt_core::signal::write_fact(&tasks_dir, &task_path, &summary, None) {
        let expected_existing = e.contains("Summary");
        if expected_existing {
            return Err(e);
        }
    }
    match signal.as_str() {
        "done" => mt_core::signal::done(&tasks_dir, &task_path, "human"),
        "audit" => mt_core::signal::audit(&tasks_dir, &task_path, "human"),
        other => Err(format!("invalid signal: {other}")),
    }
}

/// Human failed: run_NNN (failed) з обов'язковими секціями діагностики.
#[tauri::command]
fn human_failed(
    tasks_dir: String,
    task_path: String,
    completed: String,
    blockers: String,
    next_attempt: String,
) -> Result<String, String> {
    mt_core::signal::failed(
        &tasks_dir,
        &task_path,
        "human",
        &completed,
        &blockers,
        &next_attempt,
    )
}

/// Інвалідація version chain вузла (+каскад по нащадках) → history/.
#[tauri::command]
fn invalidate_node(tasks_dir: String, task_path: String) -> Result<Vec<String>, String> {
    mt_core::lifecycle::invalidate(&tasks_dir, &task_path, true)
}

/// Kill вузла: архів піддерева у .history/ і видалення з графу.
#[tauri::command]
fn kill_node(tasks_dir: String, task_path: String) -> Result<String, String> {
    mt_core::lifecycle::kill(&tasks_dir, &task_path)
}

/// Claim вузла для GUI: шлях + ownership-факти з `.mt-claim.yml`.
#[derive(serde::Serialize)]
struct NodeClaim {
    path: String,
    actor: Option<String>,
    runner_id: Option<String>,
    lease_until: Option<String>,
    expired: bool,
}

/// Збирає шляхи всіх вузлів дерева (для зіставлення з claim node-hash).
fn collect_paths(nodes: &[TaskNode], out: &mut Vec<String>) {
    for node in nodes {
        out.push(node.path.clone());
        collect_paths(&node.children, out);
    }
}

/// Remote claims воркспейсу: читає `refs/mt/claims/*`, зіставляє node-hash зі
/// сканованими вузлами → running/stalled з runner_id для GUI.
#[tauri::command]
fn remote_claims(tasks_dir: String) -> Result<Vec<NodeClaim>, String> {
    let repo_root = git_util::repo_root(&tasks_dir)?;
    // Канонічний tasks-root для node-hash — шлях відносно git root.
    let tasks_root = PathBuf::from(&tasks_dir)
        .canonicalize()
        .map_err(|e| e.to_string())?
        .strip_prefix(&repo_root)
        .map_err(|_| "tasks dir escapes its git repository".to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    let grace = fs::read_to_string(repo_root.join(".mt.json"))
        .ok()
        .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
        .and_then(|v| v.get("claim_grace_sec").and_then(serde_json::Value::as_i64))
        .unwrap_or(60);
    let claims = mt_core::claims::fetch_remote_claims(&repo_root, grace)?;
    if claims.is_empty() {
        return Ok(Vec::new());
    }

    let worktrees = mt_core::discover_worktrees(&PathBuf::from(&tasks_dir));
    let nodes = mt_core::scan_tasks(tasks_dir, worktrees)?;
    let mut paths = Vec::new();
    collect_paths(&nodes, &mut paths);

    let mut result = Vec::new();
    for claim in claims {
        if let Some(path) = paths
            .iter()
            .find(|p| mt_core::claims::node_hash(&tasks_root, p) == claim.node_hash)
        {
            result.push(NodeClaim {
                path: path.clone(),
                actor: claim.actor,
                runner_id: claim.runner_id,
                lease_until: claim.lease_until,
                expired: claim.expired,
            });
        }
    }
    Ok(result)
}

/// Активний FS-watcher tasks-директорій; заміняється при кожному
/// `watch_tasks_dirs` (список воркспейсів може змінитись після rescan).
struct WatchState(Mutex<Option<notify::RecommendedWatcher>>);

/// Стежить за tasks-директоріями і шле подію `mt-changed` (payload — шлях
/// зміненого файлу); frontend дебаунсить і перескановує граф.
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
    for dir in &dirs {
        let path = PathBuf::from(dir);
        if path.is_dir() {
            watcher
                .watch(&path, notify::RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
        }
    }
    *state.0.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(WatchState(Mutex::new(None)))
        .manage(AutoState(Mutex::new(std::collections::HashSet::new())))
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
            read_run_draft,
            get_agent_concurrency,
            cost_ledger,
            delete_task,
            get_project_paths,
            set_project_paths,
            watch_tasks_dirs,
            remote_claims,
            plan_review_info,
            spawn_approve,
            spawn_reject,
            set_executor,
            invalidate_node,
            kill_node,
            human_signal,
            human_failed,
            run_node,
            run_auto,
            pipeline::list_pipeline_runs,
            pipeline::pipeline_run_details
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
