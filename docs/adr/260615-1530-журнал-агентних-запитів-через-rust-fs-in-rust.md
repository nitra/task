---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-15T15:30:18+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

## ADR Журнал агентних запитів через Rust (FS-in-Rust)

## Context and Problem Statement

Реалізація in-app агента вимагала модуля журналу запитів (`requests/<id>.json`), доступного з двох контекстів: Node.js MCP-бінарника та Tauri webview. Початкова реалізація (`journal.js`) використовувала `node:fs` і не могла працювати у webview-контексті.

## Considered Options

- `node:fs` (journal.js) — Node-only, непридатний для webview
- `@tauri-apps/plugin-fs` у JS — FS у webview напряму
- Rust-модуль + standalone `journal` binary + Tauri-команди `journal_*`

## Decision Outcome

Chosen option: "Rust-модуль + standalone `journal` binary + Tauri-команди", because користувач сформулював принцип «вся ФС → Rust» як проєктний інваріант (аналогічно до `omlx_config` та `scan_tasks`).

### Consequences

- Good, because transcript фіксує очікувану користь: єдиний Rust-модуль `src-tauri/src/journal.rs` з dir-injectable інтерналами покривається `cargo test` (4 тести), а Node MCP-бін спавнить `src-tauri/src/bin/journal.rs` — жодних паралельних реалізацій FS.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Файли: `app/src-tauri/src/journal.rs`, `app/src-tauri/src/bin/journal.rs`, `app/src-tauri/src/lib.rs` (команди `journal_create`, `journal_load`, `journal_update`, `journal_list`). `journal.js` (node:fs) видалено. E2E-перевірка: MCP-клієнт → `request()` → Rust-бінарник записав `~/Library/Application Support/com.nitra.task/requests/<id>.json`.

---

## ADR Інжектований journal store у agent-handler

## Context and Problem Statement

`handleRequest` і `handleRespond` мають однаково виконуватися з двох транспортів: Node MCP-бінарника (журнал через Rust-бінарник `spawnSync`) та Tauri webview (журнал через `invoke`). Тверде зшивання з конкретним бекендом зробило б handler дубльованим.

## Considered Options

- Окремі handler-файли для node та webview
- Інжекція `journal`-store як параметр `handleRequest({ …, journal })`

## Decision Outcome

Chosen option: "Інжекція `journal`-store як параметр", because transcript фіксує явне рішення «інжектувати `journal`-store у `handleRequest`» та аналогію з тим, як `dispatch` вже інжектується в loop.

### Consequences

- Good, because transcript фіксує очікувану користь: `agent-handler.js` залишився один файл; `journal-store-node.js` (спавнить бінарник) і `journal-store-tauri.js` (invoke) підключаються на call-site — бінарник у `bin/task.mjs`, webview у `composables/use-agent.js`.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Файли: `app/src/tool/agent-handler.js` (параметр `journal`), `app/src/tool/journal-store-node.js`, `app/src/tool/journal-store-tauri.js`, `app/src/composables/use-agent.js` (wire Tauri-store), `app/bin/task.mjs` (wire node-store).

---

## ADR Tier-класифікація тулів з тристанним результатом (allow/approval/deny)

## Context and Problem Statement

Потрібен механізм обмеження доступу до тулів на основі actor (людина, агент). Початковий `scope: "safe"` (бінарний) не розрізняв «заборонено» та «потребує схвалення», що унеможливлювало реалізацію D-E2 (деструктивні дії через людину).

## Considered Options

- Бінарний allow/forbid (scope: "safe")
- Тристанний classify: allow / approval / deny

## Decision Outcome

Chosen option: "тристанний `classify(actor, tool) → allow | approval | deny`", because тільки три стани дозволяють агенту _запропонувати_ деструктивну дію (видиму в маніфесті), але не _виконати_ її самостійно.

### Consequences

- Good, because transcript фіксує очікувану користь: людина (`kind: human`) отримує `allow` на всіх tier, агент (`kind: agent`) — `allow` для `read`/`write` і `approval` для `destructive`; `guardDispatch` блокує виконання в loop; `scopedManifest` фільтрує видимість тулів у маніфесті.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Файли: `app/src/tool/scope.js` (функції `classify`, `guardDispatch`, `scopedManifest`, `scopedToolNames`), `app/src/tool/catalog.js` (поле `tier: 'read'|'write'|'destructive'`), `app/src/tests/scope.test.js` (50 тестів). Назву `scope: "safe"` зведено до `tier`.

---

## ADR Деструктивне видалення задачі через human-approval (D-E2)

## Context and Problem Statement

Агент (зовнішній MCP-клієнт) попросив видалити задачу `mcp-demo`. За принципом проєкту деструктивні дії не мають виконуватися автономно — потрібна явна авторизація людини.

## Considered Options

- Повна заборона `delete` для агентів (tier enforce без gate)
- Деструктивний `delete` через паузу loop і human-approval

## Decision Outcome

Chosen option: "деструктивний `delete` через паузу loop і human-approval", because людина підтвердила слайс D-E2 як окрему задачу після демонстрації того, що агент не може видалити задачу (статус `done`, actions: []).

### Consequences

- Good, because transcript фіксує очікувану користь: агентський запит `delete mcp-demo` дає `status: needs_approval`, `pendingApproval: {tool:"delete", input:{...}}` у Rust-журналі — задача фізично не видаляється; `handleApprove` виконує `delete_task` (Rust, `remove_dir_all`) лише після підтвердження людиною в `AuditDialog`.
- Bad, because `delete_task` доступний лише через Tauri-команду (таuricmd, не CLI) — MCP-бін не може виконати approve автономно навіть якщо захоче.

## More Information

Файли: `app/src-tauri/src/lib.rs` (Tauri-команда `delete_task` з валідацією шляху), `app/src/tool/catalog.js` (тул `delete`, `tier:"destructive"`, без `cli`), `app/src/tool/agent-handler.js` (функція `handleApprove`), `app/src/components/AuditDialog.vue` (кнопки Підтвердити/Відхилити для `needs_approval`). Live-перевірка (stub-chat): `STATUS: needs_approval`, `mcp-demo` ціла. Тест: `app/src/tests/agent-handler.test.js`.

---

## ADR MCP-stdio сервер: keep-alive до закриття зʼєднання

## Context and Problem Statement

Після `await server.connect(new StdioServerTransport())` у MCP-гілці `bin/task.mjs` стояв `return 0`, через що `main().then(process.exit)` миттєво завершував процес одразу після підключення клієнта — до обробки будь-яких запитів.

## Considered Options

- `new Promise` з `onclose=` (avoid-new + prefer-add-event-listener — ESLint-порушення)
- Не викликати `process.exit` для MCP: повертати `undefined` замість `0`, а `main().then(code => { if (code !== undefined) process.exit(code) })`

## Decision Outcome

Chosen option: "не викликати `process.exit` для MCP (`return undefined`)", because це усуває ESLint-порушення (`unicorn/no-new-promise`, `unicorn/prefer-add-event-listener`) — stdin відкритий і тримає event-loop живим до EOF клієнта без додаткового коду.

### Consequences

- Good, because transcript фіксує очікувану користь: smoke-тест пройшов після фіксу — `TOOLS: request, respond`, `STATUS: done`, задача на диску.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Файли: `app/bin/task.mjs` (MCP-гілка, рядки `return undefined` + `main().then((code) => { if (code !== undefined) process.exit(code) })`). Коміти `0b6afee` (початковий баг) → `54130b4` (фікс). ESLint-правила: `unicorn/no-new-promise`, `unicorn/prefer-add-event-listener`.
