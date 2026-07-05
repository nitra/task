# Agent Gateway: спільний NL-агент через MCP-stdio з глобальним журналом запитів

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

Зовнішній LLM-оркестратор (Claude Code, Cursor) має вміти делегувати природномовний намір вбудованому агенту застосунку `task` без знання параметрів CLI чи конвенцій проєкту. Водночас людина використовує той самий агент через `AgentDialog` у UI. Потрібно обрати транспорт, контракт запиту, розташування журналу і визначити платформний скоуп.

## Considered Options

- Гранульовані MCP-тули (thin): оркестратор сам викликає `create_task({tasksDir, name, opts})` зі схем маніфесту
- Thick-агент з одним мета-тулом `request(intent)`: оркестратор делегує намір, вбудований агент самостійно розвʼязує параметри
- Гібрид: granular-тули і `request(intent)` в одному MCP-сервері
- CLI-subprocess (`task request '<json>'`) як єдиний транспорт
- Локальний HTTP-демон (`POST /request`) як єдиний транспорт
- FS-черга (watched dir) як асинхронний транспорт
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Thick-агент через MCP-stdio (`request` + `respond`), macOS-only", because transcript фіксує рішення: той самий агент, що достатньо якісний для людини в UI, автоматично є достатньо якісним для зовнішнього агента — «human-grade = agent-grade за побудовою»; MCP-stdio — галузевий стандарт із нативним discovery й типізованими схемами для Claude/Cursor; два окремих тули (`request` і `respond`) дають LLM однозначний вибір між «почати» і «продовжити»; журнал у глобальному `appLocalDataDir` гарантує місце навіть для failed/ungrounded запитів.

### Consequences

- Good, because transcript фіксує підтверджений e2e smoke-test: зовнішній MCP-клієнт → `request("створи задачу …")` → агент (Gemma через omlx) самостійно обрав тул `create` → задача на диску + журнал-запис збережено Rust-бінарником.
- Good, because один `handleRequest`/`handleRespond` handler обслуговує UI і MCP без дублювання; людські й агентські запити потрапляють до спільного журналу з полем `actor.kind`.
- Good, because scope enforcement: кожен тул у `catalog.js` отримав `tier: 'read'|'write'|'destructive'`; `scope.js` фільтрує маніфест під actor; `guardDispatch` блокує виклик поза дозволеним tier (`agent` — лише `read`+`write`, `human` — усі рівні).
- Bad, because on-device agent session потребує запущеного omlx та достатньої вільної памʼяті (e4b-модель падала при 10.57 GB зайнятих із порогом 11.84 GB).
- Bad, because sessional clarification потребує running-lock на запис журналу, щоб два паралельних `respond` не запустили loop одночасно.

## More Information

**Транспорт:** MCP-stdio (`@modelcontextprotocol/sdk`); команда `task mcp --actor <id>`; keep-alive через `process.stdin.resume()` (не Promise-обгортка — уникнення порушення `unicorn/prefer-add-event-listener`). CLI (`task agent`) лишається як fallback для скриптів і dev без MCP-конфігу.

**Контракт:** два MCP-тули — `request({ intent })` і `respond({ requestId, message })`; `actor` надходить від транспорту (GUI → `kind:human`, MCP → значення `--actor`), не від caller — щоб caller не міг себе підмінити.

**Журнал:** per-file `appLocalDataDir/requests/<id>.json`; поля: `id`, `createdAt`, `updatedAt`, `actor`, `intent`, `status`, `messages[]`, `actions[]`, `summary`, `error`, `question`. Статуси: `pending|running|done|partial|needs_clarification|needs_approval|failed`. FS-реалізація — виключно Rust: `src-tauri/src/journal.rs` + бінарник `src-tauri/src/bin/journal.rs`; Tauri-команди `journal_create`, `journal_load`, `journal_update`, `journal_list` для WebView; `app/src/tool/journal-store-node.js` спавнить Rust-бінарник з MCP-боку.

**Sessional clarification:** `runAgent` приймає `messages[]` для resume; відповідь — виклик `respond(requestId, message)`, новий запис не створюється, loop відновлюється з наявних `messages[]`.

**Платформа:** macOS-only — Android виключено явно (немає довільної ФС, MCP-stdio неможливий у пісочниці, MLX/omlx відсутні).

**Файли:** `app/src/tool/agent-handler.js` (`handleRequest`, `handleRespond`), `app/src/tool/scope.js`, `app/src/tool/journal-store-node.js`, `app/src/composables/use-agent.js`, `app/bin/task.mjs` (режим `mcp`), `app/mcp-smoke.mjs`, `app/src/tests/agent-handler.test.js` (48 тестів), `app/src/tests/scope.test.js`, `src-tauri/src/journal.rs` (4 Rust unit-тести). Специфікація: `docs/specs/260615-agent-gateway.md`. Коміти: `fe88f95` (MCP + journal), `24147e7` (scope enforcement D-E1), `f7aa145` (Rust journal unit-tests).

**Tool-surface rule у @nitra/cursor:** правило `tool-surface` синхронізовано в пакет `@nitra/cursor` (`npm/rules/tool-surface/`) з авто-активацією на фронтенд-залежностях; `tauri.mdc` отримав per-stack секцію (версія `1.4 → 1.5`); 693 тести пройшли після додавання правила.

## Update 2026-06-15

- Уточнено принцип agent-gateway: один embedded agent-loop (`handleRequest`/`handleRespond`) є спільним NL-інтерфейсом для людини в UI та зовнішніх агентів через MCP.
- Зафіксовано транспорт MCP-stdio (`task mcp`) як тонку обгортку над наявним `dispatch`/Tool Surface.
- Журнал запитів зберігається в global `appLocalDataDir/requests/<id>.json`, бо запит є операційною подією застосунку і може ще не мати resolved project.
- Контракт MCP складається з `request(intent)` і `respond(requestId, message)`; clarification відновлює `messages[]` з журналу.
- Файлова робота журналу виконується через Rust-модуль і два транспорти: Tauri-команди для webview та standalone `journal` binary для node MCP path.
- Для Tool Surface додано tier-scope `read | write | destructive`; агент бачить і виконує лише дозволений scope відповідно до actor.

## Update 2026-06-15

- Live demo підтвердило наскрізний шлях MCP-client → `request(intent)` → локальний LLM → `create` → задача на диску.
- Журнал-запис створено в `~/Library/Application Support/com.nitra.task/requests/` з actor `claude-opus/agent`, status `done` і повною `messages[]` ниткою.
- GUI Journal (`AuditDialog`) читає той самий global app-data журнал, що й MCP-бінарник.

## Update 2026-06-15

- MCP-stdio підтверджено як єдиний транспорт agent-gateway: `app/bin/task.mjs` має режим `mcp`, який реєструє тули `request` і `respond` через `@modelcontextprotocol/sdk`.
- E2E smoke/demo підтвердили discovery тулів і створення задачі `mcp-demo/task.md` без кастомної інтеграції з боку MCP-клієнта.
- Контракт `request` лишається мінімальним `{ intent }`; `actor` береться з транспорту, а не з caller input.
