# default-run у Cargo.toml для Tauri-застосунку з кількома бінарними таргетами

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

Пакет `app/src-tauri` містить два бінарні таргети: `task` (основний Tauri-застосунок) і `journal` (допоміжний headless FS-бінарник). `tauri dev` виконує `cargo run` без `--bin`, тому Cargo завершувався з помилкою `could not determine which binary to run` (exit code 101).

## Considered Options

- Додати `default-run = "task"` у секцію `[package]` у `Cargo.toml`
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати default-run = \"task\"", because `task` є основним Tauri-бінарником; `journal` — допоміжний headless-інструмент для FS-операцій, що спавниться node-боком через `journal-store-node.js`, а не через `tauri dev`.

### Consequences

- Good, because `bun --cwd=app run tauri dev` (`cargo run --no-default-features --color always`) тепер однозначно запускає правильний бінарник без додаткових прапорів.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінений файл: `app/src-tauri/Cargo.toml` — додано рядок `default-run = "task"` у секцію `[package]`. Два бінарні таргети: `[[bin]] name = "task"` (Tauri-застосунок) і `[[bin]] name = "journal"` (headless journal CLI, spawned із `app/src/tool/journal-store-node.js`).
