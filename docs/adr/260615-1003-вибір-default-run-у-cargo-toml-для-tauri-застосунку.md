---
session: 5bad36d6-cca1-415b-9080-7013f094c7f6
captured: 2026-06-15T10:03:18+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/5bad36d6-cca1-415b-9080-7013f094c7f6.jsonl
---

## ADR Вибір default-run у Cargo.toml для Tauri-застосунку

## Context and Problem Statement

Пакет `app/src-tauri` містить два бінарні таргети — `task` і `journal`. Команда `tauri dev` викликає `cargo run` без явного прапора `--bin`, тому Cargo не може визначити, який бінарний файл запускати, і завершується з помилкою `could not determine which binary to run` (exit code 101).

## Considered Options

* Додати ключ `default-run = "task"` у `[package]` секцію `Cargo.toml`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати ключ `default-run = \"task\"` у `Cargo.toml`", because саме `task` є основним Tauri-бінарним файлом, а `journal` — це допоміжний headless FS-бінарник, що не повинен запускатися командою `tauri dev`.

### Consequences

* Good, because `cargo run` (і відповідно `tauri dev`) тепер однозначно вибирає правильний бінарний файл без додаткових прапорів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* Змінений файл: `app/src-tauri/Cargo.toml`, додано рядок `default-run = "task"` у секцію `[package]`
* Команда запуску: `bun --cwd=app run tauri dev` → `cargo run --no-default-features --color always`
* Два бінарні таргети: `task` (основний Tauri-застосунок) і `journal` (headless journal FS binary, spawned через node MCP bin)
