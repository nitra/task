---
session: 5a27ef2b-566f-45fb-9a11-25dbbc20b542
captured: 2026-06-18T16:35:46+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/5a27ef2b-566f-45fb-9a11-25dbbc20b542.jsonl
---

Базуючись на аналізі transcript, ось ADR-блоки для задокументованих рішень:

---

## ADR Git-залежність для `tauri-plugin-agent` у `task`

## Context and Problem Statement
При додаванні `tauri-plugin-agent` до `app/src-tauri/Cargo.toml` треба було обрати спосіб прив'язки: локальний `path` або `git`. Path-залежність прив'язує збірку до конкретного розташування чекауту на диску.

## Considered Options
* `path`-залежність (`path = "../../../tauri-components/tauri-plugin-agent"`)
* `git`-залежність (`git = "https://github.com/nitra/tauri-components"`)

## Decision Outcome
Chosen option: "git-залежність", because користувач явно підтвердив вибір git (рішення 3), щоб збірка не була прив'язана до локального розташування чекауту.

### Consequences
* Good, because `cargo check` і `clippy -D warnings` проходять у CI без локального шляху до `tauri-components`.
* Bad, because git-залежність фіксує конкретний коміт (`#15a41271`); оновлення потребує ручного bumping.

## More Information
`app/src-tauri/Cargo.toml`: `tauri-plugin-agent = { git = "https://github.com/nitra/tauri-components", tag = "tauri-plugin-agent-v0.1.0" }`. `cargo tree` підтвердив: `tauri-plugin-agent v0.1.0 (https://github.com/nitra/tauri-components#15a41271)`.

---

## ADR Inline-трансформ пакета `@7n/tauri-components` у vitest

## Context and Problem Statement
`@7n/tauri-components` поставляє `.vue`-файли, але vitest за замовчуванням екстерналізує `node_modules` — `@vitejs/plugin-vue` не трансформує їх, що призводить до `ERR_PACKAGE_PATH_NOT_EXPORTED` або помилки парсингу при монтуванні компонентів у тестах.

## Considered Options
* Додати `server.deps.inline: ['@7n/tauri-components']` у `vitest.config.js`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "inline через `server.deps.inline`", because це мінімальне налаштування, що змушує vite-плагін компілювати `.vue`-файли пакета так само, як і локальні.

### Consequences
* Good, because усі 24 тести проходять після додавання (`Test Files 3 passed (3), Tests 24 passed (24)`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`app/vitest.config.js`: `server: { deps: { inline: ['@7n/tauri-components'] } }`. Проблема специфічна для пакетів із `.vue`-файлами (не `.js`-only бандлів).

---

## ADR Міграція `bin/task.mjs` у рамках інтеграції пакета

## Context and Problem Statement
CLI/MCP-оркестратор `bin/task.mjs` викликав старі локальні модулі `handleRequest`/`handleRespond`/`createDispatch`. Після інверсії каталогу ці модулі переїхали до `@7n/tauri-components`; потрібно було вирішити, чи переписувати оркестратор одразу, чи відкласти.

## Considered Options
* Лишити `bin/task.mjs` у поточному обсязі міграції та переписати
* Відкласти міграцію оркестратора

## Decision Outcome
Chosen option: "лишити в обсязі та переписати", because користувач явно підтвердив (рішення 1 — «лишити в обсязі»), і без цього CLI/MCP-шлях залишився б нефункціональним.

### Consequences
* Good, because `bin/task.mjs` використовує `createAgentKit`, `runAgent`, `createDispatch`, `listTools`, `toolManifest` з `@7n/tauri-components` — локальних дублів більше нема.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`app/bin/task.mjs`: замінено імпорти `agent-handler.js`, `dispatch.js`, `manifest.js` на `@7n/tauri-components`. MCP-транспорт і node-журнал залишились у `task` (доменна специфіка).

---

## ADR Збереження `journal.rs` для standalone MCP-бінара

## Context and Problem Statement
`tauri-plugin-agent` надає команди журналу лише для webview-шляху (Tauri IPC). Node MCP-оркестратор (`bin/task.mjs`) спілкується через окремий Rust-бінар `journal`. Постало питання: чи можна видалити `journal.rs` і перейти на плагін.

## Considered Options
* Видалити `journal.rs` і використовувати лише плагін
* Зберегти `journal.rs` для standalone-бінара

## Decision Outcome
Chosen option: "зберегти `journal.rs`", because користувач явно підтвердив (рішення 2 — «так»): плагін надає лише webview-команди, а node-шлях потребує власного бінара.

### Consequences
* Good, because MCP-сервер і Tauri GUI незалежно використовують журнал через свої шляхи.
* Bad, because є дублювання логіки журналу між `journal.rs` (standalone) і `tauri-plugin-agent` (webview).

## More Information
`app/src-tauri/src/journal.rs` і `app/src-tauri/bin/journal.rs` — лишились без змін. Webview-команди `journal_*` та `omlx_config` видалено з `lib.rs`; натомість підключено `.plugin(tauri_plugin_agent::init())`.

---

## ADR Локальний `tool/prompt.js` для доменного системного промпта

## Context and Problem Statement
Функція `createSystemPrompt` описує агенту специфіку mt-графів задач і grounding workspace — вона не є частиною загальної логіки агента. Постало питання: виносити її до `@7n/tauri-components` чи лишити локальною.

## Considered Options
* Лишити `createSystemPrompt` у локальному `app/src/tool/prompt.js`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "локальний `tool/prompt.js`", because системний промпт є task-специфічним (описує mt task-графи і workspace grounding) — загальний пакет надає лише `createAgentKit`; доменний контент залишається у репо-власника.

### Consequences
* Good, because пакет не несе доменних знань `task`; чіткий поділ між інфраструктурою агента і доменною конфігурацією.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`app/src/tool/prompt.js` — новий локальний файл. `use-agent.js` передає `createSystemPrompt` у `useAgentBase({ catalog: TOOLS, systemPrompt, grounding: { tool: 'workspaces', key: 'workspaces' } })`.

---

## ADR Окремий коміт для ремонту регресій `9156bf6`

## Context and Problem Statement
При rebase міграції на актуальний `main` виявилось, що коміт `9156bf6` вніс п'ять регресій: зайве поле `workspaces` у `app/package.json` (ламало hoisting `estree-walker`), відсутні devDeps `@vue/compiler-sfc` і `@vue/test-utils`, рекурсивний `tauri`-скрипт, typo `--manifest_path`, та module-level `localStorage` у `use-project-paths.js`. Потрібно було вирішити: зашити фікси в коміт міграції чи виокремити.

## Considered Options
* Виокремити ремонт у окремий коміт `fix(app): repair 9156bf6 regressions`
* Зашити виправлення в коміт міграції

## Decision Outcome
Chosen option: "окремий коміт", because git-history чіткіше розмежовує «міграція на пакет» і «ремонт зламаного коміту», що спрощує bisect і code review.

### Consequences
* Good, because коміт `137af6e` — окремий артефакт; регресії задокументовані у повідомленні.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Коміт `137af6e 🐛 fix(app): repair 9156bf6 regressions blocking build/tests`. Регресії: `workspaces:["app"]` у під-пакеті; відсутні `@vue/compiler-sfc`, `@vue/test-utils`; `"tauri": "bun --cwd=app run tauri"` (рекурсія); `--manifest_path` (typo); `localStorage.getItem` на module level у `use-project-paths.js`.

---

## ADR Ігнорування `docs/adr/**` і `docs/specs/**` у markdownlint

## Context and Problem Statement
`markdownlint-cli2` сканував авто-генеровані ADR-чернетки та специфікації (`docs/adr/`, `docs/specs/`), знаходячи сотні порушень (`MD024`, `MD003`, `MD060`) у файлах, що генеруються LLM-процесами й не призначені для ручного редагування.

## Considered Options
* Додати `ignores: ["docs/adr/**", "docs/specs/**", "AGENTS.md", "CLAUDE.md"]` у `.markdownlint-cli2.jsonc`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "ігнорувати генеровані теки в markdownlint", because виправлення 389 порушень у авто-генерованих файлах не має сенсу — вони перезаписуються наступним запуском ADR-нормалізатора.

### Consequences
* Good, because `lint-text` CI перейшов із `failure` у `success` на коміті `a450c22`.
* Bad, because markdownlint не стежить за якістю форматування ADR-файлів.

## More Information
`.markdownlint-cli2.jsonc`: додано поле `ignores`. Аналогічно `.cspell.json` вже мав `"docs/adr/**"` в `ignorePaths` до початку сесії.

---

## ADR Розвідка перед інтеграцією агента в `mlmail` і `myshare`

## Context and Problem Statement
Перед початком інтеграції `@7n/tauri-components` у `mlmail` і `myshare` було невідомо, які Tauri-команди вже існують, де в UI вставити `AgentDialog`, і яка природа субтитрів у `myshare` (локальний кеш чи live-fetch). Сліпе копіювання паттерну `task` могло б пропустити необхідні нові Rust-команди.

## Considered Options
* Спочатку запустити паралельну розвідку (два агенти), потім реалізовувати
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "розвідка перед реалізацією", because млімейл і myshare мають різні наявні команди (`list_messages`/`get_message`/`delete_message` vs `load_items`/`save_items`) — обсяг нових Rust-команд залежить від цих відмінностей, тому спочатку розвідка, потім план.

### Consequences
* Good, because розвідка виявила, що `myshare` потребує нових Rust-команд (`add_link`, `list_links`, `get_subtitles`), яких ще нема — це вплинуло б на план реалізації.
* Bad, because реалізація відкладається до отримання відповідей на три уточнювальні питання (стратегія кешування субтитрів, scope пошуку пошти, автор системних промптів).

## More Information
Розвідка проводилась двома паралельними агентами (`/Users/vitalii/www/vitaliytv/mlmail` та `/Users/vitalii/www/vitaliytv/myshare`). `mlmail` має готові команди для всіх трьох операцій агента. `myshare` потребує нових Rust-команд поверх наявних `load_items`/`save_items`.
