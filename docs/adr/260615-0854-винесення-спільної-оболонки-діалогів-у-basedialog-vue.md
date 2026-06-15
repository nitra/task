---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-15T08:54:30+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

Let me produce the ADR documentation from this session transcript.

## ADR Винесення спільної оболонки діалогів у `BaseDialog.vue`

## Context and Problem Statement
У проєкті `task` jscpd виявив клон між `AgentDialog.vue` і `CreateTaskDialog.vue`: обидва мали однаковий каркас `q-dialog` + `q-card` + секція заголовка. Клон порушував правило про відсутність дублювання коду.

## Considered Options
* Додати `jscpd`-ignore коментар для виявленого клону
* Винести спільний каркас у новий компонент `BaseDialog.vue`

## Decision Outcome
Chosen option: "Винести спільний каркас у `BaseDialog.vue`", because правило вимагає коректного рефактору, а не ігнорування порушення (за CLAUDE.md — «правильний фікс, а не ignore»).

### Consequences
* Good, because transcript фіксує очікувану користь: jscpd-клон зник, `lint-js exit: 0`, тести 34/34 ✓, build ✓.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `app/src/components/BaseDialog.vue` (новий), `app/src/components/AgentDialog.vue`, `app/src/components/CreateTaskDialog.vue`. Перевірки: `bun run lint-style`, `bun run lint-js`, `bun run build`, `bun run test`.

---

## ADR Заміна рядка `iconSet` на імпортований обʼєкт у `main.js`

## Context and Problem Statement
Після появи компонента `CreateTaskDialog.vue` із полем `q-select` (вибір `model_tier`) у вебв'ю Tauri (WKWebView) виникав краш `TypeError: undefined is not an object (evaluating '$q.iconSet.arrow.dropdown')`. Це повністю блокувало реактивність Vue — усі кнопки переставали реагувати на кліки.

## Considered Options
* Передавати `iconSet` рядком `'material-symbols-outlined'` (існуючий стан)
* Імпортувати icon-set як ES-модуль і передавати обʼєкт

## Decision Outcome
Chosen option: "Імпортувати icon-set як ES-модуль", because Quasar очікує обʼєкт (з полями `arrow.dropdown` тощо), а не рядок; рядок давав `$q.iconSet = String`, і звернення `.arrow.dropdown` падало під час рендеру `q-select`.

### Consequences
* Good, because transcript фіксує очікувану користь: після HMR full-reload — 0 помилок у живому лозі, tests 36/36 ✓, build ✓, кнопки почали відповідати на кліки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `app/src/main.js`. Зміна: `import iconSet from 'quasar/icon-set/material-symbols-outlined'` + передача `iconSet` у `.use(Quasar, { ..., iconSet })`. Баг був латентним — до появи `q-select` у діалогах `$q.iconSet` не викликався.

---

## ADR Дизайн Agent Gateway — додаток `task` як агентний інтерфейс

## Context and Problem Statement
Зовнішній LLM-оркестратор має вміти звертатися до вбудованого агента додатку `task` природною мовою («створи задачу таку-то у проєкті такому-то»), щоб агент сам розвʼязав усі нюанси (mtDir, mode, дефолти, неоднозначності). При цьому той самий агент має бути однаково якісним для людини в UI та для зовнішнього агента.

## Considered Options
* Гранульовані MCP-тули (кожна операція — окремий тул; оркестратор сам обирає і кличе тули)
* Thick-агент (один мета-тул `request(intent)`, агент у додатку сам вирішує що зробити)
* Hybrid (і гранульовані тули, і мета-тул `request`)

## Decision Outcome
Chosen option: "Thick-агент через MCP-stdio (`request(intent)` + `respond(requestId, message)`)", because один спільний агент одночасно слугує людині в UI і зовнішнім агентам через MCP — «human-grade = agent-grade за побудовою»; гранульованість тулів не знімає проблему «треба знати нюанси проєкту» для оркестратора.

### Consequences
* Good, because transcript фіксує очікувану користь: MCP smoke-test пройшов end-to-end — зовнішній клієнт викликав `request`, агент Gemma сам визначив workspace, викликав `create`, повернув структурований результат і записав журнал.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Ключові рішення: транспорт — MCP-stdio (єдиний, Mac-only); тули — `request(intent)` і `respond(requestId, message)`; журнал — per-file `appLocalDataDir/requests/<id>.json` із `messages[]` для sessional-resume; trust — `tier`-scope (read/write/destructive) з фільтрацією маніфесту, `actor.id` — audit-лейбл із launch-arg (`--actor`). Файли: `app/src/tool/agent-handler.js`, `app/src/tool/journal.js`, `app/bin/task.mjs` (режим `mcp`), `docs/specs/260615-agent-gateway.md`. Баг «connection closed»: `return 0` після `server.connect()` вбивав процес — виправлено через `return new Promise(() => {})` (без `onclose`-хука, щоб не порушувати `unicorn/prefer-add-event-listener`).
