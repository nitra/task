//! Спільна `std::fs`/`tokio::spawn_blocking`-реалізація для CLI й Tauri.
//! Обидва боти (`delta-cli::config`, `delta::phase_a`) досі носили 1:1
//! копію `scan_decisions_dirs`/`FsIo` — jscpd (`js/jscpd_duplicates`)
//! фіксував це як duplicate-clone. Єдине джерело правди тут; кожен
//! транспорт лишає собі лише path-конвенції, які насправді різняться
//! (`config.rs::config_path` vs `phase_a.rs::own_config_dir`).

use std::fs;
use std::path::PathBuf;

use async_trait::async_trait;
use delta_core::io::Io;

/// Скановує `<mandatesDir>/runs/{run-id}/decisions/` — та сама форма
/// `{dir, files}[]`, що `bin/delta.mjs: scanDecisionsDirs`.
pub fn scan_decisions_dirs(mandates_dir: &str) -> Vec<(String, Vec<(String, String)>)> {
    let runs_dir = PathBuf::from(mandates_dir).join("runs");
    let Ok(entries) = fs::read_dir(&runs_dir) else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let decisions_dir = entry.path().join("decisions");
        let Ok(files) = fs::read_dir(&decisions_dir) else {
            continue;
        };
        let mut file_list = Vec::new();
        for f in files.flatten() {
            if f.path().is_file() {
                if let Ok(content) = fs::read_to_string(f.path()) {
                    file_list.push((f.file_name().to_string_lossy().to_string(), content));
                }
            }
        }
        result.push((decisions_dir.to_string_lossy().to_string(), file_list));
    }
    result
}

/// `Io`-реалізація над `std::fs` (в `spawn_blocking`, бо `Io` — async trait,
/// а `std::fs` синхронний — не блокує tokio-реактор async-стеку `reqwest`,
/// що ЦІ Ж виклики оточують у `decision_flow`/`quorum`).
pub struct FsIo;

#[async_trait]
impl Io for FsIo {
    async fn read_file(&self, path: &str) -> Option<String> {
        let path = path.to_string();
        tokio::task::spawn_blocking(move || fs::read_to_string(path).ok())
            .await
            .ok()
            .flatten()
    }

    async fn write_file(&self, path: &str, content: &str) {
        let path = path.to_string();
        let content = content.to_string();
        let _ = tokio::task::spawn_blocking(move || {
            if let Some(parent) = std::path::Path::new(&path).parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(path, content)
        })
        .await;
    }
}
