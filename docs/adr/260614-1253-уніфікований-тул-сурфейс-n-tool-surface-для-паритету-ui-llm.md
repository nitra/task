---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-14T12:53:28+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

Done.
[assistant]
Повний LLM-loop готовий. Усі гейти зелені.

## Що зібрано

**`app/src/tool/llm.js`** — ізольований від транспорту `runAgent(prompt, { chat, dispatch, maxTurns })`:
- `createOpenAiChat({ baseUrl, model, fetchFn })` — `fetch`-обгортка для omlx (OpenAI-сумісний endpoint), інжектована, тому повністю мокується в тестах;
- `runAgent` — цикл: `chat(messages, tools)` → `tool_calls` → `dispatch(name, input)` → `tool_result` назад → до `finish_reason: stop`; безпечний ліміт `maxTurns` (default 12);
- єдиний конверт `{ok,output:messages}` / `{ok:false,error}`, узгоджений з рештою сурфейсу.

**`app/bin/task.mjs agent "<prompt>"`** — CLI-точка входу:
- базовий URL і модель — через `OMLX_BASE_URL` / `OMLX_MODEL` (або дефолти `127.0.0.1:10240/v1` + `mlx-community/gemma-3n-E4B-it`);
- чисте повідомлення про помилку, коли omlx не запущено:
```
Cannot reach LLM server at http://127.0.0.1:10240/v1
Start omlx with: omlx serve <model>
```

**3 тести LLM-loop** (unit, повний мок):
- успішний фінальний відповідь без тулів;
- один tool_call → tool_result → фінальний відповідь;
- HTTP-помилка → `{ok:false, error:{code:"llm_error"}}`.

## Демо з терміналу (коли omlx запущено)
```bash
bun bin/task.mjs agent "Яка директорія задач у /Users/vitalii/www/nitra/task?"
# → модель викличе `workspaces` або `scan`, відповідь з реальними даними
```

## Гейти: tests **34/34** ✓ · lint-js ✓ · lint-style ✓ · changelog ✓

Що далі — `mt-scanner exec '<json>'` (Рішення 3-наступний крок) або тест LLM-loop наживо з omlx?

---

END OF TRANSCRIPT

[thinking]
Let me analyze this transcript to identify design decisions that should be documented as ADRs.

Key decisions made in this session:

1. **n-tool-surface архітектурний принцип** - A platform-agnostic rule for tool surface parity (UI ↔ LLM ↔ orchestrator) to be placed in @nitra/cursor package. This includes decisions about terminology (tool, n-tool-surface, src/tool/), no human CLI, machine-only binary.

2. **Рішення 1**: Terminology choices - term "tool", rule "n-tool-surface", directory "src/tool/", dispatch function, machine-only CLI (no human CLI)

3. **Рішення 2**: LLM provider - local offline MLX + Gemma 3n E4B via omlx (OpenAI-compatible server), OpenAI function-calling format for tools manifest, MCP as future goal

4. **Рішення 3**: Headless CLI transport - per-verb spawn of `mt-scanner` for MVP (no changes to mt-repo), machine-only binary

5. **Рішення 4**: Stack canonicalization - architecture shared but implementation diverges per-stack intentionally; each stack section in separate rules (n-tauri, n-vue, n-capacitor)

6. **create_task механізм**: The spec for creating tasks via Rust (from the earlier part of the transcript)
- All FS interaction through Rust (mt-scanner)
- mode/executor/interactive removed from frontmatter; truth = flag file (a.md/h.md)
- schema_version: 1 only for new files
- --dep writes empty deps/<id>.md
- deps: [] field removed from frontmatter

7. **CreateTask frontmatter decisions**:
- mode/executor/interactive fields removed from frontmatter (decision 1A in the spec)
- schema_version: 1 added to new files only
- deps: [] removed from frontmatter
- flag a.md/h.md is the truth

Let me think about which ones are the most important distinct decisions:

1. **Архітектура тул-сурфейсу** (n-tool-surface): the main architectural decision - a catalog-based shared tool surface accessible by UI, CLI, and LLM
2. **Термінологія та структура n-tool-surface**: specific naming choices (tool, src/tool/, dispatch, machine-only CLI)
3. **LLM провайдер omlx/Gemma 3n E4B**: local offline MLX via OpenAI-compatible server
4. **Per-stack реалізація**: implementation diverges per-stack intentionally, shared architecture
5. **Headless CLI transport**: per-verb spawn for MVP
6. **Task create frontmatter**: no mode/executor in frontmatter, flag files as truth, empty deps

These are clear design decisions worth documenting as ADRs.
</thinking>

## ADR Уніфікований тул-сурфейс (n-tool-surface) для паритету UI ↔ LLM ↔ оркестратор

## Context and Problem Statement
У проєкті `task` будь-яка дія (сканування, пошук воркспейсів, створення задачі) була доступна лише через UI-взаємодію. LLM-агент і скриптовий оркестратор не могли викликати ті самі дії без участі людини, що блокувало повну автоматизацію.

## Considered Options
* Зберегти сирий `invoke`/`fetch` у компонентах; додати окремий CLI поряд
* Централізований каталог іменованих тулів як єдине джерело, три адаптери-споживачі (UI, CLI, LLM)

## Decision Outcome
Chosen option: "Централізований каталог `src/tool/`", because логіка дії організована як іменований callable зі схемою та може бути викликана однаково з UI (`dispatch` + Tauri-транспорт), машинного bin (`task <tool> '<json>'`) і LLM-агента (маніфест у форматі OpenAI function-calling → `runAgent` loop → `dispatch`).

### Consequences
* Good, because transcript фіксує очікувану користь: демо з терміналу `bun bin/task.mjs create/scan` і той самий каталог в UI підтвердили паритет; 34 тести зелені.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `app/src/tool/catalog.js`, `dispatch.js`, `manifest.js`, `transports.js`, `llm.js`, `index.js`
- `app/bin/task.mjs` — машинний bin (команди `<tool>`, `schema`, `list`, `agent`)
- `app/src/tests/tool.test.js`, `llm.test.js`
- Специфікація: `docs/specs/260614-n-tool-surface.md`
- Ціль — перенести принцип у пакет `@nitra/cursor` як правило `n-tool-surface`

---

## ADR Термінологія і структура n-tool-surface

## Context and Problem Statement
При формалізації нового принципу потрібно було обрати стабільні назви (термін одиниці виклику, правила, теки, CLI-режиму), які стануть каноном у пакеті `@nitra/cursor` для всіх web і Tauri проєктів.

## Considered Options
* Термін `action` / правило `n-actions` / тека `src/actions/` / людський + машинний CLI
* Термін `command` / правило `n-command-surface`
* Термін `tool` / правило `n-tool-surface` / тека `src/tool/` / лише машинний CLI
* Термін `capability`

## Decision Outcome
Chosen option: "термін `tool` / правило `n-tool-surface` / тека `src/tool/` / лише машинний CLI", because ключовий новий гравець — LLM; людський CLI не потрібен, оскільки головна мета — виклик скриптовим оркестратором, а не людьми вручну.

### Consequences
* Good, because термін `tool` повністю збігається з мовою LLM tool-use; машинний режим `task <tool> '<json>'` мінімізує неоднозначність парсингу аргументів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Функція диспетчу: `dispatch(name, input)` (`invoke` зайнятий Tauri)
- Машинний bin: `task <tool> '<json>'`, `task schema`, `task list`, `task agent "<prompt>"`
- `app/src/tool/`, `app/bin/task.mjs`

---

## ADR LLM-провайдер: локальний MLX + Gemma 3n E4B через omlx (OpenAI-сумісний сервер)

## Context and Problem Statement
Для LLM-адаптера тул-сурфейсу треба було обрати провайдера, формат маніфесту тулів і де виконується loop tool-calls.

## Considered Options
* Claude (Anthropic) через `tauri-plugin-http`, Anthropic tools-маніфест
* Локальна офлайн MLX + Gemma 3n E4B через `mlx_lm` напряму (prompt-injected)
* Локальна офлайн MLX + Gemma 3n E4B через omlx (OpenAI-сумісний сервер), OpenAI function-calling маніфест
* Провайдер-агностик (багато бекендів)

## Decision Outcome
Chosen option: "omlx (OpenAI-compatible MLX server)", because omlx надає стандартний OpenAI API на `localhost`; `tauri-plugin-http` вже підключений; маніфест у форматі OpenAI function-calling генерується з єдиного каталогу `src/tool/`; MCP залишається ціллю на потім.

### Consequences
* Good, because модель стає замінним localhost-ендпоінтом; транспорт (HTTP) уже наявний; тули виконуються на стороні застосунку через `dispatch`, Python-код нічого не виконує.
* Bad, because transcript не містить підтверджених негативних наслідків; надійність tool-use 4B-моделі вимагає малого набору тулів і примусового JSON-виводу.

## More Information
- `app/src/tool/llm.js`: `createOpenAiChat({ baseUrl, model, fetchFn })` + `runAgent(prompt, { chat, dispatch, maxTurns })`
- `app/bin/task.mjs agent "<prompt>"`: дефолт `OMLX_BASE_URL=http://127.0.0.1:10240/v1`, `OMLX_MODEL=mlx-community/gemma-3n-E4B-it`
- `app/src/tool/manifest.js`: `toolManifest()` → OpenAI function-calling schema

---

## ADR Per-stack реалізація n-tool-surface: архітектура спільна, деталі розходяться

## Context and Problem Statement
При формуванні правила `n-tool-surface` для `@nitra/cursor` постало питання: чи мати єдиний JS-канон для всіх стеків (web, Tauri, Capacitor), чи дозволити реалізації розходитись між ними.

## Considered Options
* Єдиний JS-канон: handler завжди JS у `src/tool/`, делегація в Rust — деталь
* Два явні канони в одному правилі: «JS-native handler» і «делегуючий handler»
* Native-first для Rust-проєктів: `mt-scanner` — single source, JS — тонкий клієнт

## Decision Outcome
Chosen option: "архітектура спільна, per-stack реалізація розходиться навмисно", because Tauri, Capacitor, web мають різні транспорти й середовища; розбіжність реалізацій — допустима і краща; `n-tool-surface` тримає платформо-незалежний контракт, а деталі кожного стека делегуються в профільні правила (`n-tauri`, `n-vue`, `n-capacitor`).

### Consequences
* Good, because правило залишається коротким і мовно-незалежним; кожен стек може оптимізуватись під свій транспорт без компромісів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `docs/specs/260614-n-tool-surface.md` — канон з per-stack секціями
- Tauri-транспорт: `app/src/tool/transports.js` (Tauri `invoke`); per-verb spawn `mt-scanner` у `app/bin/task.mjs`

---

## ADR Headless CLI транспорт: per-verb spawn mt-scanner для MVP

## Context and Problem Statement
Машинний bin `task <tool> '<json>'` потребує транспорту до Rust-бінарника `mt-scanner`, де живе ФС-логіка. Варіантів транспорту кілька з різним обсягом змін у mt-репо.

## Considered Options
* Per-verb spawn: `mt-scanner scan/workspaces/create …` (verb-и вже є, mt-репо не чіпаємо)
* Уніфікований `mt-scanner exec '<json>'` (новий dispatch-endpoint у mt-репо)
* Rust-бінарник як єдина точка, JS лише описує

## Decision Outcome
Chosen option: "per-verb spawn для MVP", because три verb-и (`scan`, `workspaces`, `create`) у `mt-scanner` вже реалізовані; MVP можна зробити без змін у mt-репо; `mt-scanner exec '<json>'` запланований як наступний крок.

### Consequences
* Good, because transcript фіксує: `bun bin/task.mjs create/scan` з терміналу спрацювали коректно без будь-яких правок у mt-репо.
* Bad, because потрібен argv-мапінг для кожного тула в каталозі (дрібне дублювання); виправляється при впровадженні `exec`-endpoint.

## More Information
- `app/bin/task.mjs`: резолвер бінарника шукає `/Users/vitalii/www/nitra/mt/target/release/mt-scanner`, fallback — `MT_SCANNER_BIN` env
- `app/src/tool/catalog.js`: поле `toArgv(input)` на кожному toolі — bridge між JSON-схемою і argv

---

## ADR Frontmatter задачі: прапор-файли як джерело правди замість полів mode/executor

## Context and Problem Statement
При розробці спеки `spec-task-create-rust-integration.md` виявлено: чинний `mt init` пише `mode: human` у frontmatter `task.md`, але не створює `h.md` — сканер бачить задачу як `Unassigned` замість `Pending`. Крім того, поля `mode`/`executor`/`interactive` і `deps: []` дублюють інформацію, яка вже є у файлах-прапорцях і `deps/`.

## Considered Options
* (A) Прибрати дублі: істина у прапорці `a.md`/`h.md` і файлах `deps/<id>.md`, поля `mode`/`executor`/`interactive`/`deps` з frontmatter видалити
* (B) Залишити обидва джерела (frontmatter + прапорці)
* (C) Прапорці — істина, frontmatter — кеш

## Decision Outcome
Chosen option: "(A) прапорці як єдине джерело правди", because `docs/mt.md` визначає виконавця через прапорець `a.md`/`h.md`, а `deps/` — через файли; frontmatter-дублі спричиняють дрейф стану. Нові задачі отримують лише: `schema_version: 1` (перше поле), `created_at`, `budget_sec`, `hint`; `--dep` записує порожні `deps/<id>.md` (топологічне ребро без `ref:`).

### Consequences
* Good, because transcript фіксує: баг зі статусом `Unassigned` усувається; `ref:`-вміст у `deps/` дописується пізніше, коли деп resolved і відомий конкретний факт-файл.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `mt/docs/spec-task-create-rust-integration.md` — повна специфікація (рішення §12 закриті)
- Канонічний frontmatter нової задачі: `schema_version: 1`, `created_at`, `budget_sec: 600`, `hint: atomic`
- `schema_version: 1` пишеться лише у нових файлах; наявні `task.md` не мігруються
