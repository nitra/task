# Групування задач по workspace у Tauri UI

**Status:** Accepted
**Date:** 2026-06-08

## Context and Problem Statement

Tauri-UI відображав задачі одного `mt/`-директорія через ручне текстове поле. Монорепо може мати кілька `mt/`-директорій у різних пакетах, які виникають динамічно. Потрібно відображати задачі з усіх workspace одночасно, групуючи їх за workspace, без ручного вводу шляху.

## Considered Options

* Динамічне сканування від git root + відображення всіх workspace згрупованими (без input-поля)
* Статичний список workspace збережений у `localStorage`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Динамічне сканування від git root + відображення всіх workspace згрупованими", because `localStorage` не підходить через динамічну появу нових workspace; завжди потрібен актуальний скан.

### Consequences

* Good, because `find_all_tasks_dirs` повертає список усіх `mt/`-директорій від git root; UI показує кожен workspace окремою секцією без ручного вводу.
* Good, because `scan_for_workspaces` враховує `.gitignore` на кожному рівні рекурсії — заігноровані директорії (наприклад `dist/`, `coverage/`) пропускаються.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* Новий Rust-command: `find_all_tasks_dirs() -> Vec<WorkspaceInfo>`
* `WorkspaceInfo { label: String, path: String }` — label є відносним шляхом від git root
* `find_git_root` шукає `.git` директорію вгору по дереву
* `scan_for_workspaces` — рекурсивний обхід з глибиною до 6 рівнів, пропускає `node_modules`, `target`, `dist`, `build`, приховані директорії
* `scan_for_workspaces` читає `.gitignore` на кожному рівні, накопичує паттерни від батьків (`inherited_ignores: &[String]`); нові функції: `load_gitignore(dir)`, `is_gitignored(name, patterns)`, `glob_match_name(name, pattern)` — обробляє прості `*`-glob-паттерни
* `TaskGraph.vue` переписано: немає `q-input`, виводяться секції per-workspace
* Документація оновлена: `mt/npm/docs/mt.md`, секція "Монорепо"
