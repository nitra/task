---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-14T13:01:33+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

## ADR Архітектура тул-сурфейсу `n-tool-surface`

## Context and Problem Statement
Будь-яка дія, яку людина виконує через фронтенд (scan, create, workspaces), була доступна лише через UI-взаємодію. LLM-агент і скриптовий оркестратор не могли дотягтись до тих самих дій headless — бракувало спільного call surface зі схемами та єдиним конвертом результату.

## Considered Options
* `action` — звично (Redux/Vuex), `src/actions/`, правило `n-actions`
* `tool` — мовою LLM (tool-use), `src/tool/`, правило `n-tool-surface`
* `command` — CQRS-термін, але конфліктує з Tauri commands і shell
* `capability` — нейтрально, але абстрактно

## Decision Outcome
Chosen option: "`tool`", because ключовий новий гравець — LLM, тому термінологія має збігатися з LLM tool-use. Назва правила — `n-tool-surface`, тека — `src/tool/`, точка входу — `dispatch(name, input)`. Людського CLI немає — інтерфейс суто машинний (для оркестратора); правило платформо-незалежне, а per-stack деталі (Tauri, Capacitor) — в окремих секціях або профільних правилах.

### Consequences
* Good, because transcript підтверджує: Gemma 4 E4B (`e2b`) через omlx headless викликала тул `create`, `dispatch` виконав його через `mt-scanner`, файли `demo-llm/task.md` + `a.md` реально створені — тобто LLM без UI зробила ту саму дію, що й кнопка у фронтенді.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо підтримки в production: per-stack розгалуження означає, що розробник кожного нового стека (Capacitor тощо) мусить самостійно реалізувати транспорт і CLI-bin.

## More Information
Файли MVP: `app/src/tool/catalog.js`, `dispatch.js`, `manifest.js`, `transports.js`, `index.js`, `llm.js`; `app/bin/task.mjs`; 34 тести в `app/src/tests/`. Спека-канон: `docs/specs/260614-n-tool-surface.md`. Правило `n-tool-surface` заплановано до пакету `@nitra/cursor`.

---

## ADR LLM-провайдер — локальна офлайн модель через omlx

## Context and Problem Statement
Для реалізації LLM-loop у `n-tool-surface` потрібно обрати модель і спосіб її виклику. Виклик мав бути однаковим і з in-app (Tauri), і з CLI-оркестратора без залежності від хмарного API.

## Considered Options
* Claude (Anthropic) через `tauri-plugin-http` (онлайн, ключ)
* Локальна офлайн — MLX + Gemma 4 E4B через `omlx` (OpenAI-сумісний сервер)
* Провайдер-агностик з кількома бекендами

## Decision Outcome
Chosen option: "Локальна офлайн MLX + Gemma 4 E4B через `omlx`", because модель запускається локально (офлайн, приватність), omlx (OpenAI-сумісний endpoint) дозволяє використовувати стандартний OpenAI function-calling формат для tools-маніфесту — той самий каталог `src/tool/` без змін. `tauri-plugin-http` уже підключений і достатній для HTTP до `localhost`. MCP — ціль на майбутнє, не MVP.

### Consequences
* Good, because transcript фіксує очікувану користь: `gemma-4-e2b-it-4bit` через `omlx` відпрацювала повний loop — обрала тул `create`, сформувала аргументи, файли створені (`demo-llm/task.md`, `a.md`). Ключ/endpoint/модель конфігуруються через `OMLX_BASE_URL`, `OMLX_API_KEY`, `OMLX_MODEL`.
* Bad, because `gemma-4-e4b-it-OptiQ-4bit` повернула HTTP 507 (`projected memory 17.89GB > ceiling 11.84GB`) — потрібно більше вільної RAM або зниження `memory_guard_tier` у конфізі omlx для запуску e4b.

## More Information
Сервер виявлено на `http://127.0.0.1:8000`; список моделей: `gemma-4-12B-it-nvfp4`, `gemma-4-e2b-it-4bit`, `gemma-4-e4b-it-OptiQ-4bit`. Адаптер: `createOpenAiChat({ baseUrl, model, apiKey?, fetchFn })` у `app/src/tool/llm.js`. `fetchFn` інжектується → in-app: `tauri-http`, CLI: `node fetch`, тести: мок.

---

## ADR Frontmatter поля `mode`/`executor`/`deps` → прапорні файли як єдина правда

## Context and Problem Statement
Чинний `mt init` писав у frontmatter `mode: human` (і `deps: []`), але **не** створював відповідний прапор `h.md`. Внаслідок цього свіжа задача сканувалась як `Unassigned` замість `Pending`. Два джерела правди (frontmatter + прапор) розходились.

## Considered Options
* (A) Прибрати дублі з frontmatter; істина = прапор `a.md`/`h.md`; `deps:` — з `deps/<id>.md`
* (B) Лишити обидва (frontmatter + прапор)
* (C) Прапор-істина + frontmatter як кеш

## Decision Outcome
Chosen option: "(A)", because прапорні файли вже є канонічним механізмом у `docs/mt.md`; frontmatter-дублі — джерело дрейфу і баг в `mt init`. `create_task` (Rust) пише лише `a.md`/`h.md`, жодного `mode:`/`executor:`/`deps:` у frontmatter.

### Consequences
* Good, because transcript фіксує очікувану користь: e2e прогін `agent` → `create` → `mt-scanner` → файли показав `flag: "a.md"` (для `mode: agent`) — canonical state через прапор.
* Bad, because Neutral, because transcript не містить підтвердження наслідку щодо сумісності зі старими `task.md`, де `mode:` у frontmatter є — вони залишаться без міграції (рішення 2: schema_version пишеться лише для нових файлів).

## More Information
Канонічний frontmatter після рішення: `schema_version: 1`, `created_at`, `budget_sec`, `hint`. Поле `deps: []` прибрано; залежності — лише порожні `deps/<id>.md` (топологічне ребро; `ref:` дописується пізніше). Зафіксовано у `mt/docs/spec-task-create-rust-integration.md`.

---

## ADR CLI-транспорт тул-сурфейсу — per-verb spawn `mt-scanner` (MVP)

## Context and Problem Statement
У `app/bin/task.mjs` (машинний бінарник для оркестратора) треба викликати Rust-логіку (`scan`/`workspaces`/`create`) без залежності від Tauri-рантайму. Постало питання: через який транспорт CLI-bin передає команди в `mt-scanner`.

## Considered Options
* (A) Per-verb spawn: `mt-scanner scan …`, `mt-scanner create …` — окремий `spawnSync` для кожного verb-у
* (B) Уніфікований `mt-scanner exec '<json>'` — один транспорт, `Command`-enum/serde в mt-репо

## Decision Outcome
Chosen option: "(A) per-verb spawn для MVP", because три verb-и (`scan`, `workspaces`, `create`) вже існують у `mt-scanner`; mt-репо не чіпаємо. Варіант (B) (`exec`-підкоманда + `serde`-dispatch) — наступний крок після MVP.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun bin/task.mjs create '…'` → `mt-scanner create` → `{ok:true, output:{created:true, flag:"a.md"}}` — повний round-trip без змін у mt-репо.
* Bad, because у `catalog.js` кожен тул явно будує argv-аргументи (`argv-mapper`) — дрібне дублювання, яке (B) усуне.

## More Information
Резолвер бінарника шукає в `mt/target/release/mt-scanner`, `mt/target/debug/mt-scanner`; перевизначається через `MT_SCANNER_BIN`. Конверт результату: `{ ok, output }` / `{ ok:false, error:{code,message} }` — однаковий для CLI, Tauri і LLM.
