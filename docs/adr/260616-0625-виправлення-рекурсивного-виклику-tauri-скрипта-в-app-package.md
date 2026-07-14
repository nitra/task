---
session: 6220396b-6750-408d-9018-b5153cdb0963
captured: 2026-06-16T06:25:46+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/6220396b-6750-408d-9018-b5153cdb0963.jsonl
---

The script has been updated — `tauri` now calls the binary directly instead of recursively calling itself via `--cwd=app`.

Running `bun run start` should work now (the `tauri` binary is hoisted to root `node_modules/.bin/` and is accessible from the workspace).
---

## ADR Виправлення рекурсивного виклику `tauri` скрипта в `app/package.json`

## Context and Problem Statement
Запуск `bun run start` завершувався помилкою `ENOENT: Could not change directory to "app"`. Кореневий скрипт `start` у `package.json` делегував виклик в `app/` через `bun --cwd=app run tauri dev`, але скрипт `tauri` у `app/package.json` рекурсивно повторював `bun --cwd=app run tauri`, намагаючись перейти в неіснуючу директорію `app/app/`.

## Considered Options
* Виправити скрипт `tauri` у `app/package.json`, щоб він викликав бінарний файл `tauri` безпосередньо
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Виправити скрипт `tauri` у `app/package.json`, щоб він викликав бінарний файл `tauri` безпосередньо", because бінарний файл `tauri` вже піднятий (hoisted) у кореневий `node_modules/.bin/` через workspaces і доступний з будь-якого workspace без додаткового `--cwd`.

### Consequences
* Good, because `bun run start` більше не впирається в рекурсивну помилку шляху — `app/package.json` тепер викликає `tauri` напряму.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Файл змінено: `app/package.json`, скрипт `tauri`: `"bun --cwd=app run tauri"` → `"tauri"`
- Скрипт `android` у `app/package.json` також містив аналогічну рекурсію (`"bun --cwd=app run tauri android dev"`) — виправлено у тому ж коміті
- Бінарний файл `tauri` зареєстрований у `node_modules/.bin/tauri` кореневого workspace
- Залежність `@tauri-apps/cli` підключена через `app/package.json` як devDependency
