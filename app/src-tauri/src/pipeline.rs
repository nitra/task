use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::git_util;

/// Уніфікований рядок статусу CI (GitHub Actions workflow або Azure Pipelines
/// pipeline) — одна модель для обох провайдерів, щоб фронтенд не розгалужував
/// логіку за `provider`.
#[derive(serde::Serialize, Clone)]
pub struct PipelineRunSummary {
    pub name: String,
    pub provider: String,
    pub status: String,
    pub conclusion: Option<String>,
    pub updated_at: String,
    pub url: String,
    pub run_id: String,
}

#[derive(serde::Serialize)]
pub struct RunJob {
    pub name: String,
    pub conclusion: Option<String>,
    pub message: Option<String>,
}

#[derive(serde::Serialize)]
pub struct RunDetails {
    pub jobs: Vec<RunJob>,
    pub url: String,
    pub conclusion: Option<String>,
}

/// Список усіх CI workflows/pipelines репозиторію, кожен зі статусом
/// останнього рану — GitHub Actions і Azure Pipelines перевіряються незалежно
/// (репо може мати обидва: власне GitHub workflows і паралельне дзеркало в
/// Azure DevOps через sync-екшн, з org/project поза git remote).
#[tauri::command]
pub fn list_pipeline_runs(tasks_dir: String) -> Result<Vec<PipelineRunSummary>, String> {
    let repo_root = git_util::repo_root(&tasks_dir)?;
    let mut summaries = Vec::new();

    if has_yaml_files(&repo_root.join(".github/workflows")) {
        summaries.extend(fetch_github_runs(&repo_root)?);
    }
    if has_yaml_files(&repo_root.join(".azurepipelines"))
        || repo_root.join("azure-pipelines.yml").is_file()
    {
        summaries.extend(fetch_azure_runs(&repo_root)?);
    }

    Ok(summaries)
}

/// Деталі одного рану: список джобів (GitHub) або лише conclusion+посилання
/// (Azure v1 — per-job breakdown вимагає Timeline API поза `az pipelines`).
#[tauri::command]
pub fn pipeline_run_details(
    tasks_dir: String,
    run_id: String,
    provider: String,
) -> Result<RunDetails, String> {
    let repo_root = git_util::repo_root(&tasks_dir)?;
    match provider.as_str() {
        "github" => github_run_details(&repo_root, &run_id),
        "azure" => azure_run_details(&run_id),
        other => Err(format!("unknown provider: {other}")),
    }
}

/// `dir` існує і містить хоча б один `*.yml`/`*.yaml` — евристика "цей CI тут
/// налаштований", без парсингу вмісту файлів.
fn has_yaml_files(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.filter_map(Result::ok).any(|e| {
        let ext = e
            .path()
            .extension()
            .and_then(|s| s.to_str())
            .map(str::to_lowercase);
        matches!(ext.as_deref(), Some("yml") | Some("yaml"))
    })
}

/// Виконує зовнішню CLI-команду (`gh`/`az`), повертає stdout або stderr як помилку.
fn run_cli(program: &str, args: &[&str], cwd: &Path) -> Result<String, String> {
    let out = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| format!("{program}: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `owner/repo` з `git remote get-url origin`, для GitHub-хостингу.
fn github_owner_repo(repo_root: &Path) -> Result<(String, String), String> {
    let out = Command::new("git")
        .args([
            "-C",
            &repo_root.to_string_lossy(),
            "remote",
            "get-url",
            "origin",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("no origin remote configured".to_string());
    }
    let url = String::from_utf8_lossy(&out.stdout).trim().to_string();
    parse_github_remote(&url)
}

/// Парсить `git@github.com:owner/repo.git` та `https://github.com/owner/repo(.git)` форми.
fn parse_github_remote(url: &str) -> Result<(String, String), String> {
    let trimmed = url.trim_end_matches(".git");
    let path = trimmed
        .split_once("github.com:")
        .or_else(|| trimmed.split_once("github.com/"))
        .map(|(_, rest)| rest)
        .ok_or_else(|| format!("not a github.com remote: {url}"))?;
    let mut parts = path.splitn(2, '/');
    let owner = parts.next().filter(|s| !s.is_empty());
    let repo = parts.next().filter(|s| !s.is_empty());
    match (owner, repo) {
        (Some(o), Some(r)) => Ok((o.to_string(), r.to_string())),
        _ => Err(format!("could not parse owner/repo from: {url}")),
    }
}

#[derive(serde::Deserialize)]
struct GhWorkflow {
    id: i64,
    name: String,
    state: String,
}

#[derive(serde::Deserialize, Default)]
struct GhRun {
    conclusion: Option<String>,
    status: String,
    #[serde(rename = "updatedAt")]
    updated_at: String,
    url: String,
    #[serde(rename = "databaseId")]
    database_id: i64,
}

/// Усі активні GitHub Actions workflows репозиторію + останній ран кожного.
/// Двокроковий підхід (а не один `gh run list --limit N`): фіксований ліміт
/// ранів може не покривати рідко запускувані workflows (release/nightly) —
/// `gh workflow list` натомість дає повний список визначень.
fn fetch_github_runs(repo_root: &Path) -> Result<Vec<PipelineRunSummary>, String> {
    let (owner, repo) = github_owner_repo(repo_root)?;
    let slug = format!("{owner}/{repo}");
    let out = run_cli(
        "gh",
        &[
            "workflow",
            "list",
            "--repo",
            &slug,
            "--json",
            "id,name,state",
            "--limit",
            "100",
        ],
        repo_root,
    )?;
    let workflows: Vec<GhWorkflow> = serde_json::from_str(&out).map_err(|e| e.to_string())?;

    let handles: Vec<_> = workflows
        .into_iter()
        .filter(|w| w.state == "active")
        .map(|w| {
            let slug = slug.clone();
            let cwd = repo_root.to_path_buf();
            std::thread::spawn(move || -> PipelineRunSummary {
                let wf_id = w.id.to_string();
                let result = run_cli(
                    "gh",
                    &[
                        "run",
                        "list",
                        "--repo",
                        &slug,
                        "--workflow",
                        &wf_id,
                        "--limit",
                        "1",
                        "--json",
                        "conclusion,status,updatedAt,url,databaseId",
                    ],
                    &cwd,
                )
                .ok()
                .and_then(|out| serde_json::from_str::<Vec<GhRun>>(&out).ok())
                .and_then(|mut runs| {
                    if runs.is_empty() {
                        None
                    } else {
                        Some(runs.remove(0))
                    }
                });

                match result {
                    Some(run) => PipelineRunSummary {
                        name: w.name,
                        provider: "github".to_string(),
                        status: run.status,
                        conclusion: run.conclusion,
                        updated_at: run.updated_at,
                        url: run.url,
                        run_id: run.database_id.to_string(),
                    },
                    None => PipelineRunSummary {
                        name: w.name,
                        provider: "github".to_string(),
                        status: "no_runs".to_string(),
                        conclusion: None,
                        updated_at: String::new(),
                        url: String::new(),
                        run_id: String::new(),
                    },
                }
            })
        })
        .collect();

    Ok(handles.into_iter().filter_map(|h| h.join().ok()).collect())
}

fn github_run_details(repo_root: &Path, run_id: &str) -> Result<RunDetails, String> {
    let (owner, repo) = github_owner_repo(repo_root)?;
    let slug = format!("{owner}/{repo}");
    let out = run_cli(
        "gh",
        &[
            "run",
            "view",
            run_id,
            "--repo",
            &slug,
            "--json",
            "jobs,conclusion,url",
        ],
        repo_root,
    )?;
    #[derive(serde::Deserialize)]
    struct GhJob {
        name: String,
        conclusion: Option<String>,
    }
    #[derive(serde::Deserialize)]
    struct GhRunView {
        jobs: Vec<GhJob>,
        conclusion: Option<String>,
        url: String,
    }
    let view: GhRunView = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    let has_failed_job = view
        .jobs
        .iter()
        .any(|j| j.conclusion.as_deref() == Some("failure"));
    let log_excerpts = if has_failed_job {
        github_failed_log_excerpts(repo_root, &slug, run_id)
    } else {
        HashMap::new()
    };
    Ok(RunDetails {
        jobs: view
            .jobs
            .into_iter()
            .map(|j| {
                let message = log_excerpts.get(&j.name).cloned();
                RunJob {
                    name: j.name,
                    conclusion: j.conclusion,
                    message,
                }
            })
            .collect(),
        url: view.url,
        conclusion: view.conclusion,
    })
}

/// Уривок логу кожного провального джоба навколо останнього `##[error]`-маркера
/// — без відкриття браузера видно САМЕ повідомлення інструменту (напр.
/// stylelint-помилку), не лише узагальнений "Process completed with exit code
/// N". Вікно навколо маркера, а не хвіст файлу: GitHub Actions пише
/// "Post job cleanup" (git config тощо) ПІСЛЯ фактичної помилки, тож
/// останні N рядків файлу — це прибирання, а не причина провалу. Джерело —
/// `gh run view --log-failed` (рядки `job\tstep\ttimestamp message`).
fn github_failed_log_excerpts(
    repo_root: &Path,
    slug: &str,
    run_id: &str,
) -> HashMap<String, String> {
    const LINES_BEFORE_ERROR: usize = 15;
    const LINES_AFTER_ERROR: usize = 3;
    const FALLBACK_TAIL: usize = 40;
    let Ok(out) = run_cli(
        "gh",
        &["run", "view", run_id, "--repo", slug, "--log-failed"],
        repo_root,
    ) else {
        return HashMap::new();
    };
    let mut by_job: HashMap<String, Vec<String>> = HashMap::new();
    for line in out.lines() {
        let mut parts = line.splitn(3, '\t');
        let job = parts.next().unwrap_or("");
        let _step = parts.next().unwrap_or("");
        let rest = parts.next().unwrap_or("");
        let message = rest.split_once(' ').map_or(rest, |(_, m)| m);
        by_job
            .entry(job.to_string())
            .or_default()
            .push(strip_ansi(message));
    }
    by_job
        .into_iter()
        .map(|(job, lines)| {
            let (start, end) = match lines.iter().rposition(|l| l.contains("##[error]")) {
                Some(i) => (
                    i.saturating_sub(LINES_BEFORE_ERROR),
                    (i + LINES_AFTER_ERROR + 1).min(lines.len()),
                ),
                None => (lines.len().saturating_sub(FALLBACK_TAIL), lines.len()),
            };
            (job, lines[start..end].join("\n"))
        })
        .collect()
}

/// Знімає ANSI escape-послідовності кольору з рядка логу. `gh run view
/// --log-failed` віддає ESC не як керуючий байт `\x1b`, а вже як видимий
/// літерал `^[` (два символи) — тож спершу нормалізуємо його в реальний ESC,
/// а тоді знімаємо звичну CSI-послідовність `ESC[...<літера>`.
fn strip_ansi(s: &str) -> String {
    let normalized = s.replace("^[", "\u{1b}");
    let mut out = String::with_capacity(normalized.len());
    let mut chars = normalized.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for c2 in chars.by_ref() {
                if c2.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[derive(serde::Deserialize)]
struct AzPipeline {
    id: i64,
    name: String,
}

#[derive(serde::Deserialize, Default)]
struct AzRun {
    id: i64,
    status: String,
    result: Option<String>,
    #[serde(rename = "finishTime")]
    finish_time: Option<String>,
}

/// Читає `organization`/`project` з `az devops configure -l` (глобальні
/// дефолти CLI — репо не знає свій ADO org/project напряму, лише через них).
fn azure_defaults() -> Result<(String, String), String> {
    let out = run_cli(
        "az",
        &["devops", "configure", "-l"],
        &std::env::current_dir().unwrap_or_default(),
    )?;
    let mut organization = None;
    let mut project = None;
    for line in out.lines() {
        if let Some(v) = line.strip_prefix("organization = ") {
            organization = Some(v.trim().to_string());
        } else if let Some(v) = line.strip_prefix("project = ") {
            project = Some(v.trim().to_string());
        }
    }
    match (organization, project) {
        (Some(o), Some(p)) => Ok((o, p)),
        _ => Err(
            "Azure DevOps organization/project not configured — run `az devops configure --defaults organization=<url> project=<name>`"
                .to_string(),
        ),
    }
}

fn azure_web_url(organization: &str, project: &str, run_id: i64) -> String {
    format!(
        "{}/{}/_build/results?buildId={run_id}",
        organization.trim_end_matches('/'),
        project.replace(' ', "%20")
    )
}

/// Усі pipelines проєкту, прив'язані до цього репозиторію (ADO tfsgit-дзеркало
/// з іменем = basename репо), + останній ран кожного. `--detect false`
/// обов'язковий: без нього `az` намагається автовизначити org/repo з поточного
/// git remote і фейлить/бреше, якщо cwd — не сам ADO-репозиторій.
fn fetch_azure_runs(repo_root: &Path) -> Result<Vec<PipelineRunSummary>, String> {
    let (organization, project) = azure_defaults()?;
    let repo_name = repo_root
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("cannot determine repo directory name")?;

    let out = run_cli(
        "az",
        &[
            "pipelines",
            "list",
            "--repository",
            repo_name,
            "--repository-type",
            "tfsgit",
            "--query-order",
            "ModifiedDesc",
            "--detect",
            "false",
            "-o",
            "json",
        ],
        repo_root,
    )?;
    let pipelines: Vec<AzPipeline> = serde_json::from_str(&out).map_err(|e| e.to_string())?;

    let handles: Vec<_> = pipelines
        .into_iter()
        .map(|p| {
            let cwd = repo_root.to_path_buf();
            let organization = organization.clone();
            let project = project.clone();
            std::thread::spawn(move || -> PipelineRunSummary {
                let id_str = p.id.to_string();
                let run = run_cli(
                    "az",
                    &[
                        "pipelines",
                        "runs",
                        "list",
                        "--pipeline-ids",
                        &id_str,
                        "--top",
                        "1",
                        "--detect",
                        "false",
                        "-o",
                        "json",
                    ],
                    &cwd,
                )
                .ok()
                .and_then(|out| serde_json::from_str::<Vec<AzRun>>(&out).ok())
                .and_then(|mut runs| {
                    if runs.is_empty() {
                        None
                    } else {
                        Some(runs.remove(0))
                    }
                });

                match run {
                    Some(run) => PipelineRunSummary {
                        name: p.name,
                        provider: "azure".to_string(),
                        status: normalize_azure_status(&run.status),
                        conclusion: run.result.as_deref().map(normalize_azure_result),
                        updated_at: run.finish_time.unwrap_or_default(),
                        url: azure_web_url(&organization, &project, run.id),
                        run_id: run.id.to_string(),
                    },
                    None => PipelineRunSummary {
                        name: p.name,
                        provider: "azure".to_string(),
                        status: "no_runs".to_string(),
                        conclusion: None,
                        updated_at: String::new(),
                        url: String::new(),
                        run_id: String::new(),
                    },
                }
            })
        })
        .collect();

    Ok(handles.into_iter().filter_map(|h| h.join().ok()).collect())
}

/// Azure `status` (`completed`/`inProgress`/`notStarted`/...) → той самий
/// словник, що GitHub Actions (`completed`/`in_progress`/`queued`).
fn normalize_azure_status(status: &str) -> String {
    match status {
        "completed" => "completed".to_string(),
        "inProgress" => "in_progress".to_string(),
        "notStarted" => "queued".to_string(),
        other => other.to_string(),
    }
}

/// Azure `result` (`succeeded`/`failed`/`canceled`/`partiallySucceeded`) →
/// GitHub-сумісний `conclusion` (`success`/`failure`/`cancelled`), щоб фронтенд
/// не розгалужував логіку за провайдером.
fn normalize_azure_result(result: &str) -> String {
    match result {
        "succeeded" => "success".to_string(),
        "failed" => "failure".to_string(),
        "canceled" => "cancelled".to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_github_ssh_remote() {
        assert_eq!(
            parse_github_remote("git@github.com:nitra/task.git").unwrap(),
            ("nitra".to_string(), "task".to_string())
        );
    }

    #[test]
    fn parses_github_https_remote() {
        assert_eq!(
            parse_github_remote("https://github.com/nitra/task.git").unwrap(),
            ("nitra".to_string(), "task".to_string())
        );
        assert_eq!(
            parse_github_remote("https://github.com/nitra/task").unwrap(),
            ("nitra".to_string(), "task".to_string())
        );
    }

    #[test]
    fn rejects_non_github_remote() {
        assert!(parse_github_remote("git@dev.azure.com:v3/org/project/repo").is_err());
    }

    #[test]
    fn normalizes_azure_status_and_result() {
        assert_eq!(normalize_azure_status("inProgress"), "in_progress");
        assert_eq!(normalize_azure_status("notStarted"), "queued");
        assert_eq!(normalize_azure_result("succeeded"), "success");
        assert_eq!(normalize_azure_result("failed"), "failure");
        assert_eq!(normalize_azure_result("canceled"), "cancelled");
    }

    #[test]
    fn builds_azure_web_url_with_encoded_project_spaces() {
        assert_eq!(
            azure_web_url("https://dev.azure.com/contoso", "My SFA", 42),
            "https://dev.azure.com/contoso/My%20SFA/_build/results?buildId=42"
        );
    }

    #[test]
    fn strips_ansi_color_codes() {
        assert_eq!(
            strip_ansi("\u{1b}[31m\u{1b}[31m✖\u{1b}[39m  Missing generic font family"),
            "✖  Missing generic font family"
        );
        assert_eq!(strip_ansi("plain text, no codes"), "plain text, no codes");
    }

    #[test]
    fn strips_gh_literal_caret_escape_codes() {
        // `gh run view --log-failed` emits ESC as the visible two-char literal
        // `^[`, not the real control byte — confirmed against a live failing run.
        assert_eq!(
            strip_ansi("^[[2m14:16^[[22m  ^[[31m^[[31m✖^[[39m  Missing generic font family"),
            "14:16  ✖  Missing generic font family"
        );
    }

    #[test]
    fn windows_log_excerpt_around_last_error_marker_not_tail() {
        let lines: Vec<String> = (0..20).map(|i| format!("line {i}")).collect();
        let mut with_error = lines.clone();
        with_error[10] = "##[error]boom".to_string();
        with_error.extend([
            "Post job cleanup.".to_string(),
            "Post job cleanup.".to_string(),
        ]);
        let error_idx = with_error
            .iter()
            .rposition(|l| l.contains("##[error]"))
            .unwrap();
        assert_eq!(error_idx, 10);
        let start = error_idx.saturating_sub(15);
        let end = (error_idx + 3 + 1).min(with_error.len());
        let excerpt = with_error[start..end].join("\n");
        assert!(excerpt.contains("##[error]boom"));
        assert!(!excerpt.contains("Post job cleanup"));
    }
}

fn azure_run_details(run_id: &str) -> Result<RunDetails, String> {
    let (organization, project) = azure_defaults()?;
    let out = run_cli(
        "az",
        &[
            "pipelines",
            "runs",
            "show",
            "--id",
            run_id,
            "--detect",
            "false",
            "-o",
            "json",
        ],
        &PathBuf::from("."),
    )?;
    let run: AzRun = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    Ok(RunDetails {
        jobs: azure_run_jobs(&organization, &project, run_id),
        url: azure_web_url(&organization, &project, run.id),
        conclusion: run.result.as_deref().map(normalize_azure_result),
    })
}

#[derive(serde::Deserialize)]
struct AzTimelineIssue {
    message: Option<String>,
}

#[derive(serde::Deserialize)]
struct AzTimelineRecord {
    name: String,
    #[serde(rename = "type")]
    record_type: String,
    result: Option<String>,
    issues: Option<Vec<AzTimelineIssue>>,
}

#[derive(serde::Deserialize)]
struct AzTimeline {
    records: Vec<AzTimelineRecord>,
}

/// Job/Task-записи Timeline API з нетривіальним результатом, кожен зі своїм
/// `issues[].message` (реальна причина: напр. "agent stopped responding",
/// код помилки таски) — без відкриття браузера. `az pipelines runs show` сам
/// per-job breakdown не дає (лише агрегований result рану), Timeline — дає.
/// Best-effort: недоступність (мережа/права) → порожній список, не помилка.
fn azure_run_jobs(organization: &str, project: &str, run_id: &str) -> Vec<RunJob> {
    let project_param = format!("project={project}");
    let build_param = format!("buildId={run_id}");
    let Ok(out) = run_cli(
        "az",
        &[
            "devops",
            "invoke",
            "--area",
            "build",
            "--resource",
            "Timeline",
            "--route-parameters",
            &project_param,
            &build_param,
            "--organization",
            organization,
            "--api-version",
            "7.1",
            "-o",
            "json",
        ],
        &PathBuf::from("."),
    ) else {
        return Vec::new();
    };
    let Ok(timeline) = serde_json::from_str::<AzTimeline>(&out) else {
        return Vec::new();
    };
    timeline
        .records
        .into_iter()
        .filter(|r| matches!(r.record_type.as_str(), "Job" | "Task"))
        .filter(|r| {
            !matches!(
                r.result.as_deref(),
                None | Some("succeeded") | Some("skipped")
            )
        })
        .map(|r| {
            let message = r
                .issues
                .unwrap_or_default()
                .into_iter()
                .filter_map(|i| i.message)
                .collect::<Vec<_>>()
                .join("\n");
            RunJob {
                name: r.name,
                conclusion: r.result.as_deref().map(normalize_azure_result),
                message: if message.is_empty() {
                    None
                } else {
                    Some(message)
                },
            }
        })
        .collect()
}
