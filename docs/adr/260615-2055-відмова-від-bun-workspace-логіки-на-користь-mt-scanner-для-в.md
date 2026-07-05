---
session: 0bc9b81d-37f8-4422-9adb-504713e21248
captured: 2026-06-15T20:55:29+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/0bc9b81d-37f8-4422-9adb-504713e21248.jsonl
---

## ADR Відмова від bun-workspace-логіки на користь mt-scanner для виявлення проєктів

## Context and Problem Statement

GUI-команда `list_project_workspaces` у `src-tauri/src/lib.rs` знаходила проєкти виключно через `package.json` (bun-monorepo-логіка), тому проєкти без `package.json` (наприклад `/Users/vitaliytv/www/vitaliytv/whitekey`) не з'являлися в пікері задач. При цьому сам `mt-scanner` містить функцію `find_all_tasks_dirs_from`, яка відповідає специфікації і не вимагає `package.json`.

## Considered Options

- Залишити bun-логіку, додати `package.json` у `whitekey`
- Запустити `mt setup` у `whitekey` (без зміни GUI)
- Замінити `list_project_workspaces` на виклик `mt_scanner::find_all_tasks_dirs_from`

## Decision Outcome

Chosen option: "Замінити `list_project_workspaces` на виклик `mt_scanner::find_all_tasks_dirs_from`", because це приводить GUI у відповідність до специфікації `mt.md` (конфіг через `.mt.json` або наявність `mt/`/`tasks/`, без вимоги до `package.json`) і усуває дублювання логіки між app і scanner.

### Consequences

- Good, because проєкти без `package.json` (наприклад, k8s-репо, інфра-репо) тепер відображаються в пікері; scanner-логіка поважає `.gitignore` і сканує до 6 рівнів вглиб.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Видалено: структуру `ProjectEntry` (`src-tauri/src/lib.rs:77`) та функцію `resolve_workspace_entries`.
- Замість них: `list_project_workspaces(root: String) -> Vec<WorkspaceInfo>` тепер викликає `mt_scanner::find_all_tasks_dirs_from(&PathBuf::from(root))`.
- `WorkspaceInfo` із scanner-а серіалізується з полями `{ label, path }` — ідентично старому `ProjectEntry`, тому `use-project-workspaces.js` не потребував змін.
- Специфікація: `/Users/vitaliytv/www/nitra/mt/npm/docs/mt.md`, розділ "Монорепо: множинні `mt/` директорії".
- Функція `find_all_tasks_dirs_from` визначена у `/Users/vitaliytv/www/nitra/mt/scanner/src/lib.rs:613`.
- Збірка після змін: `cargo build --manifest-path src-tauri/Cargo.toml` — `Finished` без помилок.
