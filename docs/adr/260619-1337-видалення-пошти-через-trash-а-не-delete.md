---
session: 5a27ef2b-566f-45fb-9a11-25dbbc20b542
captured: 2026-06-19T13:37:40+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/5a27ef2b-566f-45fb-9a11-25dbbc20b542.jsonl
---

## ADR Видалення пошти через Trash, а не Delete

## Context and Problem Statement

При інтеграції LLM-агента в `mlmail` агент отримав можливість видаляти листи. Деструктивна операція незворотна, тому постало питання, яку Gmail API-дію використовувати: постійне видалення (`DELETE`) чи переміщення в кошик (`trash`).

## Considered Options

- Gmail `trash` — переміщення листа в кошик (оборотна дія)
- Gmail `DELETE` — постійне видалення (незворотна дія)

## Decision Outcome

Chosen option: "Gmail `trash`", because користувач явно обрав `trash` як безпечнішу дію. OAuth-scope `gmail.modify` вже наявний (`app/src-tauri/src/auth/flow/macos.rs:13`), тому нова авторизація не потрібна.

### Consequences

- Good, because операція є оборотною — лист можна відновити з кошика вручну.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Нова Tauri-команда `gmail_trash` додана в `mlmail/app/src-tauri/src/gmail/mod.rs`. Інструмент у каталозі отримав `tier: 'destructive'`, що активує approval-flow пакета перед виконанням.

---

## ADR OPFS-сховище для лінків у myshare

## Context and Problem Statement

`myshare` зберігав список доданих користувачем лінків у `localStorage` браузера. При інтеграції LLM-агента інструменти `add_link` та `list_links` потребували сховища, доступного як UI-коду, так і агентним JS-хендлерам. `localStorage` синхронний і не підходить для великих колекцій.

## Considered Options

- OPFS (Origin Private File System) — асинхронний FS-API браузера, доступний у Tauri WebView
- Зберігати лінки в Rust (JSON-файл через `tauri-plugin-agent` або SQLite)
- Залишити `localStorage`

## Decision Outcome

Chosen option: "OPFS", because користувач підтвердив OPFS як підходящий варіант; пакет вже надає `transport`-опцію (0.4.1), що дозволяє хендлерам каталогу бути звичайними JS-функціями без Tauri-команд.

### Consequences

- Good, because transcript фіксує очікувану користь: інструменти `add_link`/`list_links` реалізовані як JS `run()`-хендлери без нових Rust-команд; OPFS підтримує fallback для тестів (happy-dom не надає OPFS — автоматичний in-memory path у `_resetForTest`).
- Bad, because дані в OPFS ізольовані від нативної FS — їх не можна прочитати зовнішніми інструментами без WebView.

## More Information

Реалізація: `myshare/app/src/link-store.js` (OPFS + in-memory fallback). Тести: `myshare/app/src/link-store.test.js` — покривають fallback-гілку (9 файлів, 105 тестів зелені).

---

## ADR `transport`-опція в `useAgent` для JS-хендлер-каталогів

## Context and Problem Statement

`useAgent` у пакеті `@7n/tauri-components` за замовчуванням будує dispatch через Tauri `invoke`. `myshare` використовує каталог з JS `run()`-хендлерами (YouTube transcript, OPFS links, page-meta), де Tauri-transport не підходить. Потрібно було з'єднати агентний рушій пакета з локальним JS-транспортом без форку.

## Considered Options

- `transport`-опція в `useAgent` — передавати кастомний transport-fn при ініціалізації
- Форкнути `useAgent` у кожному додатку

## Decision Outcome

Chosen option: "`transport`-опція в `useAgent`", because це дозволяє одному пакету обслуговувати обидва варіанти (Tauri-invoke для mlmail/task, JS-run для myshare) без дублювання агентного рушія.

### Consequences

- Good, because transcript фіксує очікувану користь: `myshare/app/src/composables/use-agent.js` передає `transport: tool => tool.run` і всі 105 тестів проходять.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Розширення випущено у `@7n/tauri-components@0.4.0` (`npm/src/vue/use-agent.js`). Зміна non-breaking: якщо `transport` не передано — поведінка ідентична попередній.

---

## ADR Збереження `error.kind` у dispatch-конверті

## Context and Problem Statement

`mlmail` розгалужує логіку повторної авторизації на основі `error.kind === 'ReauthRequired'` у `auth-store.js`. Пакетний `createDispatch` відкидав метадані помилки бекенду, що зламало б re-auth flow при міграції з форкнутого dispatch.

## Considered Options

- Копіювати `error.kind` з відповіді бекенду в `io`-конверт dispatch
- Вимагати від додатків розбирати `error.message` регулярним виразом

## Decision Outcome

Chosen option: "Копіювати `error.kind` з відповіді бекенду в `io`-конверт dispatch", because це зберігає сумісність із наявним `mlmail/app/src/services/auth-store.js` без зміни бекенд-коду або протоколу помилок.

### Consequences

- Good, because transcript фіксує очікувану користь: `auth-store.js` отримує `result.error.kind ?? 'Unknown'` і всі 79 тестів mlmail проходять.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Розширення випущено у `@7n/tauri-components@0.4.0` (`npm/src/core/dispatch.js`). Тест: `npm/src/core/dispatch.test.js` — «preserves backend error.kind». Rust-сторона передає `kind` у серіалізованій помилці через `serde`.

---

## ADR Shared testing subpath `@7n/tauri-components/testing`

## Context and Problem Statement

Усі три додатки (task, mlmail, myshare) містили ідентичний файл `test-utils/quasar.js` (~20 рядків): реєстрація всіх `Q*`-компонентів + `mountQuasar`/`mountWithQuasar`. Копія синхронізувалась вручну й могла розійтись.

## Considered Options

- Новий subpath `@7n/tauri-components/testing` з `mountQuasar`/`mountWithQuasar`
- Окремий npm-пакет `@7n/test-utils`
- Залишити три незалежні копії

## Decision Outcome

Chosen option: "Новий subpath `@7n/tauri-components/testing`", because helper тісно пов'язаний з Quasar-компонентами пакета і логічно лежить поруч; окремий пакет був би зайвим.

### Consequences

- Good, because transcript фіксує очікувану користь: task і mlmail замінили `test-utils/quasar.js` на re-export; myshare видалив мертвий файл. Усі тести (24 + 79 + 105) зелені після зміни.
- Bad, because `@vue/test-utils` та `quasar` стають optional peer-залежностями пакета — хости мають надавати їх у devDeps.

## More Information

Реалізація: `npm/src/testing/quasar.js`, `npm/src/testing/index.js`. Випущено у `@7n/tauri-components@0.5.0`. `package.json` exports: `"./testing": "./src/testing/index.js"`. Peer: `"@vue/test-utils": "^2.0.0"` (optional).

---

## ADR Дропдаун вибору omlx-моделі в AgentDialog

## Context and Problem Statement

`AgentDialog` містив текстове поле `<q-input>` для ручного введення назви моделі. `myshare` мав локальний `listOmlxModels()`/`resolveModel()` через GET `/v1/models` — функціональність, відсутня в пакеті та не доступна task і mlmail.

## Considered Options

- Перенести `listOmlxModels`/`resolveModel` у пакет та замінити `<q-input>` на `<q-select>` з авто-заповненням зі списку завантажених моделей
- Залишити текстове поле, документувати API окремо

## Decision Outcome

Chosen option: "Перенести в пакет та замінити на `<q-select>`", because це усуває локальний дублікат у myshare та покращує UX всіх трьох агентів — список завантажених моделей замість ручного введення.

### Consequences

- Good, because transcript фіксує очікувану користь: AgentDialog автоматично завантажує моделі при відкритті (через `onShow`); `listOmlxModels` деградує gracefully (повертає `[]`) при недоступному сервері.
- Bad, because AgentDialog тепер ходить в мережу (GET `/v1/models`) при кожному відкритті конфіг-панелі.

## More Information

Реалізація: `npm/src/core/omlx-models.js` (`listOmlxModels`, `resolveModel`), тест: `npm/src/core/omlx-models.test.js`. `AgentDialog.vue` — поле `model` замінено на `<q-select :options="models" />` з `modelsLoading` spinner. Випущено у `@7n/tauri-components@0.5.0`. Функції також реекспортовано з кореневого `index.js`.
