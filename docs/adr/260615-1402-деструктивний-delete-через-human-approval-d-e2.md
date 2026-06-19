---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-15T14:02:27+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

## ADR Деструктивний `delete` через human-approval (D-E2)

## Context and Problem Statement

Agent-gateway підтримує тул-сурфейс, де агент (через MCP-stdio) може викликати будь-який доступний тул. Без захисту агент міг би відразу видалити задачу, минаючи людський контроль. Потрібен механізм, при якому деструктивна дія **ставиться на паузу** до явного підтвердження людини.

## Considered Options

* **needs_approval через журнал** — агент кличе деструктивний тул → `status: needs_approval` у журналі → людина апрувить в аудит-UI → дія виконується.
* Заборонити деструктивні тули взагалі (не в scope для v1).
* Дозволити без підтвердження з аудитом.

## Decision Outcome

Chosen option: "needs_approval через журнал", because `needs_approval` — сестра `needs_clarification`: той самий журнал + `respond`/approve-петля; механізм вже є, потрібен лише новий статус і gate у `runAgent`.

### Consequences

* Good, because transcript фіксує очікувану користь: `mcp-demo` залишилась на диску (`intact`) при `status: needs_approval` — деструктив не виконується до апруву; людина бачить `pendingApproval: {delete, mcp-demo}` в аудиті.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* Тул `delete` у `catalog.js` отримав `tier: 'destructive'`; CLI-обробника (`cli`) немає — деструктив не доступний через CLI-транспорт.
* `scope.js`: функція `classify(actor, toolName)` повертає `'allow' | 'approval' | 'deny'`; агенти (`agent`) отримують `approval` на `destructive`.
* `runAgent` (llm.js) отримав параметр `gate` — при `approval` кидає `{ needsApproval: true, tool, input }` замість виклику `dispatch`.
* `handleApprove` у `agent-handler.js` — людина апрувить → `dispatch` викликається безпосередньо з `pendingApproval`.
* Rust-команда `delete_task` у `lib.rs` — фізичне видалення лише через Tauri-invoke (людський actor).
* Approve/Reject UI — кнопки в `AuditDialog.vue` для записів зі статусом `needs_approval`.
* Коміт: `690fe1a ✨ feat(agent-gateway): destructive delete with human-approval (D-E2)`.

---

## ADR Журнал запитів через Rust (вся ФС → Rust)

## Context and Problem Statement

Початкова реалізація `journal.js` використовувала `node:fs` безпосередньо у JS, що означало FS у вебвʼю (Tauri). Це суперечило принципу проєкту «вся ФС через Rust», за яким фізичний доступ до файлів має бути виключно на стороні Rust.

## Considered Options

* **Rust-команди `journal_*` (Tauri commands)** — модуль `src-tauri/src/journal.rs` + standalone-бінарник `journal` для node MCP-біна; те ж саме для вебвʼю через invoke.
* `@tauri-apps/plugin-fs` у JS — менше Rust, але FS у вебвʼю.

## Decision Outcome

Chosen option: "Rust-команди `journal_*`", because відповідає задокументованому принципу проєкту «вся ФС → Rust» (як `omlx_config`, scanner); нода спавнить бінарник, вебвʼю — Tauri invoke, handler один.

### Consequences

* Good, because transcript фіксує підтвердження: live e2e smoke показав `actor: agent/smoke, status: done` — журнал-запис написано Rust-бінарником; `journal.js` (node:fs) видалено (`git rm`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* `app/src-tauri/src/journal.rs` — shared модуль (create/load/update/list); FS-операції параметризовані по `dir` для тестованості.
* `app/src-tauri/src/bin/journal.rs` — standalone-бінарник; спавниться з `journal-store-node.js` через `spawnSync`.
* Tauri-команди `journal_create`, `journal_load`, `journal_update`, `journal_list` — у `lib.rs`.
* `journal-store-node.js` — node-сайд; `journal-store-tauri.js` — webview-сайд (invoke); однакова форма для інжекції в `agent-handler`.
* `cargo test --lib`: 4 unit-тести (roundtrip, merge, list, missing-dir).
* Коміт: `a68c115 ✨ feat(agent-gateway): journal FS-in-Rust`.

---

## ADR Інжектований `journal` store в `agent-handler`

## Context and Problem Statement

`agent-handler.js` спочатку безпосередньо імпортував `journal.js` (node:fs), тому той самий handler не міг використовуватись у вебвʼю (Tauri), де FS-доступ має йти через Rust invoke. Потрібна архітектура, де один handler працює в обох середовищах.

## Considered Options

* **Інжектований `journal`-store** — передавати store як параметр у `handleRequest`/`handleRespond`/`handleApprove`; кожен caller підставляє свій store (`createNodeJournalStore` або `createTauriJournalStore`).
* Дублювати `agent-handler` для node і Tauri.

## Decision Outcome

Chosen option: "інжектований `journal`-store", because один handler, два store (node для bin, Rust-invoke для вебвʼю) — без дублювання логіки агента.

### Consequences

* Good, because transcript фіксує очікувану користь: однаковий `handleRequest` викликається з MCP-біна (`journal-store-node`) і з `use-agent.js` (`journal-store-tauri`); тести покривають handler через in-memory mock-store.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* `handleRequest({ intent, actor, chat, dispatch, journal })` — `journal` = `{ create, load, update }`.
* `createNodeJournalStore()` у `journal-store-node.js` — спавнить `src-tauri/target/debug/journal` через `spawnSync`.
* `createTauriJournalStore()` у `journal-store-tauri.js` — routes через `invoke('journal_create', ...)`.
* `use-agent.js` (`composables`) — in-app gateway; підставляє Tauri-store і `tauriFetch` для `createOpenAiChat`.
* In-memory mock-store у `agent-handler.test.js` дозволяє тестувати handler без Rust або node:fs.

---

## ADR Трирівневий `classify` для scope enforcement (D-E1)

## Context and Problem Statement

Початковий scope у каталозі мав лише поле `scope: "safe"` (без `tier`). `guardDispatch` повертав лише `allow/deny` без проміжного стану. При введенні деструктивних тулів з human-approval потрібна третя гілка: **не заборонено, але вимагає підтвердження**.

## Considered Options

* **`classify` з трьома станами: `'allow' | 'approval' | 'deny'`** — humans виконують усе напряму; agents `read|write` тули виконують напряму, `destructive` — через approval.
* Булева `allow/deny` (без approval — деструктив або дозволений, або заборонений).

## Decision Outcome

Chosen option: "classify з трьома станами", because agents можуть *ініціювати* деструктивну дію (вона зʼявляється в їхньому prompt), але виконання паузується до людського апруву; це дозволяє більш прозоро інформувати агента про намір при збереженні захисту.

### Consequences

* Good, because transcript фіксує очікувану користь: `classify('agent', 'delete') → 'approval'`; `classify('human', 'delete') → 'allow'` — confirmed тестами scope.test.js (50/50).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* `scope.js` — `ACTOR_MAX_TIER: { human: 'destructive', agent: 'write' }`; `TIER_ORDER = ['read', 'write', 'destructive']`.
* Поле тулів у `catalog.js` змінено з `scope: "safe"` на `tier: 'read' | 'write' | 'destructive'`.
* `scopedManifest(actor)` — фільтр LLM-маніфесту: destructive-тули потрапляють у маніфест агента (агент їх бачить), але gate у `runAgent` перехоплює виклик до `dispatch`.
* `guardDispatch(dispatch, actor)` збережено для `handleRespond` (clarification-resume без gate на approval).
* `toolManifest(allow)` у `manifest.js` переписано з `TOOLS.filter(tool => allow(tool))` (unicorn/no-array-callback-reference).
