---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-15T06:31:25+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

## ADR Спільний тул-сурфейс: catalog → dispatch → адаптери (UI / CLI / LLM)

## Context and Problem Statement
Застосунок `task` мав три незалежні способи виконання операцій (UI через сирий `invoke`, CLI, LLM) — кожен зі своєю логікою, схемами та валідацією. Будь-яка нова операція потребувала дублювання у трьох місцях, а паритет поведінки не гарантувався.

## Considered Options
* Спільний каталог тулів (`src/tool/catalog.js`) як єдине джерело: ім'я, опис, JSON-схема, Tauri-команда, CLI-argv — із транспортними адаптерами поверх нього
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Спільний каталог тулів із транспортними адаптерами", because будь-яку дію фронтенду має бути виконувано без UI (CLI + LLM) через той самий `dispatch`; UI, CLI і LLM — рівноправні адаптери одного каталогу, а валідація за JSON-схемою відбувається до транспорту.

### Consequences
* Good, because transcript фіксує очікувану користь: `bun bin/task.mjs create` і кнопка «+» у UI йдуть через той самий `catalog.js`; невалідний тул повертає `{ok:false,error:{code:"not_found"}}` без виклику Rust.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `app/src/tool/catalog.js`, `dispatch.js`, `manifest.js`, `transports.js`, `index.js`, `app/bin/task.mjs`. Доведено наживо: `bun bin/task.mjs create '{"tasksDir":"…/mt","name":"deploy","opts":{"mode":"human"}}'` → `{ok:true,…}`. Канон-специфікація: `docs/specs/260614-n-tool-surface.md`. Правило `npm/rules/tool-surface/tool-surface.mdc` у `@nitra/cursor`.

---

## ADR LLM-агент-loop з ін'єктованими залежностями

## Context and Problem Statement
Потрібно було дати локальній мові-моделі (omlx, Gemma) змогу самостійно вибирати й виконувати тули без UI, причому той самий loop мав працювати і headless (CLI), і in-app (Tauri-WebView), і в тестах (mocked fetch).

## Considered Options
* `runAgent({ prompt, dispatch, chat, maxSteps })` із ін'єктованими `chat` і `dispatch`: модель → `tool_calls` → `dispatch` → конверт → повтор до кінця
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "`runAgent` з ін'єктованими `chat` і `dispatch`", because інжекція дозволяє використовувати `node fetch` (CLI), `tauri-http` (in-app) і `vi.fn()` (тести) без зміни ядра; `dispatch` — той самий з каталогу, що й для UI.

### Consequences
* Good, because transcript фіксує: tests 34/34 з mock-fetch; e2e наживо з `gemma-4-e2b-it-4bit` через omlx — модель обрала тул `create`, `dispatch` виконав, файли `task.md`+`a.md` реально створено.
* Bad, because e4b-модель (`gemma-4-e4b-it-OptiQ-4bit`) повернула 507 memory ceiling при 10.57GB зайнятих з порогом 11.84GB — це обмеження середовища, не коду.

## More Information
Файли: `app/src/tool/llm.js` (`runAgent`, `createOpenAiChat`), `app/src/tests/llm.test.js` (6 тестів). Env: `OMLX_BASE_URL`, `OMLX_MODEL`, `OMLX_API_KEY`. Модель `gemma-4-e2b-it-4bit` підтверджена робочою; `gemma-4-e4b-it-OptiQ-4bit` — при достатній вільній пам'яті.

---

## ADR MCP-stdio як єдиний транспорт для доступу зовнішніх агентів

## Context and Problem Statement
Потрібно було обрати рівно один транспорт, через який зовнішній LLM-оркестратор (інший агент) може звертатися до in-app агента застосунку `task` — без потреби знати схеми тулів чи нюанси проєкту.

## Considered Options
* CLI subprocess (`task request '<json>'`) — ефемерний спавн, вже майже реалізований
* MCP-сервер (stdio-flavor) — галузевий стандарт «агент → можливості додатку», discoverable, типізований
* Локальний HTTP-демон (`POST /request`) — власний протокол, без автодискаверингу
* ФС-черга (watched dir) — асинхронно, потрібен постійний споживач

## Decision Outcome
Chosen option: "MCP-сервер (stdio-flavor)", because це галузевий стандарт для «агент ↔ додаток» (підхоплюється Claude Code/Desktop, Cursor нативно); discoverable + типізовані схеми тулів; clarification і структурований результат нативні для протоколу; реалізується як новий режим `bin/task.mjs` поверх наявного `dispatch`/каталогу без нового стека.

### Consequences
* Good, because transcript фіксує очікувану користь: один транспорт замість кількох; зовнішній оркестратор бачить, що вміє `task`, без окремої документації.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Рішення зафіксовано в дизайн-діалозі; реалізація не розпочата в цій сесії. Stdio-flavor обрано, бо не потребує постійного демона та мережевого порту — host спавнить `task mcp` на сесію.

---

## ADR Журнал запитів як спільний backbone для людей і агентів

## Context and Problem Statement
Кожен виклик агента — людиною через UI або іншим агентом через MCP — мав зникати після виконання. Потрібно забезпечити візуальний аудит, відстеження статусів і можливість людини виправити запит, що не вдався (`needs_clarification`, `failed`).

## Considered Options
* ФС-журнал на app-data (Tauri `appLocalDataDir`) — кросплатформний, доступний і GUI, і MCP-сервер-процесу
* Per-project `mt/.requests/*.jsonl` — аудит іде з репо (git-trackable), але не кросплатформно
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "ФС-журнал на `appLocalDataDir`", because Tauri path API резолвить app-private dir однаково для GUI і для MCP-sidecar-процесу; журнал пишеться в `dispatch`/`request`-handler незалежно від транспорту — і людський запит із UI, і агентський з MCP потрапляють в один файл.

### Consequences
* Good, because transcript фіксує очікувану користь: спільний actor-поле (`human` | `<agent-id>`), статуси `pending/running/done/needs_clarification/failed`; GUI читає журнал live (FS-watch) і показує агентські запити в реальному часі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Структура запису: `{ id, ts, actor, intent, context, status, actions[]/trace, result|error }`. Репар-петля: `failed`/`needs_clarification` → людина бачить у аудит-UI → редагує намір / відповідає / ретраїть. Реалізація не розпочата в цій сесії.

---

## ADR Платформний скоуп: тільки macOS

## Context and Problem Statement
Початковий дизайн MCP-транспорту, локального omlx і скану ФС-репозиторіїв розглядався у двох контекстах — macOS і Android. Ці платформи кардинально відрізняються: Android не має довільної ФС, inter-app stdio, MLX-рантайму.

## Considered Options
* macOS як єдина платформа (десктоп-профіль: локальний omlx, MCP-stdio, скан ФС-репо)
* macOS (повний хост) + Android (людський клієнт над синкнутим store, remote-модель, без agent-gateway)

## Decision Outcome
Chosen option: "macOS як єдина платформа", because — рішення зафіксовано одним реченням: «залишаємо тільки мак версію».

### Consequences
* Good, because transcript фіксує очікувану користь: усуває розбіжності платформних профілів (ФС-журнал, MCP-stdio, omlx) і дозволяє зосередитись на одному стеку.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Додаткової інформації в transcript не зафіксовано.
