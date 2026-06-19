---
session: 0bc9b81d-37f8-4422-9adb-504713e21248
captured: 2026-06-15T21:15:34+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/0bc9b81d-37f8-4422-9adb-504713e21248.jsonl
---

Rust compiles clean. No remaining references to the old composable outside its own file. Everything is in place.

Here's a summary of what was implemented:

**`app/src/composables/use-project-paths.js`** (new):

- Stores `task:projectPaths` (JSON array) and `task:lastProject` in localStorage
- Exports `addProjectPath`, `removeProjectPath`, `setLastProject`

**`app/src/composables/use-project-workspaces.js`** (updated):

- Uses `useProjectPaths` instead of the single-dir composable
- Calls new `list_projects_from_paths` Rust command
- Auto-invalidates cache when `projectPaths` changes

**`app/src-tauri/src/lib.rs`** (new command):

- `list_projects_from_paths(paths: Vec<String>) -> Vec<WorkspaceInfo>` — scans each path with `mt_scanner::find_all_tasks_dirs_from`, merges results
- Paths without an `mt/` directory return no entries (silently skipped)
- Registered in the invoke handler

**`app/src/components/CreateTaskDialog.vue`** (updated):

- Project field is now a searchable dropdown populated from configured paths
- "+" button next to the label opens a native folder picker to add a new search path
- Shows a hint when no paths are configured

**`app/src/composables/use-projects-dir.js`** (deprecated shim):

- Re-exports as backward-compat wrapper pointing to `use-project-paths.js`

To add `/Users/vitaliytv/www/vitaliytv/whitekey` as a project, click "+" in the "Проєкт" field and pick that directory.

---

```markdown
## ADR Список директорій проєктів у localStorage замість єдиного кореневого шляху

## Context and Problem Statement
Додаток шукав проєкти (де є `mt/`) сканом двох рівнів углиб від єдиного `projectsDir` (`~/www`). Проєкти без `package.json` (наприклад `/Users/vitaliytv/www/vitaliytv/whitekey`) або ті, що не відповідають схемі `<org>/<project>`, не з'являлися в picker-і задач.

## Considered Options
* Зберігати список шляхів у `localStorage` як JSON-масив (`task:projectPaths`)
* Tauri `plugin-store` (нативне зберігання у `AppData`)
* Конфіг-файл (`.json`/`.toml`) у директорії домашнього профілю

## Decision Outcome
Chosen option: "Зберігати список шляхів у `localStorage` як JSON-масив (`task:projectPaths`)", because `plugin-store` відсутній у `package.json` (додаткова залежність без переваг у даному контексті), а `localStorage` вже використовується для `task:lastProject` і достатньо надійний у Tauri 2 на macOS.

### Consequences
* Good, because користувач може явно додавати/видаляти довільні директорії через UI, незалежно від того, чи є в них `package.json`.
* Bad, because `localStorage` прив'язаний до WebView і не доступний напряму з Rust-процесу; майбутній Rust-код не може читати список без передачі через Tauri IPC.

## More Information
- `app/src/composables/use-project-paths.js` — ключі `task:projectPaths`, `task:lastProject`
- `app/src/composables/use-project-workspaces.js` — викликає `list_projects_from_paths` (Tauri IPC), інвалідує кеш через `watch(projectPaths, ...)`
- `app/src-tauri/src/lib.rs:list_projects_from_paths` — `fn list_projects_from_paths(paths: Vec<String>) -> Vec<WorkspaceInfo>`, делегує `mt_scanner::find_all_tasks_dirs_from` для кожного шляху
- `app/src/components/CreateTaskDialog.vue` — кнопка "+" відкриває `open({ directory: true })` з `@tauri-apps/plugin-dialog`
```
