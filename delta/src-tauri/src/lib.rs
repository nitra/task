//! Delta-бекенд (M0): тонкий fs-шар над `.mt/mandates.yaml` — читає сирий
//! текст файлу, а деривацію (парсинг, зріз «мій мандат», ланцюг ескалації)
//! робить спільний JS мок-парсер (delta/src/mandates.js), і в GUI, і в CLI.
//! Rust свідомо не парсить YAML тут: контракт мандатів — мок за
//! docs/specs/260809-delta-app.md (рішення Ж), майбутня заміна —
//! napi-виклики mandate-crate з mt-rust, не Rust-код цього застосунку.

use std::fs;
use std::path::PathBuf;

mod config;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().invoke_handler(tauri::generate_handler![
        get_identity,
        set_identity,
        get_mandates_dir,
        set_mandates_dir,
        read_mandates_yaml
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
}
