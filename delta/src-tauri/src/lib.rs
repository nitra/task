//! Delta-бекенд: тонкий fs-шар над `.mt/mandates.yaml` і `runs/*/decisions/`
//! — читає/пише сирі байти, а деривацію (парсинг, зрізи, квіз-гейт, підпис)
//! робить спільний JS-шар (delta/src/*.js), і в GUI, і в CLI. Rust свідомо
//! не парсить YAML/markdown тут: контракт мандатів/decision-request/квізів —
//! мок за docs/specs/260809-delta-app.md (рішення Ж), майбутня заміна —
//! napi-виклики mandate-crate з mt-rust, не Rust-код цього застосунку.
//! M1 додає: сканування `runs/*/decisions/` (`scan_decisions`), універсальні
//! `read_text_file`/`write_text_file` для квіз-/approval-файлів, ключ
//! пристрою (`read_device_key`/`write_device_key` — сам Ed25519 рахує
//! `src/signing.js` через Web Crypto, Rust лише читає/пише сирий JSON) і
//! конфіг локального LLM-ендпоінта квіз-генератора.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;

mod config;

/// Один файл у `decisions/`-директорії run-а — сирий вміст, парсинг робить
/// `src/decisions.js`/`src/quiz.js` (той самий JS-шар, що читає decision-request).
#[derive(Serialize)]
struct FileEntry {
    name: String,
    content: String,
}

/// Одна `runs/{run-id}/decisions/` директорія зі скану — `dir` абсолютний,
/// щоб JS-шар міг будувати шляхи запису (`write_text_file`) без додаткового
/// round-trip до Rust за самим шляхом.
#[derive(Serialize)]
struct DecisionsDir {
    dir: String,
    files: Vec<FileEntry>,
}

/// Конфіг локального LLM-ендпоінта квіз-генератора (M1: делегований
/// `src/quiz.js` `defaultLlmConfig()`, коли поля відсутні — camelCase на
/// проводі відповідає JS-стороні, а не серіалізації Rust-полів за замовчуванням).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmConfig {
    base_url: Option<String>,
    model: Option<String>,
}

/// Handle ідентичності застосунку (None — «Хто ти» ще не пройдено).
#[tauri::command]
fn get_identity() -> Option<String> {
    config::get_identity()
}

/// Зберігає handle ідентичності у локальний конфіг (PII лишається поза git).
#[tauri::command]
fn set_identity(handle: String) -> Result<(), String> {
    config::set_identity(handle)
}

/// Шлях до воркспейсу з `.mt/mandates.yaml` (None — ще не налаштовано).
#[tauri::command]
fn get_mandates_dir() -> Option<String> {
    config::get_mandates_dir()
}

/// Зберігає шлях до воркспейсу з `.mt/mandates.yaml`.
#[tauri::command]
fn set_mandates_dir(dir: String) -> Result<(), String> {
    config::set_mandates_dir(dir)
}

/// Сирий текст `<mandates_dir>/.mt/mandates.yaml` (порожній рядок —
/// файл відсутній: доброзичливий empty state деривує JS-шар, не Rust-помилка).
#[tauri::command]
fn read_mandates_yaml(mandates_dir: String) -> String {
    let path = PathBuf::from(&mandates_dir).join(".mt").join("mandates.yaml");
    fs::read_to_string(path).unwrap_or_default()
}

/// Сканує `<mandates_dir>/runs/*/decisions/` — файловий мок git-refs
/// транспорту (`refs/mt/runs/{run-id}/decisions/`, mt: mandates.md). Кожна
/// `decisions/`-директорія повертається з усіма файлами (decision-request,
/// квіз, approval, якщо є) одним викликом — той самий патерн одного fetch на
/// екран, що `mandates_show` у M0; `src/decisions.js: deriveQueue` деривує
/// чергу з цього снапшоту. Відсутній `runs/` — порожній список, не помилка.
#[tauri::command]
fn scan_decisions(mandates_dir: String) -> Vec<DecisionsDir> {
    let runs_dir = PathBuf::from(&mandates_dir).join("runs");
    let mut result = Vec::new();
    let Ok(run_entries) = fs::read_dir(&runs_dir) else {
        return result;
    };
    for run_entry in run_entries.flatten() {
        let decisions_dir = run_entry.path().join("decisions");
        let Ok(file_entries) = fs::read_dir(&decisions_dir) else {
            continue;
        };
        let mut files: Vec<FileEntry> = file_entries
            .flatten()
            .filter(|e| e.path().is_file())
            .filter_map(|e| {
                let name = e.file_name().to_str()?.to_string();
                let content = fs::read_to_string(e.path()).unwrap_or_default();
                Some(FileEntry { name, content })
            })
            .collect();
        files.sort_by(|a, b| a.name.cmp(&b.name));
        result.push(DecisionsDir {
            dir: decisions_dir.to_string_lossy().into_owned(),
            files,
        });
    }
    result.sort_by(|a, b| a.dir.cmp(&b.dir));
    result
}

/// Сирий текст довільного файлу за абсолютним шляхом (None — відсутній).
/// Загальна fs-примітива для квіз-/approval-файлів, які пише JS-шар
/// (`src/decision-flow.js`) — той самий "Rust лише fs" підхід, що
/// `read_mandates_yaml`, узагальнений на довільний шлях замість одного
/// зашитого файлу.
#[tauri::command]
fn read_text_file(path: String) -> Option<String> {
    fs::read_to_string(path).ok()
}

/// Пише текст у файл за абсолютним шляхом, створюючи батьківські директорії
/// (`runs/{run-id}/decisions/` може не існувати заздалегідь).
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(target, content).map_err(|e| e.to_string())
}

/// Сирий JSON ключа пристрою (None — ще не згенеровано; `src/signing.js:
/// loadOrCreateDeviceKey` генерує новий і GUI-транспорт персистить його
/// зворотним викликом `write_device_key`).
#[tauri::command]
fn read_device_key() -> Option<String> {
    config::read_device_key()
}

/// Персистить ключ пристрою (JWK-пара + base64 публічний ключ), згенерований
/// JS-шаром при першому підписі.
#[tauri::command]
fn write_device_key(json: String) -> Result<(), String> {
    config::write_device_key(json)
}

/// Конфіг локального LLM-ендпоінта квіз-генератора (None-поля — дефолт із
/// `src/quiz.js: defaultLlmConfig()` не перевизначено).
#[tauri::command]
fn get_llm_config() -> LlmConfig {
    let (base_url, model) = config::get_llm_config();
    LlmConfig { base_url, model }
}

/// Оновлює адресу/модель LLM-ендпоінта (кожен параметр незалежний — `None`
/// лишає відповідне поле конфігу без змін).
#[tauri::command]
fn set_llm_config(base_url: Option<String>, model: Option<String>) -> Result<(), String> {
    if let Some(base_url) = base_url {
        config::set_llm_base_url(base_url)?;
    }
    if let Some(model) = model {
        config::set_llm_model(model)?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().invoke_handler(tauri::generate_handler![
        get_identity,
        set_identity,
        get_mandates_dir,
        set_mandates_dir,
        read_mandates_yaml,
        scan_decisions,
        read_text_file,
        write_text_file,
        read_device_key,
        write_device_key,
        get_llm_config,
        set_llm_config
    ]);

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .setup(|app| {
            #[cfg(desktop)]
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                let _ = window.set_title(&format!("Delta v{}", app.package_info().version));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_mandates_yaml_returns_file_contents() {
        let tmp = tempfile::tempdir().unwrap();
        let mt_dir = tmp.path().join(".mt");
        fs::create_dir_all(&mt_dir).unwrap();
        fs::write(mt_dir.join("mandates.yaml"), "mandates:\n  - owner: olena\n").unwrap();

        let text = read_mandates_yaml(tmp.path().to_string_lossy().into_owned());
        assert!(text.contains("owner: olena"));
    }

    #[test]
    fn read_mandates_yaml_missing_file_is_empty_not_error() {
        let tmp = tempfile::tempdir().unwrap();
        let text = read_mandates_yaml(tmp.path().to_string_lossy().into_owned());
        assert_eq!(text, "");
    }

    #[test]
    fn scan_decisions_reads_files_from_every_run_decisions_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let decisions_a = tmp.path().join("runs/demo-1/decisions");
        let decisions_b = tmp.path().join("runs/demo-2/decisions");
        fs::create_dir_all(&decisions_a).unwrap();
        fs::create_dir_all(&decisions_b).unwrap();
        fs::write(decisions_a.join("0001-decision-request.md"), "---\ncomputed_owner: olena\n---\nx").unwrap();
        fs::write(decisions_b.join("0001-decision-request.md"), "---\ncomputed_owner: vitalii\n---\ny").unwrap();
        fs::write(decisions_b.join("0001-approval.json"), "{}").unwrap();

        let mut dirs = scan_decisions(tmp.path().to_string_lossy().into_owned());
        dirs.sort_by(|a, b| a.dir.cmp(&b.dir));

        assert_eq!(dirs.len(), 2);
        let demo1 = dirs.iter().find(|d| d.dir.contains("demo-1")).unwrap();
        assert_eq!(demo1.files.len(), 1);
        assert_eq!(demo1.files[0].name, "0001-decision-request.md");
        assert!(demo1.files[0].content.contains("olena"));

        let demo2 = dirs.iter().find(|d| d.dir.contains("demo-2")).unwrap();
        assert_eq!(demo2.files.len(), 2);
        assert!(demo2.files.iter().any(|f| f.name == "0001-approval.json"));
    }

    #[test]
    fn scan_decisions_missing_runs_dir_is_empty_not_error() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(scan_decisions(tmp.path().to_string_lossy().into_owned()).is_empty());
    }

    #[test]
    fn write_text_file_creates_parent_dirs_and_read_text_file_round_trips() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("runs/demo-1/decisions/0001-quiz.md");
        write_text_file(path.to_string_lossy().into_owned(), "schema_version: 1".to_string()).unwrap();
        assert_eq!(
            read_text_file(path.to_string_lossy().into_owned()),
            Some("schema_version: 1".to_string())
        );
    }

    #[test]
    fn read_text_file_missing_path_is_none_not_error() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("does-not-exist.md");
        assert_eq!(read_text_file(path.to_string_lossy().into_owned()), None);
    }
}
