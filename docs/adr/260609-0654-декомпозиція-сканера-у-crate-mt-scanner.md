# Декомпозиція Rust-сканера в самодостатній crate `mt-scanner`

**Status:** Accepted
**Date:** 2026-06-09

## Context and Problem Statement

Логіка сканування файлової системи для `@7n/mt` була зосереджена безпосередньо у Tauri-додатку (`app/src-tauri/src/lib.rs`), що унеможливлювало її повторне використання в інших контекстах. Паралельно існував окремий JS-варіант сканера (`npm/lib/core/scanner.mjs`), що призводило до дублювання реалізації.

## Considered Options

* Виокремити логіку в окремий Rust crate `mt-scanner` (lib + binary) і підключити Tauri-додаток через `path =` залежність
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Виокремити логіку в окремий Rust crate `mt-scanner`", because це дозволяє одночасно підключити crate як Cargo-залежність у Tauri-проекті та викликати бінарник `mt-scanner` з JS-коду через subprocess — що відкриває шлях до заміни `scanner.mjs`.

### Consequences

* Good, because `app/src-tauri/src/lib.rs` скорочено з ~498 до ~44 рядків; уся логіка знаходиться в одному місці.
* Good, because `@7n/mt` npm-пакет може замінити `scanner.mjs` на spawn бінарника, що виводить JSON у stdout; бінарник можна дистрибутувати через `optionalDependencies` за патерном `esbuild`/`@biomejs/biome`.
* Bad, because path-залежність (`mt-scanner = { path = "../../../mt/scanner" }`) прив'язує Tauri-додаток до відносного шляху у файловій системі; варіанти усунення (crates.io publish, git-залежність, Cargo workspace) обговорювалися але рішення не прийнято.

## More Information

* `mt/scanner/Cargo.toml` — пакет `mt-scanner`, залежності `serde`/`serde_json`
* `mt/scanner/src/lib.rs` — публічні типи `TaskState`, `TaskNode`, `WorkspaceInfo`; функції `scan_tasks()`, `find_all_tasks_dirs()`, `find_all_tasks_dirs_from()`, `find_tasks_dir()`
* `mt/scanner/src/main.rs` — CLI binary: `mt-scanner scan <tasks_dir>` та `mt-scanner workspaces [<start_dir>]`, вивід — JSON у stdout
* `app/src-tauri/Cargo.toml` — `mt-scanner = { path = "../../../mt/scanner" }`
* `app/src-tauri/src/lib.rs` — чотири `#[tauri::command]`-обгортки, що делегують до `mt_scanner::*`
* Перевірено: `cargo run -- workspaces /Users/vitaliytv/www/nitra/task` повертає коректний JSON з workspace-ами

## Update 2026-06-09

Додаткові деталі з повнішого ADR-запису тієї ж сесії:

* CLI підтверджено: `mt-scanner workspaces` та `mt-scanner scan` повертають коректний JSON у stdout.
* `find_tasks_dir` у сканері оновлено: `.mt.json` → поле `mt_dir`, потім legacy `.n-cursor.json`, потім `mt/` і `tasks/` як fallback.
* Функція `has_running_sentinel` додана для перевірки `running_<pid>_until_*` sentinel-файлів.
* `scan_for_workspaces` отримала параметр `inherited_ignores: &[String]`; функції `load_gitignore`, `glob_match_name`, `is_gitignored` реалізують просте glob-matching.

## Update 2026-06-09

### Виключення gitignored-директорій зі сканування воркспейсів

Сканер зчитує `.gitignore`-файли з накопиченням паттернів при кожному спуску (семантика git: паттерни відносні до директорії файлу). Запобігає хибному виявленню воркспейсів у `node_modules`, `target`, `dist` тощо.

* Нові функції: `load_gitignore`, `glob_match_name`, `is_gitignored` у `app/src-tauri/src/lib.rs`
* Підпис `scan_for_workspaces` розширено параметром `inherited_ignores: &[String]`
* Документація: `mt/npm/docs/mt.md`, нова секція "Обмеження: `.gitignore`" в розділі "Монорепо"
