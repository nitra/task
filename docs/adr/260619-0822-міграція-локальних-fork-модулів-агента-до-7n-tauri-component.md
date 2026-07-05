---
session: 5a27ef2b-566f-45fb-9a11-25dbbc20b542
captured: 2026-06-19T08:22:59+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/5a27ef2b-566f-45fb-9a11-25dbbc20b542.jsonl
---

## ADR Міграція локальних fork-модулів агента до `@7n/tauri-components`

## Context and Problem Statement

Додатки `task`, `mlmail` і `myshare` мали власні локальні копії одного й того самого агентного рушія: `dispatch.js`, `manifest.js`, `scope.js`, `transports.js`, `llm.js`, `journal-store-tauri.js`, а також Vue-компоненти `AgentDialog`, `AuditDialog`, `RequestView`, `BaseDialog`, `DialogActions`. Зміни в логіці агента потребували синхронізації в кожному проєкті вручну — ця синхронізація вже вийшла з ладу (в `task` коміт `9156bf6` замінив `AgentDialog.vue` і `RequestView.vue` порожніми заглушками `...`).

## Considered Options

- Зберегти локальні копії та виправляти кожен проєкт окремо.
- Замінити локальні fork-модулі на єдиний shared-пакет `@7n/tauri-components` (npm) + Rust-крейт `tauri-plugin-agent` (git-залежність).

## Decision Outcome

Chosen option: "Замінити на `@7n/tauri-components` + `tauri-plugin-agent`", because локальні копії вийшли з синхронізації й transcript фіксує явне завдання «migrate the agent engine + UI to the shared package instead of local copies».

### Consequences

- Good, because transcript фіксує очікувану користь: усуває дрейф між проєктами; в `task` 24 тести пройшли після міграції, `cargo clippy -D warnings` чистий, `AgentDialog`/`RequestView` відновлено з канонічних версій пакета.
- Bad, because `vitest` усуває `node_modules` з перетворення за замовчуванням — потрібне додаткове налаштування `server.deps.inline` для `.vue`-файлів пакета (see More Information).

## More Information

- `app/package.json` (`task`): `"@7n/tauri-components": "^0.3.0"` додано через `bun add`.
- `app/src-tauri/Cargo.toml` (`task`): `tauri-plugin-agent = { git = "https://github.com/nitra/tauri-components#15a41271" }`.
- `app/src-tauri/capabilities/default.json` (`task`): додано `"agent:default"`.
- `app/src-tauri/src/lib.rs` (`task`): видалено Tauri-команди `journal_*` та `omlx_config` — тепер через `plugin:agent|*`; `journal.rs` залишено для standalone `journal`-бінара (node MCP).
- Аналогічно `mlmail/app/src-tauri/Cargo.toml` і `mlmail/app/src-tauri/capabilities/default.json` оновлено тим самим патерном.
- Коміти в `nitra/task`: `425f6c9` (міграція), `137af6e` (ремонт регресій `9156bf6`), `a450c22` (lint-greening).

---

## ADR `server.deps.inline` для `.vue`-файлів пакета у vitest

## Context and Problem Statement

Після додавання `@7n/tauri-components` у `task` тест-харнес `vitest` завершився з `ERR_PACKAGE_PATH_NOT_EXPORTED` (estree-walker) при спробі обробити `.vue`-файли з пакета: `vitest` за замовчуванням екстерналізує `node_modules`, і Vue-плагін їх не трансформує.

## Considered Options

- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `@7n/tauri-components` до `server.deps.inline` у `app/vitest.config.js`", because transcript фіксує прямий висновок: «SPEC §7: vitest екстерналізує node_modules, тож `.vue` пакета не проходить через vue-плагін. Додаю інлайн пакета в тест-конфіг `task`».

### Consequences

- Good, because transcript фіксує очікувану користь: після зміни всі 24 тести `task` пройшли.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Файл: `app/vitest.config.js` (`task`); додано `server: { deps: { inline: ['@7n/tauri-components'] } }` до `defineConfig({ test: { ... } })`.

---

## ADR Gmail `trash` замість постійного `delete` у `mlmail`

## Context and Problem Statement

Агент `mlmail` повинен вміти видаляти листи. Gmail API надає два ендпоінти: `messages.delete` (постійне незворотне видалення) і `messages.trash` (переміщення в кошик з можливістю відновлення).

## Considered Options

- `messages.delete` — постійне видалення.
- `messages.trash` — переміщення в кошик (оборотна операція).

## Decision Outcome

Chosen option: "`messages.trash`", because користувач явно підтвердив «у Trash» у відповідь на питання про деструктивність операції.

### Consequences

- Good, because transcript фіксує очікувану користь: операція оборотна — лист можна відновити з кошика.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- OAuth scope `https://www.googleapis.com/auth/gmail.modify` вже присутній у `mlmail/app/src-tauri/src/auth/flow/macos.rs:13` — додаткових змін авторизації не потрібно.
- Нова команда `gmail_trash(id)` додана до `mlmail/app/src-tauri/src/gmail/mod.rs` і зареєстрована в `lib.rs`.

---

## ADR OPFS для персистенції лінків у `myshare`

## Context and Problem Statement

У `myshare` лінки зберігалися виключно в `localStorage` (JavaScript, без Rust-бекенду). Агент повинен уміти додавати нові лінки (`add_link`) і переглядати вже додані (`list_links`). `localStorage` — це тимчасове браузерне сховище, що не гарантує збереження між оновленнями Tauri WebView і не доступне через Rust.

## Considered Options

- Rust-команда + JSON-файл у app-data (запропоновано асистентом).
- OPFS (Origin Private File System — Web API, доступний у Tauri WebView).

## Decision Outcome

Chosen option: "OPFS", because користувач запропонував «а можна для цього opfs використовувати?», і асистент підтвердив, що OPFS працює у Tauri WebView — інструменти `add_link`/`list_links` реалізуються як JS-handlers без нової Rust-команди.

### Consequences

- Good, because Neutral, because transcript не містить підтвердження наслідку — реалізацію OPFS-шару не розпочато в межах цього transcript.
- Bad, because Neutral, because transcript не містить підтвердження наслідку.

## More Information

- Рішення ухвалено наприкінці сесії; код `myshare` на момент завершення transcript не змінено.
- Існуючі команди `myshare`: `yt_get_transcript`, `yt_list_languages` (`myshare/app/src-tauri/src/lib.rs`) — їх планується виставити як інструмент `view_subtitles`.
