---
session: 5a27ef2b-566f-45fb-9a11-25dbbc20b542
captured: 2026-06-18T15:03:56+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/5a27ef2b-566f-45fb-9a11-25dbbc20b542.jsonl
---

## ADR tauri-plugin-agent як standalone Rust crate

## Context and Problem Statement
Плагін `tauri-plugin-agent` потрібен як Tauri 2 Rust plugin, що реєструє команди `journal_*` та `omlx_config`. Виникло питання, де розмістити crate та як його підключити до застосунку `task`.

## Considered Options
* Standalone crate у репозиторії `tauri-components` поряд із `npm/` workspace
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Standalone crate у репозиторії `tauri-components`", because плагін логічно належить до бібліотеки компонентів, а не до самого застосунку; crate виноситься за межі npm-workspace і підключається як git-залежність у `Cargo.toml`.

### Consequences
* Good, because тека журналу резолвиться з `app_local_data_dir` без хардкоду bundle-id (з override через `AGENT_REQUESTS_DIR`), а `build.rs` генерує `allow-journal-*` permissions — `agent:default` грантить усі п'ять.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `tauri-plugin-agent` реєструє команди як `plugin:agent|*`
- JS-пакет (`createTauriJournalStore`, `useOmlx`) оновлений для виклику `plugin:agent|*`
- Crate є поза npm-workspace; підключається через `Cargo.toml` app-застосунку як git-залежність

---

## ADR Git-залежність для tauri-plugin-agent замість path

## Context and Problem Statement
При підключенні `tauri-plugin-agent` до `Cargo.toml` застосунку `task` потрібно було обрати механізм залежності: path, git або інший спосіб.

## Considered Options
* path-залежність (простіше для локальної розробки, але прив'язує build до розташування чекаута)
* git-залежність (`git = "https://github.com/nitra/tauri-components"`)

## Decision Outcome
Chosen option: "git-залежність", because користувач явно обрав "3 — git" з запропонованих варіантів.

### Consequences
* Good, because build не залежить від локального розташування репозиторію `tauri-components`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Результат у `app/src-tauri/Cargo.toml`: `tauri-plugin-agent = { git = "https://github.com/nitra/tauri-components", ... }`

---

## ADR journal.rs залишається локальним у task

## Context and Problem Statement
`tauri-plugin-agent` надає webview-команди для роботи з журналом, але MCP node-оркестратор потребує standalone `journal`-бінар. Виникло питання про дублювання логіки між плагіном і локальним `journal.rs`.

## Considered Options
* Перенести `journal.rs` до плагіна і використовувати спільну логіку
* Залишити `journal.rs` локальним у `task/app/src-tauri/src/`

## Decision Outcome
Chosen option: "Залишити `journal.rs` локальним у `task/app/src-tauri/src/`", because MCP (node) і webview (Tauri) потребують різних транспортів; плагін дає лише webview-команди, тоді як node-оркестратор потребує окремого standalone-бінару.

### Consequences
* Good, because кожен транспорт (MCP/node і Tauri/webview) має власний незалежний шлях виконання.
* Bad, because існує усвідомлений логічний дубль між `journal.rs` у `task` і відповідною логікою в `tauri-plugin-agent`.

## More Information
- `journal.rs` розташований у `task/app/src-tauri/src/`
- Усвідомлений trade-off зафіксований у transcript явно

---

## ADR bin/task.mjs переписано на createAgentKit у межах міграції

## Context and Problem Statement
Після інверсії каталогу `bin/task.mjs` більше не міг викликати старі `handleRequest`. Виникло питання — залишати `bin/task.mjs` в обсязі поточної міграції чи відкласти.

## Considered Options
* Залишити `bin/task.mjs` в обсязі міграції та переписати
* Відкласти переписування на окрему задачу

## Decision Outcome
Chosen option: "Залишити `bin/task.mjs` в обсязі міграції та переписати", because користувач явно обрав "1 — лишити в обсязі"; файл переписано на `createAgentKit({ catalog, systemPrompt, transport: cliTransport, journal: nodeJournalStore })` з пакетними `runAgent/dispatch/manifest`.

### Consequences
* Good, because transcript фіксує очікувану користь: `bin/task.mjs` повністю сумісний з новим API після інверсії каталогу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `bin/task.mjs` переписано на `runAgent`/`dispatch`/`manifest` через `createAgentKit`

---

## ADR StatePill + STATUS_COLOR як спільний компонент у пакеті

## Context and Problem Statement
`jscpd` виявив вербатим-дублювання `STATUS_COLOR` і CSS-класу `.state-pill` між компонентами `AgentDialog`, `AuditDialog` та `RequestView`.

## Considered Options
* Зберігати дубльований `STATUS_COLOR` і `.state-pill` CSS у кожному компоненті окремо
* Винести в спільний компонент `StatePill.vue` і модуль `status.js` у пакеті

## Decision Outcome
Chosen option: "Винести в спільний компонент `StatePill.vue` і модуль `status.js`", because `jscpd` детектував вербатим-дублювання; єдине джерело правди усуває розсинхронізацію між компонентами.

### Consequences
* Good, because `AgentDialog`, `AuditDialog` та `RequestView` переписані на `<StatePill :status="..." />` — локальний `.state-pill` CSS і дубльований `STATUS_COLOR` прибрані.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/src/components/StatePill.vue` — новий компонент
- `npm/src/components/status.js` — єдине джерело `STATUS_COLOR`

---

## ADR Vitest server-side inline для @7n/tauri-components

## Context and Problem Statement
Vitest екстерналізує `node_modules` за замовчуванням, через що `.vue`-файли з пакета `@7n/tauri-components` не проходили через vue-плагін і тести падали з помилкою парсингу.

## Considered Options
* Залишити стандартну поведінку екстерналізації
* Додати `server: { deps: { inline: ['@7n/tauri-components'] } }` у конфіг Vitest

## Decision Outcome
Chosen option: "Додати `inline` для `@7n/tauri-components`", because без цього `.vue` з пакета не трансформуються vue-плагіном і тести не можуть виконуватися.

### Consequences
* Good, because `.vue`-компоненти з `@7n/tauri-components` коректно трансформуються під час тестів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Конфіг: `app/vitest.config.js`, параметр `server.deps.inline: ['@7n/tauri-components']`

---

## ADR Виправлення регресій 9156bf6 окремим комітом без реверту

## Context and Problem Statement
Коміт `9156bf6` містив 5 прихованих дефектів: стороннє `workspaces:["app"]` у `app/package.json`, видалені `@vue/compiler-sfc` та `@vue/test-utils`, рекурсивний tauri-скрипт, typo `--manifest_path`, module-level `localStorage.getItem` у `use-project-paths.js`.

## Considered Options
* Реверт коміту `9156bf6`
* Точкове виправлення регресій окремим комітом

## Decision Outcome
Chosen option: "Точкове виправлення регресій окремим комітом", because реверт скасував би всю корисну роботу коміту; дефекти були ізольовані й виправлені точково у коміті `137af6e`.

### Consequences
* Good, because корисні зміни з `9156bf6` збережені; build і тести відновлені.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Коміт з виправленнями: `137af6e`
- Виправлені файли: `app/package.json`, `app/src/composables/use-project-paths.js`

---

## ADR Lint baseline для tauri-components по канону myshare

## Context and Problem Statement
Репозиторій `tauri-components` мав CI workflows, але не мав конфігурацій лінтерів, що порушувало єдиний стандарт проєкту та спричиняло red CI.

## Considered Options
* Залишити репозиторій без lint-конфігів
* Додати повний lint baseline по канону myshare

## Decision Outcome
Chosen option: "Додати повний lint baseline", because новий репозиторій має відповідати стандарту проєкту; структуру взято з `myshare` і адаптовано під `npm/` + `tauri-plugin-agent/`.

### Consequences
* Good, because `tauri-components` отримав уніфіковану lint-інфраструктуру і всі lint-workflows стали зеленими.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `eslint.config.js`: extends `@nitra/eslint-config`
- `.jscpd.json`: `gitignore: true`, `minLines: 25`
- `.v8rignore`: ігнорує `tauri-plugin-agent/target/` та `tauri-plugin-agent/permissions/`
- devDependencies: `@nitra/eslint-config`, `@nitra/cspell-dict`
