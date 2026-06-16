---
session: d927b0b9-d125-498a-8cc7-e1e46c7a7121
captured: 2026-06-15T20:27:55+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/d927b0b9-d125-498a-8cc7-e1e46c7a7121.jsonl
---

/schedule?
---

## ADR Кастомний вибір bun workspace замість нативного файл-менеджера

## Context and Problem Statement
Діалог "Нова задача" (`CreateTaskDialog.vue`) дозволяв вибирати будь-яку директорію на диску через нативний системний файл-менеджер (`open()` з `@tauri-apps/plugin-dialog`). Специфікація MT визначає, що `mt/` може існувати лише у bun workspace директоріях (`package.json` workspaces); показ усіх директорій ОС суперечив цьому обмеженню і вимагав від користувача самостійно орієнтуватися у повній файловій системі.

## Considered Options
* Замінити нативний файл-менеджер на `q-select` з переліком bun workspace директорій під `www`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Замінити нативний файл-менеджер на `q-select` з переліком bun workspace директорій", because специфікація MT явно обмежує `mt/` до bun workspace директорій, тому показувати увесь файловий дерево ОС — зайве і плутає користувача.

### Consequences
* Good, because користувач бачить лише валідні місця розміщення MT — директорії, де `mt/` фактично може існувати згідно зі специфікацією.
* Good, because transcript фіксує очікувану користь: `q-select` підтримує текстовий фільтр, тож можна набирати `nitra`, `task` тощо замість навігації по дереву ОС.
* Bad, because якщо структура проекту нестандартна (без `package.json` workspaces), директорію не буде видно в пікері — це навмисне обмеження, але може дивувати при розширенні.

## More Information
- Новий Tauri-команд `list_project_workspaces(root)` у `app/src-tauri/src/lib.rs` — сканує `www/<org>/<project>/` на 2 рівні, читає `package.json`, розгортає поле `workspaces` (підтримує glob `packages/*`), повертає `Vec<WorkspaceEntry>` із полями `{path, label}` (label формату `nitra / task / app`).
- Новий Tauri-команд `home_dir()` у `app/src-tauri/src/lib.rs` — повертає `$HOME` з env; замінив хардкод `/Users/vitalii/www/` у `use-projects-dir.js`.
- Новий composable `app/src/composables/use-project-workspaces.js` — викликає `list_project_workspaces`, кешує результат, надає `refresh()`.
- `CreateTaskDialog.vue` — `open()` (`@tauri-apps/plugin-dialog`) видалено; замінено на `q-select` зі `use-filter` та `computed filteredWorkspaces`.
- `filteredWorkspaces` переведено з `ref([])` (пустий при завантаженні) на `computed` — усуває баг, де select не показував варіантів після асинхронного завантаження.
