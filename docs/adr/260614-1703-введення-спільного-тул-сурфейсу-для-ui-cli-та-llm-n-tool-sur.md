---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-14T17:03:58+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

Ні — все на гілці **`feat/create-task-command`**, не на `main`. Всі зміни ще **не закомічені** (unstaged + untracked файли).

Хочеш, щоб я зробив коміт і відкрив PR в `main`?
---

Transcript end.

## ADR Введення спільного тул-сурфейсу для UI, CLI та LLM (n-tool-surface)

## Context and Problem Statement
У проєкті `task` (Tauri + Vue) бекендові дії (`scan_tasks`, `create_task`, `find_all_tasks_dirs`) були доступні тільки через кліки у фронтенді — через прямий `invoke`. LLM і скриптові оркестратори не могли виконати ті самі дії без UI. Постала потреба організувати виклики так, щоб фронтенд, CLI та локальний LLM (через omlx) звертались до спільного **single source**.

## Considered Options
* Залишити логіку в компонентах (лише UI-доступ)
* Виокремити **Action Layer** як спільний тул-сурфейс (`src/tool/`), доступний UI, CLI та LLM

## Decision Outcome
Chosen option: "Виокремити тул-сурфейс у `src/tool/` з трьома адаптерами", because ціль проєкту — щоб LLM без фронтенду виконував ті самі дії, що й UI; каталог `src/tool/` стає єдиним джерелом правди для `dispatch`, OpenAI-маніфесту та CLI.

Прийняті під-рішення:
- **Термін одиниці** — `tool` (а не `action`/`command`), бо головний новий гравець — LLM.
- **Назва правила** — `n-tool-surface`.
- **Тека** — `src/tool/`.
- **CLI** — лише машинний режим для скриптового оркестратора (`task <tool> '<json>'`); людський CLI не потрібен.
- **LLM-провайдер** — локальна офлайн модель `gemma-4-e4b-it-OptiQ-4bit` через **omlx** (OpenAI-сумісний MLX-сервер на `localhost:8000`).
- **Формат маніфесту** — **OpenAI function-calling** (бо omlx говорить OpenAI API); MCP — як ціль на майбутнє.
- **Headless-транспорт** — per-verb spawn `mt-scanner` (Rust-бінарник) — `mt-scanner scan/workspaces/create`; `mt-scanner exec '<json>'` — наступний крок (mt-репо не чіпали).
- **Де живе логіка** — в JS-handler у каталозі (може бути фронтендовим кодом або делегувати в Rust/HTTP); лінія поділу — не «фронт vs бек», а «досяжне лише кліком» vs «іменована callable із схемою».
- **Per-stack канони** — Tauri і web можуть мати різну реалізацію адаптерів; це допустимо й закріплюється окремими секціями правила (деталі → `n-tauri`/`n-vue`/`n-capacitor`).
- **Спільний каркас діалогів** — `BaseDialog.vue` (рефактор для усунення jscpd-клону між `AgentDialog` і `CreateTaskDialog`).

### Consequences
* Good, because transcript фіксує очікувану користь: повний LLM-loop доведено наживо — `gemma-4-e2b-it-4bit` через omlx сама обрала тул `create`, сформувала аргументи та виконала виклик, `mt-scanner` реально створив `demo-llm/task.md` + `demo-llm/a.md` без жодного UI.
* Good, because transcript фіксує: `dispatch` використовується з трьох точок (UI, `bin/task.mjs`, `AgentDialog`) через один каталог; паритет між адаптерами підтверджено білдом і 34 тестами.
* Bad, because транскрипт не містить підтверджених негативних наслідків.

## More Information
Нові файли:
- `app/src/tool/catalog.js` — єдине джерело: 3 тули `scan`/`workspaces`/`create`.
- `app/src/tool/dispatch.js` — `dispatch(name, input)` → валідація + конверт `{ok,output}`.
- `app/src/tool/manifest.js` — `toolManifest()` (OpenAI) + `listTools()`.
- `app/src/tool/transports.js` / `app/src/tool/index.js` — UI-транспорт (`invoke`).
- `app/src/tool/llm.js` — `runAgent` + `createOpenAiChat` (omlx-адаптер).
- `app/bin/task.mjs` — CLI: `task <tool> '<json>' | list | schema | agent "<prompt>"`. Конфіг: `OMLX_BASE_URL=http://127.0.0.1:8000/v1`, `OMLX_MODEL`, `OMLX_API_KEY`.
- `app/src/components/BaseDialog.vue` — спільна q-dialog-оболонка.
- `app/src/components/AgentDialog.vue` — UI for in-app LLM agent (omlx → `dispatch`).
- `app/src/composables/use-omlx.js` — persisted omlx config (localStorage).
- `docs/specs/260614-n-tool-surface.md` — канон-спека (чернетка для `@nitra/cursor`).
- `.jscpd.json:ignore` — додані `**/gen/schemas/**`, `.cursor/skills/**`, `.pi/skills/**`.
- `.cspell.json:words` — додані `omlx`, `schemars`, `OptiQ`; `docs/specs/**` в `ignorePaths`.
- Тести: `app/src/tests/tool.test.js` (21), `app/src/tests/llm.test.js` (13) — разом 34 тести.
- Гілка: `feat/create-task-command`.
