---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-15T09:30:28+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

Бачу — `Write` не в allowlist, а `Stop`-хуки (`capture-decisions.sh` / `normalize-decisions.sh`) самостійно зберігають ADR-вивід. Просто виводжу результат:

---

## ADR Quasar iconSet передається як обʼєкт, а не рядок

## Context and Problem Statement

Після додавання `CreateTaskDialog` з `q-select` у застосунок виникав краш реактивності Vue (`component.emitsOptions` is null), через який усі кнопки переставали реагувати. Причина — у `app/src/main.js` `iconSet` передавався рядком замість обʼєкта, що давало `undefined` при зверненні до `$q.iconSet.arrow.dropdown`.

## Considered Options

* Передавати `iconSet` рядком (`'material-symbols-outlined'`)
* Передавати `iconSet` імпортованим обʼєктом з `quasar/icon-set/material-symbols-outlined`

## Decision Outcome

Chosen option: "Передавати `iconSet` імпортованим обʼєктом", because Quasar очікує обʼєкт із полями типу `arrow.dropdown`; рядок стає значенням `$q.iconSet` і звернення до вкладених полів дає `undefined`, що руйнує цикл оновлення Vue при рендері `q-select`.

### Consequences

* Good, because після Vite-reload кількість помилок у логах впала до 0 — реактивність відновилась, кнопки запрацювали.
* Bad, because баг був латентним: до появи `q-select` зламаний `iconSet` ніколи не проявлявся.

## More Information

Файл: `app/src/main.js`. До: `iconSet: 'material-symbols-outlined'`. Після: `import iconSet from 'quasar/icon-set/material-symbols-outlined'` і передача обʼєкта у `.use(Quasar, { iconSet })`. Підтверджено живим Vite-логом: після `page reload src/main.js` — 0 помилок.

---

## ADR Agent Gateway — один спільний агент, human-grade = agent-grade

## Context and Problem Statement

Потрібно надати зовнішнім агентам-оркестраторам доступ до можливостей застосунку без дублювання логіки та без вимоги знати параметри й нюанси операцій. Водночас людина теж використовує NL-інтерфейс у тому ж застосунку.

## Considered Options

* Thin: окремі granular MCP-тули з типізованими схемами для зовнішніх агентів
* Thick: окремий NL-агент-посередник для зовнішніх агентів (розумний делегує локальній слабшій моделі)
* Спільний агент (human-grade = agent-grade): один NL-агент для людей і зовнішніх агентів через той самий інтерфейс

## Decision Outcome

Chosen option: "Спільний агент (human-grade = agent-grade)", because якість агента зобовʼязана бути достатньою для людини; зовнішній агент отримує рівно той самий рівень якості безкоштовно. Агент сам резолвить нюанси (workspace, параметри, дефолти) через `tool-surface`, не вимагаючи від caller-а знати деталі.

### Consequences

* Good, because transcript фіксує очікувану користь: не треба окремого API для агентів; покращення агента для людини автоматично покращує його для зовнішніх агентів; агент є рекурсивним застосуванням `tool-surface` — сам стає headless-callable surface.
* Bad, because агент завжди ґраундить контекст самостійно — навіть коли UI вже знає відповідь (D-A1 мінімальний вхід без підказок контексту обраний навмисно для паритету).

## More Information

Принцип зафіксовано у `docs/specs/260615-agent-gateway.md`. Реалізація: `app/src/tool/agent-handler.js` (`handleRequest`/`handleRespond`), `app/bin/task.mjs` (MCP-сервер), `app/src/tool/llm.js` (sessional `runAgent`).

---

## ADR MCP-stdio як єдиний транспорт Agent Gateway (Mac-only)

## Context and Problem Statement

Потрібно обрати один транспорт, через який зовнішній агент-оркестратор (Claude Code, Cursor тощо) звертатиметься до вбудованого NL-агента застосунку `task` на Mac. Вимога: тільки один транспорт, discoverability, нативна інтеграція з агент-екосистемою.

## Considered Options

* CLI-subprocess (`task request '<json>'`) — spawn бінарника на кожен запит
* MCP-stdio (`task mcp`) — протокол Model Context Protocol через stdin/stdout
* Локальний HTTP-демон (`POST /request`) — власний протокол, постійний демон
* FS-черга (watched dir) — асинхронний обмін через файли-запити

## Decision Outcome

Chosen option: "MCP-stdio", because це галузевий стандарт для «агент ↔ можливості додатку»; host нативно підключає `task` і бачить типізовані схеми тулів без кастомної інтеграції; clarification і `needs_approval` — нативно в протоколі (tool-result); лягає на вже збудоване (`dispatch`/каталог).

### Consequences

* Good, because transcript фіксує очікувану користь: discoverable тули зі схемами, нативна інтеграція з Claude Code/Cursor; keep-alive через `process.stdin.resume()` (не Promise-обгортка, щоб не порушувати eslint unicorn/prefer-add-event-listener).
* Bad, because для Android MCP-stdio неможливий (пісочниця) — але платформу свідомо звужено до Mac-only.

## More Information

Реалізовано: `app/bin/task.mjs` режим `mcp`; SDK `@modelcontextprotocol/sdk`; тули `request` і `respond`. Підтверджено smoke-тестом: зовнішній `Client` зі `StdioClientTransport` → `request("створи задачу …")` → агент → задача на диску + журнал (status: done). Виправлено баг keep-alive: `return 0` після `server.connect()` вбивав процес; замінено на `process.stdin.resume()`.

---

## ADR Журнал запитів: per-file у appLocalDataDir, sessional resume, два MCP-тули

## Context and Problem Statement

Потрібно персистувати всі запити до агента (людські та агентські) для візуального аудиту і репар-петлі: людина бачить статус, відповідає на уточнення, ретраїть невдалі. Необхідно обрати: де зберігати, формат, як ниткувати clarification.

## Considered Options

* Розташування: (a) per-project `mt/.requests/*.jsonl` vs (b) global `appLocalDataDir/requests/<id>.json`
* Clarification: one-shot + parentId (новий запис на відповідь) vs sessional (messages\[\] всередині одного запису)
* MCP-тули: один overloaded `request` vs два окремі (`request` + `respond`)

## Decision Outcome

Chosen option: "(b) global appLocalDataDir + sessional resume + два тули", because: (b) гарантує дім навіть незаґраундованому/failed запиту; sessional зберігає `messages[]` у записі — аудит-UI показує повну нитку розмови, `respond` відновлює loop без нового запису; два тули дають LLM однозначний вибір «почати» vs «продовжити».

### Consequences

* Good, because transcript фіксує очікувану користь: один журнал для всіх запитів (людські + агентські), наочна нитка розмови в аудиті, `respond` відновлює сесію з того ж місця.
* Bad, because sessional вимагає running-лок на запис (два `respond` не мають запускати loop одночасно) і resume-capable `runAgent` (старт з наявних `messages[]`).

## More Information

Формат запису: `id, createdAt, updatedAt, actor (kind/id), intent, status, messages[], actions[], summary, error, question`. Статуси: `pending | running | done | partial | needs_clarification | needs_approval | failed`. `actor` приходить від транспорту (UI = human, MCP = сконфігурований agent-id). `parentId` лишається лише для явних ретраїв. Специфікація: `docs/specs/260615-agent-gateway.md`.

---

## ADR Журнал запитів: вся ФС через Rust (journal.rs + standalone binary)

## Context and Problem Statement

У проєкті діє принцип «вся ФС → Rust»: вебвʼю і node-сторона не читають/пишуть файли напряму, а лише через Rust-команди (Tauri) або через spawn Rust-бінарника. Журнал запитів (`appLocalDataDir/requests/<id>.json`) треба зробити консистентним із цим принципом.

## Considered Options

* `app/src/tool/journal.js` (node:fs) — прямий запис у node CLI- та MCP-боці
* Rust-модуль `src-tauri/src/journal.rs` + Tauri-команди (вебвʼю) + standalone binary `journal` (node/MCP-бін спавнить замість прямих FS-операцій)

## Decision Outcome

Chosen option: "Rust-модуль + Tauri-команди + standalone binary", because це прямо відповідає зафіксованому принципу «вся ФС → Rust» і дозволяє двом фронтам (GUI та node MCP-бін) шарити одну реалізацію з ідентичним форматом запису. `agent-handler.js` отримує `journal`-стор через інʼєкцію.

### Consequences

* Good, because transcript фіксує: `cargo clippy -D warnings` і `cargo fmt --check` проходять; smoke-тест підтвердив запис через Rust-бінарник (actor, status: done, 5 messages у журналі).
* Bad, because `journal-store-tauri.js` (вебвʼю-стор) довелось тимчасово видалити (knip flagged unused), поки in-app `AgentDialog` не підключений до `handleRequest`.

## More Information

Нові файли: `app/src-tauri/src/journal.rs`, `app/src-tauri/src/bin/journal.rs`. Бінарник CLI: `journal create '<json>' | load <id> | update <id> '<patch>' | list`. Tauri-команди: `journal_create`, `journal_load`, `journal_update`, `journal_list` — зареєстровано в `lib.rs`. Node-стор: `app/src/tool/journal-store-node.js` (spawns binary). `app/src/tool/journal.js` (node:fs) видалено. `app/src-tauri/Cargo.toml` отримав `uuid` dep і `[[bin]] journal`.

---

## ADR @nitra/cursor: rule tool-surface + per-stack секція в tauri.mdc

## Context and Problem Statement

Принцип «headless tool surface» (будь-яка дія фронтенду виконувана без UI через спільний каталог тулів) зафіксовано у `docs/specs/260614-n-tool-surface.md`. Потрібно підняти його у `@nitra/cursor` як пакетне правило, щоб він синкувся у нові проєкти автоматично.

## Considered Options

* Додати як `alwaysApply: true` правило (без авто-предиката)
* Додати з `meta.auto.depInAnyPackageJson` предикатом на фронтенд-залежності (vue, react, svelte, @angular/core, preact, solid-js, @tauri-apps/api, @capacitor/core)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "depInAnyPackageJson на фронтенд-залежності", because правило актуальне лише для проєктів з фронтендом; авто-предикат дозволяє уникнути зайвого шуму в backend/CLI-only проєктах.

### Consequences

* Good, because transcript фіксує: повний набір тестів `@nitra/cursor` (693/693) пройшов; нове правило зʼявилось в `AUTO_RULE_ORDER` між `text` і `vue`; `fix tool-surface` — 1/1 без зауважень; `tauri.mdc` (версія 1.4→1.5) отримала per-stack секцію Tool Surface для Tauri+Rust.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Гілка `feat/tool-surface-rule` у `/Users/vitalii/www/nitra/cursor`. Файли: `npm/rules/tool-surface/tool-surface.mdc`, `npm/rules/tool-surface/meta.json`, `npm/rules/tool-surface/fix.mjs`, `npm/.changes/260615-0530.md` (bump: minor). Коміти `22925f07` (ядро) + `1d619007` (tauri-секція). Синкатиметься у проєкти як `n-tool-surface`.
