# Команда `create_task` у Rust та канонічна структура вузла задачі

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Застосунок `task` підтримував лише read-only. Реалізація UI для створення задач вперше вносила write-операцію з двома питаннями: (1) де реалізувати логіку запису; (2) які поля писати у frontmatter — чинний `mt init` дублював стан у frontmatter і в прапор-файлах (`a.md`/`h.md`), що спричинило баг: нова задача без `h.md` сканувалася як `Unassigned` замість `Pending`.

## Considered Options

- Rust-команда `create_task` у `mt-scanner` — пише `task.md`, `a.md`/`h.md`, `deps/<id>.md` безпосередньо
- Виклик `mt init` (npm CLI) як sidecar через `spawnSync`
- JS-логіка безпосередньо у фронтенді

## Decision Outcome

Chosen option: "Rust-команда `create_task` у `mt-scanner`", because директива: «все, що стосується ФС, має бути в Rust» — симетрично до read-side (`mt-scanner scan`); зафіксовано в `mt/docs/spec-scanner-rust-integration.md`. Канонічна структура: прибрати `mode`/`executor`/`interactive`/`deps:` з frontmatter — єдине джерело правди = `a.md`/`h.md` і `deps/<id>.md`. Для `--dep`: порожній `deps/<id>.md` (топологічне ребро); `ref:` дописується пізніше, коли деп resolved.

### Consequences

- Good, because єдина реалізація крейту обслуговує три споживачі: npm CLI `mt init` (шим), `mt-scanner create` (CLI), Tauri (лінкує крейт напряму).
- Good, because усувається дрейф frontmatter ↔ сканер; нова задача одразу має статус `Pending`.
- Good, because порожній `deps/<id>.md` оголошує ребро без dangling ref.
- Bad, because `mt init` (`@7n/mt`) не мігрує автоматично — перехідний борг (відсутність `schema_version` і `h.md`/`a.md`).

## More Information

- Спека: `mt/docs/spec-task-create-rust-integration.md`; read-side: `mt/docs/spec-scanner-rust-integration.md`
- API: `mt_scanner::create_task(tasks_dir, opts: CreateOpts) -> Result<CreateOutcome>`; `CreateOutcome` — externally-tagged enum `Created`/`Exists`
- CLI: `mt-scanner create <tasks_dir> <name> [--mode --model-tier --budget-sec --hint --dep]`, stdout JSON
- Канонічний frontmatter: `schema_version: 1`, `created_at`, `budget_sec`, `hint`; не мігрується в наявні файли
- UI: `CreateTaskDialog.vue` (нативний пікер через `tauri-plugin-dialog`), `task-create.js` (`validateTaskName`, `buildCreateOpts`, `mtDirFor` — 13 vitest тестів), `use-projects-dir.js` (localStorage)
- Capability `dialog:allow-open` у `capabilities/default.json`; `tauri-plugin-dialog = "2"` у `Cargo.toml`; `@tauri-apps/plugin-dialog` у `package.json`; Quasar `Notify` у `main.js`
