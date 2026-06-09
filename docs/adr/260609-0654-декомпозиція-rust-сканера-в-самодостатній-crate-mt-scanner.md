---
session: 523a2d0e-a2db-4ca8-ad75-b13d453965a4
captured: 2026-06-09T06:54:19+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/523a2d0e-a2db-4ca8-ad75-b13d453965a4.jsonl
---

The JS `scanner.mjs` in `@7n/mt` can now be replaced by spawning `mt-scanner` binary (it outputs JSON). Binary distribution via npm can use `optionalDependencies` with platform-specific packages (same pattern as `esbuild` or `@biomejs/biome`).

---

<session-transcript-end>

Now produce the ADR(s).

## ADR Декомпозиція Rust-сканера в самодостатній crate `mt-scanner`

## Context and Problem Statement
Логіка сканування файлової системи для `@7n/mt` була зосереджена безпосередньо у Tauri-додатку (`app/src-tauri/src/lib.rs`), що унеможливлювало її повторне використання в інших контекстах. Паралельно існував окремий JS-варіант сканера (`npm/lib/core/scanner.mjs`), що призводило до дублювання реалізації.

## Considered Options
* Виокремити логіку в окремий Rust crate `mt-scanner` (lib + binary) і підключити Tauri-додаток через `path =` залежність
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Виокремити логіку в окремий Rust crate `mt-scanner`", because це дозволяє одночасно: підключити crate як Cargo-залежність у Tauri-проекті (`mt-scanner = { path = "../../../mt/scanner" }`), а також викликати бінарник `mt-scanner scan`/`mt-scanner workspaces` з JS-коду через subprocess — що відкриває шлях до заміни `scanner.mjs`.

### Consequences
* Good, because `app/src-tauri/src/lib.rs` скорочено з ~498 до ~44 рядків; уся логіка знаходиться в одному місці.
* Good, because transcript фіксує очікувану користь: `@7n/mt` npm-пакет може замінити `scanner.mjs` на spawn бінарника, що виводить JSON у stdout.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `mt/scanner/Cargo.toml` — пакет `mt-scanner`, залежності `serde`/`serde_json`
- `mt/scanner/src/lib.rs` — публічні типи `TaskState`, `TaskNode`, `WorkspaceInfo`; функції `scan_tasks()`, `find_all_tasks_dirs()`, `find_all_tasks_dirs_from()`, `find_tasks_dir()`
- `mt/scanner/src/main.rs` — CLI binary: `mt-scanner scan <tasks_dir>` та `mt-scanner workspaces [<start_dir>]`, вивід — JSON у stdout
- `app/src-tauri/Cargo.toml` — додано `mt-scanner = { path = "../../../mt/scanner" }`
- `app/src-tauri/src/lib.rs` — чотири `#[tauri::command]`-обгортки, що делегують до `mt_scanner::*`
- Перевірено: `cargo run -- workspaces /Users/vitaliytv/www/nitra/task` повертає коректний JSON з workspace-ами
