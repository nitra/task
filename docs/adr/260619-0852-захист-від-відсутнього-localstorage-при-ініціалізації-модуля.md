---
session: 5a27ef2b-566f-45fb-9a11-25dbbc20b542
captured: 2026-06-19T08:52:28+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/5a27ef2b-566f-45fb-9a11-25dbbc20b542.jsonl
---

## ADR Захист від відсутнього localStorage при ініціалізації модуля

## Context and Problem Statement
Виконання `JSON.parse(localStorage.getItem(...))` на рівні модуля (module-scope side-effect) призводило до падіння тестів і SSR, де `localStorage` недоступний. Проблема вперше виявлена у `use-project-paths.js` (коміт `9156bf6`) і потім у пакетному `use-omlx.js` з `@7n/tauri-components`.

## Considered Options
* Зберегти читання `localStorage` на рівні модуля, але передавати mock у тестах
* Перемістити ініціалізацію всередину функції (`useProjectPaths()`) — ледача оцінка
* Обернути кожне читання/запис у guard-функцію (`readStored`/`writeStored`) — безпечна операція: повертає дефолт, коли `localStorage` відсутній

## Decision Outcome
Chosen option: "guard-функція навколо localStorage", because дозволяє зберегти module-level singleton (shared ref між компонентами) без падіння при import у тестах чи SSR.

### Consequences
* Good, because transcript фіксує очікувану користь: `ui-open.test.js` і тест-пакет mlmail перестали падати після застосування патерну.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `app/src/composables/use-project-paths.js`, `npm/src/vue/use-omlx.js` (пакет `@7n/tauri-components`, реліз `0.4.1`). Патерн: `const readStored = (key, def) => { try { return JSON.parse(localStorage.getItem(key) ?? null) ?? def } catch { return def } }`.

---

## ADR Збереження error.kind у envelope createDispatch

## Context and Problem Statement
Пакетний `createDispatch` відкидав поле `kind` з бекендних помилок, повертаючи лише `{ ok: false, error: { code: 'io', message } }`. Застосунок `mlmail` покладається на `error.kind === 'ReauthRequired'` для ре-авторизації OAuth — без нього re-auth-flow зламується.

## Considered Options
* Залишити mlmail-специфічний форкнутий dispatch (не мігрувати)
* Розширити пакетний dispatch: копіювати `kind` із бекендної помилки на envelope, якщо є

## Decision Outcome
Chosen option: "розширити пакетний dispatch", because усуває потребу у форкнутому dispatch і зберігає type-driven error routing у споживачах.

### Consequences
* Good, because transcript фіксує очікувану користь: mlmail-app може читати `result.error.kind ?? 'Unknown'` без власного dispatch.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `npm/src/core/dispatch.js` (пакет `@7n/tauri-components`, реліз `0.4.0`). Доданий тест: `npm/src/core/dispatch.test.js`. Споживач: `app/src/services/auth-store.js` у mlmail (`kind ?? 'Unknown'`).

---

## ADR Параметр transport у useAgent для кастомних транспортів

## Context and Problem Statement
`useAgent` у `@7n/tauri-components/vue` хардкодив `tauriTransport` (Rust invoke). Застосунок myshare потребував OPFS-транспорт для зберігання лінків у браузерній файловій системі без Rust-шару.

## Considered Options
* Додати окремий composable `useAgentOpfs` у пакет
* Прийняти опціональний параметр `transport` у `useAgent`, дефолт — `tauriTransport`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "опціональний параметр transport у useAgent", because дозволяє перевизначити транспорт без дублювання логіки агента (журнал, LLM-виклики, tier-scope).

### Consequences
* Good, because transcript фіксує очікувану користь: myshare може передати OPFS-transport без форку пакета.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `npm/src/vue/use-agent.js` (пакет `@7n/tauri-components`, реліз `0.4.0`). Запланований споживач: `myshare/app/src/composables/use-agent.js`.

---

## ADR Gmail видалення через Trash замість безповоротного Delete

## Context and Problem Statement
Агент mlmail потребує інструмента видалення електронних листів. Gmail API надає два варіанти: `DELETE` (безповоротне видалення) і `trash` (переміщення до кошика).

## Considered Options
* `DELETE` — безповоротне видалення
* `trash` — переміщення до кошика (оборотна операція)

## Decision Outcome
Chosen option: "trash", because операція оборотна — користувач або агент може помилитись.

### Consequences
* Good, because transcript фіксує очікувану користь: агентні помилки можна відкотити через відновлення з кошика.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізація: новий Tauri-команд `gmail_trash` у `app/src-tauri/src/gmail/mod.rs` (mlmail). OAuth-scope `gmail.modify` вже присутній у `app/src-tauri/src/auth/flow/macos.rs` — додаткових змін авторизації не потрібно. Tier інструмента у каталозі: `destructive`.

---

## ADR OPFS для персистенції лінків у myshare

## Context and Problem Statement
Лінки у myshare зберігались у `localStorage` (JS-side), без Rust-бекенду. Для агентного доступу (add_link / list_links) потрібна персистентна сховище, доступна як через UI, так і через інструменти агента.

## Considered Options
* JSON-файл через Rust (`tauri-plugin-fs`)
* SQLite через Rust
* OPFS (Origin Private File System) — браузерна FS, JS-side

## Decision Outcome
Chosen option: "OPFS", because дозволяє реалізувати інструменти `add_link`/`list_links` як JS-handlers без нових Rust-команд, використовуючи `transport`-override у `useAgent`.

### Consequences
* Good, because transcript фіксує очікувану користь: не потребує Rust-шару, сумісно з кастомним transport у `useAgent`.
* Neutral, because transcript не містить підтвердження наслідку: доступність OPFS у Tauri-webview на всіх платформах не верифікована у сесії.

## More Information
Запланований spoживач: `myshare/app/src/composables/use-agent.js` (OPFS-transport, не реалізовано до кінця transcript). Транспорт передається через новий параметр `useAgent({ transport })` з `@7n/tauri-components@0.4.0`.
