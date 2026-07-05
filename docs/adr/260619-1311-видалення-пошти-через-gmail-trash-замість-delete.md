---
session: 5a27ef2b-566f-45fb-9a11-25dbbc20b542
captured: 2026-06-19T13:11:14+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/5a27ef2b-566f-45fb-9a11-25dbbc20b542.jsonl
---

## ADR Видалення пошти через Gmail Trash замість DELETE

## Context and Problem Statement

При реалізації агентного інструменту `gmail_trash` у `mlmail` потрібно було вирішити, чи видаляти листи назавжди (Gmail API `DELETE`) або переміщувати в кошик (`POST .../trash`).

## Considered Options

- Переміщення в кошик через `gmail.modify` scope (`POST .../trash` — оборотна операція)
- Постійне видалення через `gmail.modify` scope (`DELETE` — незворотня операція)

## Decision Outcome

Chosen option: "Переміщення в кошик через `gmail.modify` scope", because листи з агентного контексту видаляються без підтвердження від користувача, і оборотна операція безпечніша у разі помилки агента.

### Consequences

- Good, because `gmail.modify` scope вже був у `app/src-tauri/src/auth/flow/macos.rs:13` — не потребує зміни OAuth-scopes і повторної авторизації.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Нова команда `gmail_trash` додана в `app/src-tauri/src/gmail/mod.rs`; зареєстрована в `lib.rs` поряд із `gmail_search` та `gmail_read`. Capability `app/src-tauri/capabilities/default.json` отримала `agent:default` + `http:default`.

---

## ADR OPFS як сховище лінків у myshare замість localStorage

## Context and Problem Statement

myshare зберігав список поширених лінків у `localStorage` через `url-history.js`. Для агентних інструментів `add_link`/`list_links` потрібне сховище, доступне і UI, і агентові (без Rust-персистенції, оскільки всі обробники — JS `tool.run()`).

## Considered Options

- OPFS (Origin Private File System) — асинхронний браузерний файловий API, більша квота, недоступний іншим origins
- JSON-файл через Rust/`tauri-plugin-fs`
- localStorage (синхронний, той самий механізм, що вже існував)

## Decision Outcome

Chosen option: "OPFS", because він дає більшу квоту та ізоляцію без додаткового Rust-коду; транспорт агента — JS `run()`-хендлер, тож Rust не потрібен.

### Consequences

- Good, because `link-store.js` містить `_resetForTest` + in-memory fallback для happy-dom (де OPFS недоступний), що дозволяє покривати логіку тестами без мокування.
- Bad, because OPFS недоступний у Android WebView до певної версії — але transcript фіксує, що Android-шлях у myshare базується на `consumePendingSharedText` (Tauri), а не на прямому браузерному OPFS.

## More Information

Файли: `app/src/link-store.js` (OPFS + fallback), `app/src/link-store.test.js`. `url-history.js` та `url-history.test.js` видалено через `git rm`. `app/src/App.vue` у `onMounted` мігрує localStorage-лінки до OPFS.

---

## ADR Збереження `error.kind` у пакетному `createDispatch`

## Context and Problem Statement

mlmail's `auth-store.js` розрізняє типи помилок бекенду за полем `error.kind` (наприклад `'ReauthRequired'`) для повторної авторизації. Пакетний `createDispatch` з `@7n/tauri-components` не передавав це поле в уніфікований конверт `{ ok, error }`.

## Considered Options

- Зберігати `error.kind` з відповіді бекенду в конверті помилки `dispatch`
- Залишити нормалізацію у споживача (`?? 'Unknown'`)

## Decision Outcome

Chosen option: "Зберігати `error.kind` з відповіді бекенду в конверті помилки `dispatch`", because будь-який споживач пакета може мати типізовану обробку помилок; перекладати це на кожен сайт виклику — порушення DRY.

### Consequences

- Good, because transcript фіксує очікувану користь: mlmail `auth-store.js` може лишити `result.error.kind ?? 'Unknown'` замість власного `getErrorKind()`.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Зміна: `npm/src/core/dispatch.js` у `@7n/tauri-components`, опублікована як `0.4.0`. Тест `dispatch.test.js` перевіряє, що `kind` зберігається при наявності та відсутній — `undefined` (не `'Unknown'`). mlmail: дефолт `?? 'Unknown'` залишений у `auth-store.js`.

---

## ADR Опція `transport` у `useAgent` для JS-інструментів (myshare)

## Context and Problem Statement

myshare використовує JS-хендлери (`tool.run(input, ctx)`) замість Tauri-команд, бо інструменти (YouTube-транскрипти, переклад, OPFS-лінки) — чисто браузерні. Пакетний `useAgent` за замовчуванням будує `tauriTransport` (через `invoke`), що не підходить для myshare.

## Considered Options

- Додати параметр `transport` до `useAgent`, що дозволяє споживачу підмінити транспорт
- Форкнути `use-agent` у myshare для кастомного транспорту

## Decision Outcome

Chosen option: "Додати параметр `transport` до `useAgent`", because myshare — другий такий споживач; форк відтворив би проблему дедуплікації, яку вся міграція і вирішує.

### Consequences

- Good, because transcript фіксує очікувану користь: `app/src/composables/use-agent.js` у myshare передає `transport: (tool, input) => tool.run(input)` і не потребує власної агентної машинерії.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Зміна у `npm/src/vue/use-agent.js`, опублікована як `0.4.0` (разом із `error.kind`). myshare `app/src/composables/use-agent.js` інжектує `runTransport`. Інструменти `translate` зберігають `ctx.onProgress`/`ctx.signal` через локальний `dispatch` (UI), не через агентний шлях.

---

## ADR Ігнорування згенерованих артефактів у lint-text (cspell / markdownlint / v8r)

## Context and Problem Statement

`bun run lint` у `task` мав численні помилки `lint-text` (cspell, markdownlint, v8r), які стосувалися не власного коду, а: build-артефактів (`app/dist/`), Tauri-генерованих схем (`app/src-tauri/gen/`), Rust-локального build-каталогу (`app/src-tauri/target/`), авто-генерованих ADR/специфікацій (`docs/adr/**`, `docs/specs/**`), k8s-маніфестів і Cargo-конфігів.

## Considered Options

- Додати ці шляхи в ignore-списки відповідних linter-конфігів (`.cspell.json`, `.markdownlint-cli2.jsonc`, `.v8rignore`)
- Виправити кожну помилку в кожному файлі вручну

## Decision Outcome

Chosen option: "Додати ці шляхи в ignore-списки", because файли або генеруються автоматично (Tauri gen, Cargo target, ADR-чернетки), або є зовнішнім інфра-бором (k8s), де lint-порушення не несуть ризику для продукту.

### Consequences

- Good, because transcript фіксує очікувану користь: `lint-text exit=0` після всіх змін; CI `Lint Text` позеленів на `a450c22`.
- Bad, because нові файли у проігнорованих теках більше не перевіряються — але це прийнятно для генерованого/інфра-коду.

## More Information

`.cspell.json`: `ignorePaths` розширено на `**/dist/**`, `**/src-tauri/gen/**`, `**/src-tauri/target/**`, `k8s/**`; `words` розширено доменними термами (`staticlib`, `cdylib`, `serde`, `instrumenter`, `statefulset`, `stry`, `tctl`, `краш`, `макроса`, `плагіна` тощо). `.markdownlint-cli2.jsonc`: `ignores` додано `docs/adr/**`, `docs/specs/**`, `AGENTS.md`, `CLAUDE.md`. `.v8rignore`: додано `.cursor/hooks.json`, `.claude/settings.local.json`, `.mt.json`, `app/src-tauri/target/`, `app/src-tauri/gen/`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/capabilities/`, `k8s/**`, `.cargo/`.

---

## ADR `useOmlx` — guard читання/запису `localStorage`

## Context and Problem Statement

Під час тестів mlmail та myshare (happy-dom environment) пакетний `useOmlx` падав при ініціалізації модуля, бо happy-dom не надає `localStorage` у деяких контекстах.

## Considered Options

- Захистити всі читання/записи `localStorage` у `useOmlx` через `try/catch`
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Захистити всі читання/записи `localStorage` у `useOmlx` через `try/catch`", because той самий патерн вже застосований у `use-project-paths.js` у `task`.

### Consequences

- Good, because transcript фіксує очікувану користь: mlmail-тести перейшли від «Cannot find package» до 75 success після `0.4.1`.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Файл: `npm/src/vue/use-omlx.js` у `@7n/tauri-components`, опублікований як `0.4.1`. Відповідний патерн у `task`: `app/src/composables/use-project-paths.js`.
