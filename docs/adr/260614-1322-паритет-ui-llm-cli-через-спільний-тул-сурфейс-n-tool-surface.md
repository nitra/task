---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-14T13:22:34+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

Усі гейти зелені — завершено.
[user]
[tool_result] Build succeeded
[assistant]
[thinking]

[assistant]
The transcript covers multiple significant design decisions. Let me emit the ADRs.
[assistant]

## ADR Паритет «UI ↔ LLM ↔ CLI» через спільний тул-сурфейс (`n-tool-surface`)

## Context and Problem Statement
Застосунок `task` (Tauri + Vue + Rust) мав лише UI-шлях до дій (scan, create тощо); LLM та скриптовий оркестратор не мали механізму викликати ті самі операції без відкриття фронтенду. Потрібно впровадити принцип, за якого будь-яка дія, доступна через UI, однаково досяжна headless — для LLM-агента й автоматики.

## Considered Options
* Лише бекенд-логіка (перенести все в Rust, JS — тонкий клієнт)
* **Каталог іменованих тулів у JS (`src/tool/`)** — єдине джерело, три адаптери
* Окремий CLI-бінарник без спільного каталогу з UI

## Decision Outcome
Chosen option: "Каталог іменованих тулів у JS (`src/tool/`)", because логіка (зокрема JS-код фронтенду) може лишатись де живе; важливо, що вона **організована як іменований виклик зі схемою**, до якого дотягуються UI, CLI і LLM — без переносу коду на бекенд.

### Consequences
* Good, because UI (`TaskGraph`, `CreateTaskDialog`), оркестратор (`bin/task.mjs`) і локальний LLM-агент (`runAgent`) усі проходять через один `dispatch(name, input)` — паритет доведено наживо (Gemma через omlx виконала `create` і отримала реальний `task.md`).
* Bad, because transcript не містить підтверджених негативних наслідків; потенційний дрейф між JS-схемою каталогу і Rust-типами `mt-scanner` потребуватиме окремого контролю (генерація схем з `schemars` — наступний крок).

## More Information
- `app/src/tool/catalog.js` — єдиний каталог (3 тули: `scan`, `workspaces`, `create`; ім'я, опис, схема входу, Tauri-команда, CLI-argv)
- `app/src/tool/dispatch.js` — `dispatch(name, input)` → валідація за схемою → `{ok, output}` / `{ok:false, error:{code,message}}`
- `app/src/tool/manifest.js` — `toolManifest()` (OpenAI function-calling) + `listTools()`
- `app/src/tool/transports.js` — UI-транспорт через `invoke` (Tauri); CLI-транспорт — per-verb spawn `mt-scanner`
- `app/src/tool/llm.js` — `runAgent({prompt, dispatch, chat, maxSteps})`; `createOpenAiChat({baseUrl, model, apiKey, fetchFn})`
- `app/bin/task.mjs` — `task <tool> '<json>' | list | schema | agent "<prompt>"`
- `docs/specs/260614-n-tool-surface.md` — канон-спека (готова до `@nitra/cursor`)

---

## ADR Назви тул-сурфейсу: термін `tool`, правило `n-tool-surface`, тека `src/tool/`

## Context and Problem Statement
Під час визначення архітектурного принципу «headless-паритету» треба було вибрати стійкі імена для центрального поняття, правила `@nitra/cursor` і теки в проєкті — імена, що відображають ключового нового гравця (LLM) і закріпляться як канон.

## Considered Options
* `action` / `n-actions` / `src/actions/`
* `command` / `n-command-surface` / `src/commands/`
* `capability` / `n-callable`
* **`tool` / `n-tool-surface` / `src/tool/`**

## Decision Outcome
Chosen option: "`tool` / `n-tool-surface` / `src/tool/`", because термін `tool` прямо відображає нового ключового гравця — LLM (tool-use); назва правила `n-tool-surface` дзеркалить ключову ідею «поверхні викликів»; `src/tool/` — ємна, однозначна тека.

### Consequences
* Good, because термін узгоджений з LLM-концепцією (`tool_use`, OpenAI function-calling), скорочує невідповідність між мовою правила і мовою протоколу моделі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Людський CLI (verb-режим `mt-scanner <verb> --flags`) виключено свідомо: цільовий споживач — **скриптовий оркестратор і LLM**, а не люди. Залишились лише: `task <tool> '<json>'` (машинний) + `task agent "<prompt>"` (LLM-loop).

---

## ADR LLM-адаптер: локальна MLX-модель через OpenAI-сумісний omlx-сервер

## Context and Problem Statement
Потрібно вибрати провайдера LLM і протокол для in-app та CLI агент-лупу; вимога — локальна офлайн-модель з можливістю виконувати tool-use без хмарного API.

## Considered Options
* Claude (Anthropic, хмарний) через `tauri-plugin-http`
* **Локальна MLX (Gemma 4 E4B) через omlx (OpenAI-сумісний сервер)**
* Провайдер-агностик (множинні бекенди, MVP)

## Decision Outcome
Chosen option: "Локальна MLX (Gemma 4 E4B) через omlx (OpenAI-сумісний сервер)", because пріоритет — приватність і офлайн-робота; omlx на `localhost` віддає OpenAI-сумісний `/chat/completions` з `tools`, що дозволяє використати наявний `tauri-plugin-http` без нових залежностей.

### Consequences
* Good, because транспортна деталь ізольована в `createOpenAiChat({baseUrl, model, apiKey, fetchFn})` — підмінити провайдера пізніше (Claude, інша MLX-модель) без зміни `runAgent`.
* Bad, because малий локальний ~4B Gemma нестабільний у tool-use; transcript фіксує: `gemma-4-e4b-it-OptiQ-4bit` впала через memory ceiling (потрібно 17.89 GB, доступно 11.84 GB) — e2b (`gemma-4-e2b-it-4bit`) підійшла. MCP — цільовий протокол, але відкладений на після MVP.

## More Information
- `app/src/tool/llm.js`: `createOpenAiChat` → `fetchFn` інжектується → in-app через `@tauri-apps/plugin-http`, bin через node `fetch`, тести через vi.fn()
- Конфіг через env: `OMLX_BASE_URL` (default `http://127.0.0.1:8000/v1`), `OMLX_MODEL` (default `gemma-4-e4b-it-OptiQ-4bit`), `OMLX_API_KEY`
- Доведено наживо: `gemma-4-e2b-it-4bit` через omlx `:8000` сама обрала тул `create`, `dispatch` запустив `mt-scanner`, `task.md` + `a.md` реально створено

---

## ADR Headless-транспорт: per-verb spawn `mt-scanner` (Рішення 3A)

## Context and Problem Statement
CLI-транспорт `bin/task.mjs` потребує способу виконати Rust-логіку (`scan_tasks`, `create_task` з крейту `mt-scanner`) у headless-режимі, не торкаючись mt-репозиторію.

## Considered Options
* **(A) Per-verb spawn** — handler кожного тула спавнить наявний verb: `mt-scanner scan/workspaces/create …`
* **(B) Уніфікований `mt-scanner exec '<json>'`** — Rust диспетчить по JSON-Command
* **(C) Rust-бінарник як єдина точка** — JS-каталог лише описує/форвардить

## Decision Outcome
Chosen option: "Per-verb spawn (A)", because mt-репозиторій не потребує змін (три verb-и `scan/workspaces/create` вже є); MVP доставлено сьогодні без додаткових зусиль.

### Consequences
* Good, because transcript фіксує очікувану користь: нульові зміни в mt-репо, повний CLI-round-trip працює.
* Bad, because argv-мапінг у `catalog.js` (поле `argv`) потрібен для кожного тула; при додаванні нового тула — два місця (схема + argv). `mt-scanner exec '<json>'` заплановано як наступний крок.

## More Information
- `app/src/tool/catalog.js`: кожен тул має поля `tauriCmd` (UI-транспорт) і `argv(input)` (CLI-транспорт → per-verb spawn)
- `app/src/tool/transports.js`: `tauriTransport` — через `invoke`; CLI-транспорт у bin (`spawnSync mt-scanner …`)
- Резолвер бінарника перевіряє `MT_SCANNER_BIN` (env), потім шляхи: `../../../mt/target/release/mt-scanner`, `../../../mt/target/debug/mt-scanner`, `/usr/local/bin/mt-scanner`

---

## ADR Подвійний канон реалізації: платформо-специфічні секції, спільна архітектура (Рішення 4)

## Context and Problem Statement
Правило `n-tool-surface` мало бути мовно-незалежним, але реалізація `dispatch` кардинально відрізняється між pure-web (JS-handler робить роботу сам), Tauri+Rust (JS-handler делегує в Rust через `invoke`) і, потенційно, Capacitor. Потрібно визначити, як правило описує це розходження.

## Considered Options
* Єдиний JS-канон (native — внутрішня деталь делегації)
* **Два явні канони з per-stack секціями, деталі у відповідних правилах (`n-tauri`, `n-vue`, `n-capacitor`)**
* Native-first коли є Rust (JS — тонкий клієнт)

## Decision Outcome
Chosen option: "Два явні канони з per-stack секціями", because розходження між web і Tauri — допустиме і навмисне: архітектура (каталог, dispatch, конверт, LLM-loop) спільна; реалізація транспорту — per-stack, деталі в профільних правилах (`n-tauri`, `n-vue` тощо), не у ядрі `n-tool-surface`.

### Consequences
* Good, because ядро правила лишається платформо-незалежним; конкретика кожного стека не забруднює канон; легко додати `n-capacitor` як ще одну секцію без зміни ядра.
* Bad, because transcript не містить підтверджених негативних наслідків; потенційно — більше файлів правил, але user прийняв це свідомо.

## More Information
`docs/specs/260614-n-tool-surface.md` — канон-спека з розділом «Per-stack секції»; планується перенесення в `@nitra/cursor` з окремими `.mdc` для Tauri/Vue/Capacitor.

---

## ADR Спільний базовий компонент діалогу `BaseDialog.vue`

## Context and Problem Statement
Після додавання `AgentDialog.vue` `jscpd` виявив клон між `AgentDialog.vue:66-…` і `CreateTaskDialog.vue:130-…` — обидва мали ідентичну `q-dialog`+`q-card` обгортку із заголовком і кнопкою закриття. Потрібно усунути дублювання.

## Considered Options
* Додати `jscpd` `ignore` для обох файлів
* **Винести спільний каркас у `BaseDialog.vue`**

## Decision Outcome
Chosen option: "Винести спільний каркас у `BaseDialog.vue`", because це справжній рефактор (усуває дублювання логічно), а не обхід лінтера; `AgentDialog` і `CreateTaskDialog` тепер використовують `<BaseDialog>` замість повторної `q-dialog`+`q-card` оболонки.

### Consequences
* Good, because transcript фіксує: після рефактору `lint-js` exit 0 (клон зник), `jscpd` чистий.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`app/src/components/BaseDialog.vue` — props: `modelValue`, `title`, `icon`, `width`, `bodyClass`; slot `default` + slot `actions`. Файли `AgentDialog.vue` і `CreateTaskDialog.vue` повністю переписані на `<BaseDialog>`.
