use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    HumanPending,
    Waiting,
    Running,
    PendingAudit,
    Resolved,
    Failed,
    Invalidated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNode {
    pub id: String,
    pub path: String,
    pub state: TaskState,
    pub deps: Vec<String>,
    pub mode: String,
    pub budget_sec: Option<u64>,
    pub created_at: Option<String>,
    pub children: Vec<TaskNode>,
    pub is_composite: bool,
}

#[derive(Default)]
struct Frontmatter {
    created_at: Option<String>,
    budget_sec: Option<u64>,
    mode: String,
    deps: Vec<String>,
}

fn parse_frontmatter(content: &str) -> Frontmatter {
    let mut fm = Frontmatter::default();
    let lines: Vec<&str> = content.lines().collect();

    if lines.is_empty() || lines[0].trim() != "---" {
        return fm;
    }

    let end = lines[1..]
        .iter()
        .position(|l| l.trim() == "---")
        .map(|i| i + 1)
        .unwrap_or(lines.len());

    let mut in_deps = false;
    for line in &lines[1..end] {
        let t = line.trim();
        if t == "---" {
            break;
        }
        if t.starts_with("- ") {
            if in_deps {
                fm.deps.push(t[2..].trim().to_string());
            }
            continue;
        }
        in_deps = false;
        if let Some(pos) = t.find(':') {
            let key = t[..pos].trim();
            let val = t[pos + 1..].trim();
            match key {
                "created_at" => fm.created_at = Some(val.to_string()),
                "budget_sec" => fm.budget_sec = val.parse().ok(),
                "mode" => fm.mode = val.to_string(),
                "deps" => in_deps = true,
                _ => {}
            }
        }
    }

    fm
}

fn has_files_matching(dir: &Path, prefix: &str, suffix: &str) -> bool {
    fs::read_dir(dir).ok().map_or(false, |entries| {
        entries.flatten().any(|e| {
            let n = e.file_name();
            let s = n.to_string_lossy();
            s.starts_with(prefix) && s.ends_with(suffix)
        })
    })
}

fn has_pending_audit(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for e in entries.flatten() {
        let n = e.file_name();
        let s = n.to_string_lossy();
        if s.starts_with("pending-audit_") && s.ends_with(".md") {
            let nnn = &s["pending-audit_".len()..s.len() - 3];
            if !dir.join(format!("audit-result_{nnn}.md")).exists() {
                return true;
            }
        }
    }
    false
}

fn is_running_worktree(node_path: &str, project_root: &Path) -> bool {
    let worktrees = project_root.join(".worktrees");
    if !worktrees.is_dir() {
        return false;
    }
    let prefix = node_path.replace('/', "-").replace(' ', "-").to_lowercase();
    fs::read_dir(&worktrees).ok().map_or(false, |entries| {
        entries.flatten().any(|e| {
            e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                && e.file_name().to_string_lossy().starts_with(&prefix)
        })
    })
}

fn aggregate_composite_state(children: &[TaskNode]) -> TaskState {
    if children.iter().all(|c| c.state == TaskState::Resolved) {
        return TaskState::Resolved;
    }
    if children
        .iter()
        .any(|c| matches!(c.state, TaskState::Running | TaskState::PendingAudit))
    {
        return TaskState::Running;
    }
    if children.iter().any(|c| c.state == TaskState::Failed)
        && !children.iter().any(|c| c.state == TaskState::Running)
    {
        return TaskState::Failed;
    }
    TaskState::Waiting
}

fn detect_state(
    dir: &Path,
    mode: &str,
    children: &[TaskNode],
    node_path: &str,
    project_root: &Path,
) -> TaskState {
    if dir.join("invalidated").exists() {
        return TaskState::Invalidated;
    }
    if !children.is_empty() {
        return aggregate_composite_state(children);
    }
    if has_files_matching(dir, "outputs_", ".md") {
        return TaskState::Resolved;
    }
    if has_pending_audit(dir) {
        return TaskState::PendingAudit;
    }
    if is_running_worktree(node_path, project_root) {
        return TaskState::Running;
    }
    if has_files_matching(dir, "run_", ".md") {
        return TaskState::Failed;
    }
    if has_files_matching(dir, "plan_", ".md") || mode == "agent" {
        return TaskState::Waiting;
    }
    TaskState::HumanPending
}

fn scan_dir(dir: &Path, tasks_root: &Path, project_root: &Path) -> Option<TaskNode> {
    if !dir.join("task.md").exists() {
        return None;
    }

    let content = fs::read_to_string(dir.join("task.md")).unwrap_or_default();
    let fm = parse_frontmatter(&content);
    let mode = if fm.mode.is_empty() {
        "human".to_string()
    } else {
        fm.mode
    };

    let mut children: Vec<TaskNode> = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        let mut subdirs: Vec<_> = entries
            .flatten()
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .collect();
        subdirs.sort_by_key(|e| e.file_name());
        for sub in subdirs {
            if let Some(child) = scan_dir(&sub.path(), tasks_root, project_root) {
                children.push(child);
            }
        }
    }

    let is_composite = !children.is_empty();
    let id = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    let path = dir
        .strip_prefix(tasks_root)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| id.clone());

    let state = detect_state(dir, &mode, &children, &path, project_root);

    Some(TaskNode {
        id,
        path,
        state,
        deps: fm.deps,
        mode,
        budget_sec: fm.budget_sec,
        created_at: fm.created_at,
        children,
        is_composite,
    })
}

#[tauri::command]
fn scan_tasks(tasks_dir: String) -> Result<Vec<TaskNode>, String> {
    let dir = PathBuf::from(&tasks_dir);
    if !dir.exists() {
        return Err(format!("Directory not found: {tasks_dir}"));
    }
    let project_root = dir.parent().unwrap_or(&dir).to_path_buf();

    let mut entries: Vec<_> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .collect();
    entries.sort_by_key(|e| e.file_name());

    let nodes = entries
        .iter()
        .filter_map(|e| scan_dir(&e.path(), &dir, &project_root))
        .collect();

    Ok(nodes)
}

#[tauri::command]
fn find_tasks_dir() -> Result<String, String> {
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let mut dir: &Path = &cwd;
    let mut depth = 0u8;

    loop {
        let config_path = dir.join(".n-cursor.json");
        if config_path.exists() {
            if let Ok(content) = fs::read_to_string(&config_path) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(td) = v.get("tasks_dir").and_then(|v| v.as_str()) {
                        let full = dir.join(td);
                        if full.is_dir() {
                            return Ok(full.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        }

        let tasks = dir.join("tasks");
        if tasks.is_dir() {
            let has_task = fs::read_dir(&tasks).ok().map_or(false, |entries| {
                entries.flatten().any(|e| {
                    e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                        && e.path().join("task.md").exists()
                })
            });
            if has_task {
                return Ok(tasks.to_string_lossy().into_owned());
            }
        }

        depth += 1;
        if depth >= 8 {
            break;
        }
        match dir.parent() {
            Some(p) => dir = p,
            None => break,
        }
    }

    Err("Could not auto-detect tasks directory. Please specify the path manually.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![scan_tasks, find_tasks_dir]);

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
