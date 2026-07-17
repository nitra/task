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

/// Зарезервовані метаключі `autonomy.yml` поза словником класів дій
/// (M5, спека 260714-cognitive-delegation): `owner` — handle власника
/// піддерева (як `assignee` у h.md, PII поза git), `since` — дата
/// делегування. Живуть у тому самому поліс-файлі, бо власник і конверт
/// автономії народжуються одним актом делегування.
const RESERVED_KEYS: [&str; 2] = ["owner", "since"];

/// Валідує `autonomy.yml` (M3): непорожні рядки без `#` — мають бути
/// `клас: auto|approve` або зарезервований метаключ із непорожнім
/// значенням. Дзеркалить парсер owner/src/autonomy.js — файл не входить
/// у контракт mt-core (a.md перезаписується цілком при зміні виконавця),
/// тож owner сам відповідає за цілісність свого шару.
fn validate_autonomy(yaml: &str) -> Result<(), String> {
    for line in yaml.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = line
            .split_once(':')
            .ok_or_else(|| format!("autonomy.yml: невалідний рядок {line:?}"))?;
        let (key, value) = (key.trim(), value.trim());
        if RESERVED_KEYS.contains(&key) {
            if value.is_empty() || value.split_whitespace().count() != 1 {
                return Err(format!(
                    "autonomy.yml: {key} — має бути один токен без пробілів, отримано {value:?}"
                ));
            }
            continue;
        }
        if value != "auto" && value != "approve" {
            return Err(format!(
                "autonomy.yml: клас {key} — невідомий гейт {value:?}"
            ));
        }
    }
    Ok(())
}

/// Handle власника з тексту `autonomy.yml` (None — рядка `owner:` немає).
fn parse_owner(yaml: &str) -> Option<String> {
    for line in yaml.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once(':') {
            if key.trim() == "owner" && !value.trim().is_empty() {
                return Some(value.trim().to_string());
            }
        }
    }
    None
}

/// Рекурсивно збирає `owner:`-розмітку лісу: тека вузла (містить task.md)
/// з autonomy.yml → запис `шлях вузла → handle`. Приховані теки
/// (`.worktrees` тощо) пропускаються.
fn collect_owners(root: &Path, dir: &Path, owners: &mut std::collections::HashMap<String, String>) {
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if !path.is_dir()
            || path
                .file_name()
                .and_then(|n| n.to_str())
                .is_none_or(|n| n.starts_with('.'))
        {
            continue;
        }
        if path.join("task.md").is_file() {
            if let Ok(yaml) = fs::read_to_string(path.join("autonomy.yml")) {
                if let Some(owner) = parse_owner(&yaml) {
                    if let Ok(rel) = path.strip_prefix(root) {
                        owners.insert(rel.to_string_lossy().replace('\\', "/"), owner);
                    }
                }
            }
        }
        collect_owners(root, &path, owners);
    }
}

/// `owner:`-розмітка воркспейсу одним проходом ФС — сировина scope-деривації
/// на фронті (порожня мапа = нерозмічений ліс, single-owner поведінка).
#[tauri::command]
fn scan_owners(tasks_dir: String) -> Result<std::collections::HashMap<String, String>, String> {
    let root = PathBuf::from(&tasks_dir);
    if !root.is_dir() {
        return Err(format!("tasks dir not found: {tasks_dir}"));
    }
    let mut owners = std::collections::HashMap::new();
    collect_owners(&root, &root, &mut owners);
    Ok(owners)
}

/// Handle власника застосунку (None — «Хто ти» ще не пройдено).
#[tauri::command]
fn get_identity() -> Option<String> {
    config::get_identity()
}

/// Зберігає handle власника у локальний конфіг (PII лишається поза git).
#[tauri::command]
fn set_identity(handle: String) -> Result<(), String> {
    config::set_identity(handle)
}

/// Активні snooze нагадувань поточної ідентичності (id → until, ISO 8601).
/// Персональний ритм — локально, не в git (M7, спека 260714 п. 12).
#[tauri::command]
fn get_snoozes() -> std::collections::HashMap<String, String> {
    config::get_snoozes(&chrono::Utc::now().to_rfc3339())
}

/// Глушить нагадування до `until` для поточної ідентичності (fail-closed
/// без неї). Snooze діє лише в мене — deadline у git не чіпається.
#[tauri::command]
fn snooze_reminder(id: String, until: String) -> Result<(), String> {
    config::snooze_reminder(id, until, &chrono::Utc::now().to_rfc3339())
}

/// Ефективний власник вузла з розмітки: найдовший префікс шляху,
/// що має `owner:` (фрактальне успадкування за графом задач).
fn effective_owner_of<'a>(
    owners: &'a std::collections::HashMap<String, String>,
    task_path: &str,
) -> Option<&'a str> {
    let segments: Vec<&str> = task_path.split('/').collect();
    (1..=segments.len())
        .rev()
        .find_map(|i| owners.get(&segments[..i].join("/")).map(String::as_str))
}

/// Fail-closed гейт власності write-дій (чиста логіка, M5): у розміченому
/// лісі діяти на вузлі може лише його effective owner; вузол без власника —
/// «нічия земля», діяти може будь-хто (інакше осиротіла гілка блокується
/// назавжди). Нерозмічений ліс — single-owner поведінка без перевірки.
fn check_scope(
    owners: &std::collections::HashMap<String, String>,
    task_path: &str,
    me: Option<&str>,
) -> Result<(), String> {
    if owners.is_empty() {
        return Ok(());
    }
    let Some(owner) = effective_owner_of(owners, task_path) else {
        return Ok(());
    };
    let me = me.ok_or(
        "ліс розмічений власниками, а твоя ідентичність не налаштована — виконай set_identity",
    )?;
    if owner == me {
        Ok(())
    } else {
        Err(format!(
            "вузол {task_path} належить {owner} — поза твоїм скоупом (запиши ескалацію замовникові через escalate)"
        ))
    }
}

/// Гейт власності для tauri-команд: розмітка читається з ФС, ідентичність —
/// з конфігу застосунку.
fn assert_owned(tasks_dir: &str, task_path: &str) -> Result<(), String> {
    let owners = scan_owners(tasks_dir.to_string())?;
    check_scope(&owners, task_path, config::get_identity().as_deref())
}

/// Власна політика вузла (порожній рядок — файлу немає, повне успадкування).
#[tauri::command]
fn read_autonomy(tasks_dir: String, task_path: String) -> Result<String, String> {
    mt_core::validate_name(&task_path)?;
    let path = PathBuf::from(&tasks_dir)
        .join(&task_path)
        .join("autonomy.yml");
    Ok(fs::read_to_string(&path).unwrap_or_default())
}

/// Пише власну політику вузла після валідації (fail-closed: битий рядок —
/// відмова без запису).
#[tauri::command]
fn write_autonomy(tasks_dir: String, task_path: String, yaml: String) -> Result<(), String> {
    mt_core::validate_name(&task_path)?;
    let dir = PathBuf::from(&tasks_dir).join(&task_path);
    if !dir.join("task.md").is_file() {
        return Err(format!("node not found: {task_path}"));
    }
    validate_autonomy(&yaml)?;
    assert_owned(&tasks_dir, &task_path)?;
    fs::write(dir.join("autonomy.yml"), yaml).map_err(|e| e.to_string())
}

/// Наступний вільний номер `<prefix>NNN.md` у директорії вузла.
fn next_nnn(dir: &Path, prefix: &str) -> u64 {
    let max = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            e.file_name()
                .to_str()?
                .strip_prefix(prefix)?
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
    assert_owned(&tasks_dir, &task_path)?;
    let children = mt_core::spawn::parse_children(&children_yaml)?;
    if children.is_empty() {
        return Err("## Children порожня — плановик не дав жодної дитини".to_string());
    }
    let file = format!("plan_{:03}.md", next_nnn(&dir, "plan_"));
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

/// Текст контракту вузла (task.md) — сировина дайджесту семантичного критика.
#[tauri::command]
fn read_task(tasks_dir: String, task_path: String) -> Result<String, String> {
    mt_core::validate_name(&task_path)?;
    let path = PathBuf::from(&tasks_dir).join(&task_path).join("task.md");
    fs::read_to_string(&path).map_err(|e| e.to_string())
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
    assert_owned(&tasks_dir, &task_path)?;
    mt_core::spawn::spawn_approve(&tasks_dir, &task_path)
}

/// Вердикт власника: reject плану з причиною → plan-rejected_NNN.md.
#[tauri::command]
fn spawn_reject(tasks_dir: String, task_path: String, reason: String) -> Result<String, String> {
    assert_owned(&tasks_dir, &task_path)?;
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
    assert_owned(&tasks_dir, &task_path)?;
    if let Err(e) = mt_core::signal::write_fact(&tasks_dir, &task_path, &summary, None) {
        // Порожній/битий Summary — справжня помилка; наявний fact — ні
        // (retry після Check-фейлу не перетирає його).
        if e.contains("Summary") {
            return Err(e);
        }
    }
    mt_core::signal::done(&tasks_dir, &task_path, "human")
}

/// Ескалація вузла (M6, спека 260714): immutable `escalation_NNN.md` —
/// «записка вгору» від власника гілки замовникові вузла; розвʼязання —
/// парний `escalation-resolved_NNN.md`. Derived state mt-core не змінюється:
/// маршрутизація черги деривується з цих файлів на app-рівні.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Escalation {
    pub nnn: u64,
    pub from: String,
    pub to: String,
    pub created_at: String,
    pub reason: String,
    pub resolved: bool,
    pub verdict: Option<String>,
}

/// Значення ключа у простому YAML-фронтматері (`---`-блок на початку файлу).
fn frontmatter_value(text: &str, key: &str) -> Option<String> {
    let mut inside = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            if inside {
                return None;
            }
            inside = true;
            continue;
        }
        if inside {
            if let Some((k, v)) = trimmed.split_once(':') {
                if k.trim() == key && !v.trim().is_empty() {
                    return Some(v.trim().to_string());
                }
            }
        }
    }
    None
}

/// Тіло секції `## <name>` (до наступного `## ` або кінця файлу).
fn section_body(text: &str, name: &str) -> String {
    let header = format!("## {name}");
    let Some(start) = text.find(&header) else {
        return String::new();
    };
    let after = &text[start + header.len()..];
    let end = after.find("\n## ").unwrap_or(after.len());
    after[..end].trim().to_string()
}

/// Розбирає пару файлів однієї ескалації (сирий текст + опційний resolved).
fn parse_escalation(nnn: u64, raw: &str, resolved_raw: Option<&str>) -> Option<Escalation> {
    Some(Escalation {
        nnn,
        from: frontmatter_value(raw, "from")?,
        to: frontmatter_value(raw, "to")?,
        created_at: frontmatter_value(raw, "created_at").unwrap_or_default(),
        reason: section_body(raw, "Reason"),
        resolved: resolved_raw.is_some(),
        verdict: resolved_raw.map(|t| section_body(t, "Verdict")),
    })
}

/// Ескалації однієї теки вузла: `escalation_NNN.md` + resolved-двійники.
fn node_escalations(dir: &Path) -> Vec<Escalation> {
    let mut found: Vec<Escalation> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name();
            let nnn: u64 = name
                .to_str()?
                .strip_prefix("escalation_")?
                .strip_suffix(".md")?
                .parse()
                .ok()?;
            let raw = fs::read_to_string(e.path()).ok()?;
            let resolved =
                fs::read_to_string(dir.join(format!("escalation-resolved_{nnn:03}.md"))).ok();
            parse_escalation(nnn, &raw, resolved.as_deref())
        })
        .collect();
    found.sort_by_key(|e| e.nnn);
    found
}

/// Рекурсивно збирає ескалації лісу: `шлях вузла → серія ескалацій`.
fn collect_escalations(
    root: &Path,
    dir: &Path,
    acc: &mut std::collections::HashMap<String, Vec<Escalation>>,
) {
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if !path.is_dir()
            || path
                .file_name()
                .and_then(|n| n.to_str())
                .is_none_or(|n| n.starts_with('.'))
        {
            continue;
        }
        if path.join("task.md").is_file() {
            let series = node_escalations(&path);
            if !series.is_empty() {
                if let Ok(rel) = path.strip_prefix(root) {
                    acc.insert(rel.to_string_lossy().replace('\\', "/"), series);
                }
            }
        }
        collect_escalations(root, &path, acc);
    }
}

/// Ескалації воркспейсу одним проходом ФС — сировина маршрутизації черги
/// (відкрита ескалація зʼявляється у черзі адресата і зникає з черги автора).
#[tauri::command]
fn scan_escalations(
    tasks_dir: String,
) -> Result<std::collections::HashMap<String, Vec<Escalation>>, String> {
    let root = PathBuf::from(&tasks_dir);
    if !root.is_dir() {
        return Err(format!("tasks dir not found: {tasks_dir}"));
    }
    let mut acc = std::collections::HashMap::new();
    collect_escalations(&root, &root, &mut acc);
    Ok(acc)
}

/// Один handle: непорожній, один токен без пробілів (як owner у autonomy.yml).
fn validate_handle(value: &str, field: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.split_whitespace().count() != 1 {
        return Err(format!(
            "{field} — має бути один handle без пробілів, отримано {value:?}"
        ));
    }
    Ok(())
}

/// Ядро ескалації з явним `from` (чиста ФС-логіка — тестується без конфігу).
fn escalate_as(
    tasks_dir: &str,
    task_path: &str,
    from: &str,
    to: &str,
    reason: &str,
) -> Result<String, String> {
    mt_core::validate_name(task_path)?;
    let dir = PathBuf::from(tasks_dir).join(task_path);
    if !dir.join("task.md").is_file() {
        return Err(format!("node not found: {task_path}"));
    }
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(
            "ескалація без записки не проходить: опиши, що сталося, що ти спробував і що просиш"
                .to_string(),
        );
    }
    validate_handle(to, "to")?;
    if from == to {
        return Err(
            "ескалація самому собі не має сенсу — адресат мусить бути замовником вузла"
                .to_string(),
        );
    }
    if node_escalations(&dir).iter().any(|e| !e.resolved) {
        return Err(format!(
            "у вузла {task_path} вже є відкрита ескалація — дочекайся вердикту"
        ));
    }
    let file = format!("escalation_{:03}.md", next_nnn(&dir, "escalation_"));
    let created_at = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    let body = format!(
        "---\nschema_version: 1\nfrom: {from}\nto: {to}\ncreated_at: {created_at}\n---\n\n## Reason\n\n{reason}\n"
    );
    fs::write(dir.join(&file), body).map_err(|e| e.to_string())?;
    Ok(file)
}

/// Ескалація вгору (M6): власник гілки вичерпав свої опції і передає рішення
/// замовникові. Записка (`## Reason`) обовʼязкова — fail-closed без неї:
/// голий факт без «що я спробував» провокує rubber-stamping або
/// мікроменеджмент. `from` — ідентичність застосунку, не параметр.
#[tauri::command]
fn escalate(
    tasks_dir: String,
    task_path: String,
    to: String,
    reason: String,
) -> Result<String, String> {
    let from = config::get_identity()
        .ok_or("ідентичність не налаштована — виконай set_identity перед ескалацією")?;
    assert_owned(&tasks_dir, &task_path)?;
    escalate_as(&tasks_dir, &task_path, &from, &to, &reason)
}

/// Ядро вердикту по ескалації з явним `me` (чиста ФС-логіка).
fn resolve_escalation_as(
    tasks_dir: &str,
    task_path: &str,
    me: &str,
    nnn: u64,
    verdict: &str,
) -> Result<String, String> {
    mt_core::validate_name(task_path)?;
    let dir = PathBuf::from(tasks_dir).join(task_path);
    let verdict = verdict.trim();
    if verdict.is_empty() {
        return Err("вердикт порожній — поясни рішення власникові гілки".to_string());
    }
    let series = node_escalations(&dir);
    let escalation = series
        .iter()
        .find(|e| e.nnn == nnn)
        .ok_or_else(|| format!("ескалації {nnn:03} у вузла {task_path} немає"))?;
    if escalation.resolved {
        return Err(format!("ескалацію {nnn:03} вже розвʼязано"));
    }
    if me != escalation.to {
        return Err(format!(
            "ескалація адресована {} — вердикт може дати лише адресат",
            escalation.to
        ));
    }
    let file = format!("escalation-resolved_{nnn:03}.md");
    let created_at = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    let body = format!(
        "---\nschema_version: 1\nfrom: {me}\nescalation_ref: escalation_{nnn:03}.md\ncreated_at: {created_at}\n---\n\n## Verdict\n\n{verdict}\n"
    );
    fs::write(dir.join(&file), body).map_err(|e| e.to_string())?;
    Ok(file)
}

/// Вердикт замовника по ескалації: immutable `escalation-resolved_NNN.md`.
/// Розвʼязати може лише адресат (`to`) — це його рішення, не власника гілки.
#[tauri::command]
fn resolve_escalation(
    tasks_dir: String,
    task_path: String,
    nnn: u64,
    verdict: String,
) -> Result<String, String> {
    let me =
        config::get_identity().ok_or("ідентичність не налаштована — виконай set_identity")?;
    resolve_escalation_as(&tasks_dir, &task_path, &me, nnn, &verdict)
}

/// Атомарний акт делегування (M6, оргнапрям-агностичний): виконавчий прапор
/// (`h.md` людині / `a.md` машині — штатний механізм mt-core) + один
/// `autonomy.yml` межового вузла (`owner:` для людини + конверт автономії).
/// Уся валідація — до першого запису (fail-closed).
#[tauri::command]
fn delegate(
    tasks_dir: String,
    task_path: String,
    mode: mt_core::Mode,
    owner: Option<String>,
    autonomy_yaml: Option<String>,
    qualification: Option<String>,
) -> Result<String, String> {
    mt_core::validate_name(&task_path)?;
    let dir = PathBuf::from(&tasks_dir).join(&task_path);
    if !dir.join("task.md").is_file() {
        return Err(format!("node not found: {task_path}"));
    }
    let envelope = autonomy_yaml.unwrap_or_default();
    validate_autonomy(&envelope)?;
    let policy = match mode {
        mt_core::Mode::Human => {
            let owner = owner.ok_or("делегування людині без owner-handle не має сенсу")?;
            validate_handle(&owner, "owner")?;
            let since = chrono::Utc::now().format("%Y-%m-%d");
            format!("owner: {owner}\nsince: {since}\n{envelope}")
        }
        // Машина — не власник: ШІ-гілка лишається у моєму скоупі.
        mt_core::Mode::Agent => envelope,
    };
    validate_autonomy(&policy)?;
    assert_owned(&tasks_dir, &task_path)?;
    let flag = mt_core::write_executor_flag(&dir, mode, "AVG", &[], qualification.as_deref())?;
    if policy.trim().is_empty() {
        return Ok(flag.to_string());
    }
    fs::write(dir.join("autonomy.yml"), policy).map_err(|e| e.to_string())?;
    Ok(flag.to_string())
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
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_tasks,
            find_all_tasks_dirs,
            get_project_paths,
            set_project_paths,
            create_task,
            draft_plan,
            read_task,
            read_autonomy,
            write_autonomy,
            scan_owners,
            get_identity,
            set_identity,
            get_snoozes,
            snooze_reminder,
            scan_escalations,
            escalate,
            resolve_escalation,
            delegate,
            plan_review_info,
            spawn_approve,
            spawn_reject,
            human_done,
            watch_tasks_dirs
        ]);

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    // relaunch() після встановлення оновлення — щоб застосунок сам
    // перезапустився в нову версію, а не чекав ручного рестарту.
    let builder = builder.plugin(tauri_plugin_process::init());

    // ОС-нотифікації (M7): лише детерміновані події черги/дедлайнів +
    // ранковий дайджест — ніколи «LLM вирішив перервати» (спека 260714).
    let builder = builder.plugin(tauri_plugin_notification::init());

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
        fs::write(
            node.join("task.md"),
            "---\nschema_version: 1\n---\n\n## Task\n",
        )
        .unwrap();
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

    #[test]
    fn autonomy_roundtrips_and_missing_file_reads_empty() {
        let (tmp, _node) = goal_node();
        let tasks_dir = tmp.path().to_string_lossy().into_owned();

        assert_eq!(
            read_autonomy(tasks_dir.clone(), "goal".to_string()).unwrap(),
            ""
        );

        write_autonomy(
            tasks_dir.clone(),
            "goal".to_string(),
            "deploy: approve\nworktree_edit: auto\n".to_string(),
        )
        .unwrap();
        assert_eq!(
            read_autonomy(tasks_dir, "goal".to_string()).unwrap(),
            "deploy: approve\nworktree_edit: auto\n"
        );
    }

    #[test]
    fn autonomy_rejects_unknown_gate_without_writing() {
        let (tmp, node) = goal_node();
        let tasks_dir = tmp.path().to_string_lossy().into_owned();
        let err = write_autonomy(
            tasks_dir,
            "goal".to_string(),
            "deploy: sometimes\n".to_string(),
        )
        .unwrap_err();
        assert!(err.contains("невідомий гейт"));
        assert!(!Path::new(&node).join("autonomy.yml").exists());
    }

    #[test]
    fn autonomy_rejects_unknown_node() {
        let tmp = tempfile::tempdir().unwrap();
        let tasks_dir = tmp.path().to_string_lossy().into_owned();
        assert!(write_autonomy(
            tasks_dir,
            "ghost".to_string(),
            "deploy: approve\n".to_string()
        )
        .is_err());
    }

    #[test]
    fn autonomy_accepts_reserved_owner_and_since() {
        assert!(validate_autonomy("owner: olena\nsince: 2026-07-13\ndeploy: approve\n").is_ok());
        // owner з пробілами / порожній — відмова (handle — один токен)
        assert!(validate_autonomy("owner: Олена Коваль\n").is_err());
        assert!(validate_autonomy("owner:\n").is_err());
    }

    #[test]
    fn scan_owners_collects_marked_nodes_recursively() {
        let (tmp, node) = goal_node();
        let child = Path::new(&node).join("collect");
        fs::create_dir_all(&child).unwrap();
        fs::write(child.join("task.md"), "---\nschema_version: 1\n---\n").unwrap();
        fs::write(child.join("autonomy.yml"), "owner: olena\n").unwrap();
        // autonomy.yml без owner — не розмітка
        fs::write(Path::new(&node).join("autonomy.yml"), "deploy: approve\n").unwrap();

        let owners = scan_owners(tmp.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(owners.len(), 1);
        assert_eq!(
            owners.get("goal/collect").map(String::as_str),
            Some("olena")
        );
    }

    #[test]
    fn escalation_roundtrip_and_routing_fields() {
        let (tmp, node) = goal_node();
        let tasks_dir = tmp.path().to_string_lossy().into_owned();

        // без записки — fail-closed, файл не зʼявляється
        assert!(escalate_as(&tasks_dir, "goal", "olena", "vkozlov", "  ").is_err());
        assert!(node_escalations(Path::new(&node)).is_empty());

        let file = escalate_as(
            &tasks_dir,
            "goal",
            "olena",
            "vkozlov",
            "бюджет вичерпано двічі; прошу змінити scope до п'ятниці",
        )
        .unwrap();
        assert_eq!(file, "escalation_001.md");

        // повторна відкрита ескалація того самого вузла — відмова
        assert!(escalate_as(&tasks_dir, "goal", "olena", "vkozlov", "ще раз").is_err());

        let scanned = scan_escalations(tasks_dir.clone()).unwrap();
        let series = scanned.get("goal").unwrap();
        assert_eq!(series.len(), 1);
        assert_eq!(series[0].from, "olena");
        assert_eq!(series[0].to, "vkozlov");
        assert!(series[0].reason.contains("бюджет вичерпано"));
        assert!(!series[0].resolved);

        // вердикт може дати лише адресат
        assert!(resolve_escalation_as(&tasks_dir, "goal", "olena", 1, "ні").is_err());
        assert!(resolve_escalation_as(&tasks_dir, "goal", "vkozlov", 1, " ").is_err());
        resolve_escalation_as(&tasks_dir, "goal", "vkozlov", 1, "scope розширено").unwrap();

        let scanned = scan_escalations(tasks_dir.clone()).unwrap();
        let series = scanned.get("goal").unwrap();
        assert!(series[0].resolved);
        assert_eq!(series[0].verdict.as_deref(), Some("scope розширено"));

        // розвʼязану — вдруге не розвʼязати; нова серія відкривається далі
        assert!(resolve_escalation_as(&tasks_dir, "goal", "vkozlov", 1, "знову").is_err());
        let next = escalate_as(&tasks_dir, "goal", "olena", "vkozlov", "нове питання").unwrap();
        assert_eq!(next, "escalation_002.md");
    }

    #[test]
    fn escalate_rejects_self_and_multiword_addressee() {
        let (tmp, _node) = goal_node();
        let tasks_dir = tmp.path().to_string_lossy().into_owned();
        assert!(escalate_as(&tasks_dir, "goal", "olena", "olena", "записка").is_err());
        assert!(escalate_as(&tasks_dir, "goal", "olena", "Віктор Козлов", "записка").is_err());
    }

    #[test]
    fn delegate_human_writes_flag_and_ownership_atomically() {
        let (tmp, node) = goal_node();
        let tasks_dir = tmp.path().to_string_lossy().into_owned();

        let flag = delegate(
            tasks_dir.clone(),
            "goal".to_string(),
            mt_core::Mode::Human,
            Some("olena".to_string()),
            Some("deploy: approve\n".to_string()),
            Some("senior backend".to_string()),
        )
        .unwrap();
        assert_eq!(flag, "h.md");
        assert!(Path::new(&node).join("h.md").is_file());
        assert!(!Path::new(&node).join("a.md").exists());

        let policy = fs::read_to_string(Path::new(&node).join("autonomy.yml")).unwrap();
        assert!(policy.starts_with("owner: olena\nsince: "));
        assert!(policy.ends_with("deploy: approve\n"));

        let owners = scan_owners(tasks_dir).unwrap();
        assert_eq!(owners.get("goal").map(String::as_str), Some("olena"));
    }

    #[test]
    fn delegate_human_without_owner_or_with_bad_envelope_writes_nothing() {
        let (tmp, node) = goal_node();
        let tasks_dir = tmp.path().to_string_lossy().into_owned();

        assert!(delegate(
            tasks_dir.clone(),
            "goal".to_string(),
            mt_core::Mode::Human,
            None,
            None,
            None
        )
        .is_err());
        assert!(delegate(
            tasks_dir,
            "goal".to_string(),
            mt_core::Mode::Human,
            Some("olena".to_string()),
            Some("deploy: sometimes\n".to_string()),
            None
        )
        .is_err());
        assert!(!Path::new(&node).join("h.md").exists());
        assert!(!Path::new(&node).join("autonomy.yml").exists());
    }

    #[test]
    fn delegate_agent_keeps_branch_unowned() {
        let (tmp, node) = goal_node();
        let tasks_dir = tmp.path().to_string_lossy().into_owned();

        let flag = delegate(
            tasks_dir.clone(),
            "goal".to_string(),
            mt_core::Mode::Agent,
            None,
            Some("worktree_edit: auto\n".to_string()),
            None,
        )
        .unwrap();
        assert_eq!(flag, "a.md");
        assert!(Path::new(&node).join("a.md").is_file());
        // машина — не власник: розмітки owner: немає, гілка лишається моєю
        assert!(scan_owners(tasks_dir).unwrap().is_empty());
    }

    #[test]
    fn check_scope_unmarked_forest_allows_everyone() {
        let owners = std::collections::HashMap::new();
        assert!(check_scope(&owners, "goal", None).is_ok());
    }

    #[test]
    fn check_scope_enforces_effective_owner_with_inheritance() {
        let owners = std::collections::HashMap::from([("goal".to_string(), "olena".to_string())]);
        // дитина успадковує власника предка
        assert!(check_scope(&owners, "goal/collect", Some("olena")).is_ok());
        let err = check_scope(&owners, "goal/collect", Some("vkozlov")).unwrap_err();
        assert!(err.contains("olena"));
        // розмічений ліс без ідентичності — fail-closed
        assert!(check_scope(&owners, "goal", None).is_err());
        // «нічия земля»: вузол поза розміченими піддеревами — діяти можна
        assert!(check_scope(&owners, "orphan", Some("vkozlov")).is_ok());
    }
}
