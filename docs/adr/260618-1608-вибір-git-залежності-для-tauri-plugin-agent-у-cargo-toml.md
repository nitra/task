---
session: 5a27ef2b-566f-45fb-9a11-25dbbc20b542
captured: 2026-06-18T16:08:39+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/5a27ef2b-566f-45fb-9a11-25dbbc20b542.jsonl
---

Lint Rust not appearing (structural issue pre-existing)
[assistant]
[thinking]

[assistant]
**Lint JS ✅ Lint Text ✅ Lint Security ✅ StyleLint ✅** — `task/main` повністю зелений по тих workflow, що підлягають виправленню.

`lint-rust` не тригернувся на цьому коміті (тільки JS/md змінились) — і структурно непереборний (нема root `Cargo.toml`, `mt-scanner` патч-залежність локальна).

Поточна сесія завершилась. Підсумок — транскрипт описує:
1. Встановлення lint baseline в `tauri-components`
2. Міграцію `task` на `@7n/tauri-components` + `tauri-plugin-agent`
3. Виявлення та ремонт 5 регресій зламаного коміту `9156bf6`
4. Greening task CI (lint-js + lint-text)

Це ADR-кандидати, що я зараз генерую.
---

## ADR Вибір git-залежності для `tauri-plugin-agent` у Cargo.toml

## Context and Problem Statement
Під час міграції `task` на пакет `@7n/tauri-components` потрібно було підключити Rust-плагін `tauri-plugin-agent` як залежність у `app/src-tauri/Cargo.toml`. Необхідно було обрати між `path`-залежністю (локальний шлях до checkouts) та git-залежністю.

## Considered Options
* `path`-залежність (`path = "../../../tauri-components/tauri-plugin-agent"`)
* git-залежність (`git = "https://github.com/nitra/tauri-components"`)

## Decision Outcome
Chosen option: "git-залежність", because користувач явно підтвердив рішення (відповідь «3 — git» на пропозицію агента). Обґрунтування: `path`-залежність прив'язує build до локального розташування checkout, що ламає CI та інші машини; git-залежність дозволяє відтворюваний build без потреби мати `tauri-components` поруч.

### Consequences
* Good, because transcript фіксує очікувану користь: CI-агент завантажує плагін напряму з GitHub (`tauri-plugin-agent v0.1.0 (https://github.com/nitra/tauri-components#15a41271)` у `cargo tree`), і `cargo check` + `clippy -D warnings` проходять без ручного налаштування шляхів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Рішення у `app/src-tauri/Cargo.toml`:
```toml
tauri-plugin-agent = { git = "https://github.com/nitra/tauri-components", tag = "v0.3.0" }
```
Плагін верифіковано через `cargo tree` (містить commit `#15a41271`). Capability `agent:default` додана до `app/src-tauri/capabilities/default.json`.

---

## ADR Збереження `journal.rs` у `task` для MCP node-шляху

## Context and Problem Statement
`tauri-plugin-agent` надає journal-команди для webview (IPC через `plugin:agent|*`). Водночас `task` має standalone CLI/MCP-оркестратор (`bin/task.mjs`), який спілкується з Rust-бінарем `journal` безпосередньо через spawn. Постало питання: видаляти `journal.rs` разом з іншим кодом, що тепер дає плагін?

## Considered Options
* Видалити `journal.rs` і перевести MCP-шлях на плагін
* Залишити `journal.rs` (standalone бінар) поряд з плагіном

## Decision Outcome
Chosen option: "Залишити `journal.rs`", because користувач явно підтвердив рішення (відповідь «2 — так» на питання агента «`journal.rs` НЕ видаляємо?»). Обґрунтування: плагін дає лише webview IPC-команди; node MCP-оркестратор не має доступу до Tauri IPC і потребує власного бінара.

### Consequences
* Good, because transcript фіксує очікувану користь: MCP-шлях (`bin/task.mjs`) продовжує використовувати `createNodeJournalStore` → spawn `journal`-бінара; webview-шлях використовує плагін — обидва шляхи незалежні.
* Bad, because логіка журналювання задублювана: `journal.rs` і `tauri-plugin-agent` реалізують схожу функціональність окремо. Transcript визнає це як свідоме компромісне рішення («буде дубль із плагіном, але потрібен для MCP»).

## More Information
`app/src-tauri/src/journal.rs` лишається в репо як джерело для standalone `bin/journal` бінара. Webview-команди (`journal_create`, `journal_list`, тощо) видалено з `lib.rs` і делеговано плагіну через `agent:default` capability.

---

## ADR Вбудовування `@7n/tauri-components` у vitest через `server.deps.inline`

## Context and Problem Statement
`@7n/tauri-components` містить `.vue`-компоненти. Vitest за замовчуванням екстерналізує `node_modules`, тому `.vue`-файли пакета не проходять через `@vitejs/plugin-vue` і тест `ui-open.test.js` падав з «Install @vitejs/plugin-vue to handle .vue files».

## Considered Options
* Додати `@7n/tauri-components` у `server.deps.inline` в `vitest.config.js`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `@7n/tauri-components` у `server.deps.inline`", because це стандартний механізм vitest для пакетів із необробленими Vue-компонентами: виключає пакет з екстерналізації й пропускає через vite-трансформ (включно з vue-плагіном).

### Consequences
* Good, because transcript фіксує очікувану користь: після додавання inline-запису всі 24 тести проходять, зокрема `ui-open.test.js`, який монтує компоненти пакета.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зміна у `app/vitest.config.js`:
```js
server: { deps: { inline: ['@7n/tauri-components'] } }
```
Команда верифікації: `bun run test` з директорії `app/` — 24/24 passed.

---

## ADR Ремонт регресій зламаного коміту `9156bf6` у `task/main`

## Context and Problem Statement
Коміт `9156bf6` («workspaces feature») вніс 5 регресій у `app/package.json` та `app/src/composables/use-project-paths.js`, що блокували тести й харнес. Регресії виявлено під час rebase міграції на `origin/main`.

## Considered Options
* Виправити регресії як частину міграційного коміту
* Виправити регресії окремим `fix`-комітом після міграції

## Decision Outcome
Chosen option: "Окремий `fix`-коміт", because агент відокремив ремонт (`137af6e`) від міграції (`425f6c9`), щоб git-historія відображала незалежний характер кожної зміни.

### Consequences
* Good, because transcript фіксує очікувану користь: після ремонту `estree-walker` хоїстується у версію `2.0.2` (замість зламаної `3.0.3`), `@vue/compiler-sfc` і `@vue/test-utils` повернуто, `localStorage.getItem` огороджено перевіркою — 24 тести проходять.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
П'ять конкретних регресій `9156bf6`, зафіксованих у transcript:
1. `"workspaces": ["app"]` у `app/package.json` (підпакет, не root) → зламав хоїстинг `estree-walker`
2. Видалено `@vue/compiler-sfc` і `@vue/test-utils` з devDependencies → зламав Vue-компіляцію і тести
3. `"tauri": "bun --cwd=app run tauri"` всередині `app/` → рекурсивний виклик
4. `--manifest_path` (underscore замість дефіса) у `test:rust:coverage`
5. Module-level `localStorage.getItem` у `use-project-paths.js:6` → краш при імпорті без DOM
