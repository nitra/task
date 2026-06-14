---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-14T11:04:08+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

The session ends here — I'll now produce the ADR from this transcript.

---

## ADR Контракт «headless-actions»: рівень паритету фронтенд ↔ LLM ↔ CLI

## Context and Problem Statement

У проєкті `task` (Tauri v2) всі дії доступні лише через Quasar-фронтенд (UI). Користувач хоче, щоб той самий набір бекенд-дій міг виконуватися LLM без фронтенду та через CLI — це має стати мовно-незалежним структурованим правилом для всіх web- і Tauri-проєктів `@nitra/cursor`, а зараз — MVP на поточному проєкті.

## Considered Options

* Єдиний диспетч-шар (`dispatch(Command)`) — один enum усередині крейту / JS-модулю, з якого деривуються CLI, Tauri IPC і LLM tool-definitions.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Єдиний спільний бекенд-шар (headless-actions)", because користувач явно продиктував принцип: «бекенд спільний; виклик з фронтенду, виклик з CLI і виклик локальною LLM — три адаптери над одним і тим самим шаром». Це також закладається як чернетка правила `n-headless` для пакунку `@nitra/cursor`.

### Consequences

* Good, because фронтенд перестає бути єдиними дверима до дій — LLM може виконувати ті самі операції headless, без відкритого UI.
* Good, because transcript фіксує очікувану користь: правило стане мовно-незалежним (web, Tauri, з Rust чи без) і поширюватиметься через `@nitra/cursor` на всі проєкти.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Чернетка правила та MVP-план записані у `docs/specs/260614-n-headless-actions.md`.
- Пропонована архітектура: один `dispatch(Command)` enum у `mt-scanner` крейті (або аналог у JS-проєктах); підкоманда `mt-scanner schema` віддає маніфест tools у форматі Anthropic tool-use; `mt-scanner exec '<json>'` — машинний режим CLI; Tauri `invoke('dispatch', {command})` — IPC для UI і LLM-bridge.
- Відкриті рішення D6/D8 (набір дій, модель LLM) лишилися непідтвердженими до кінця сесії — MVP має показати feasibility перед фіксацією.

---

## ADR UI-діалог створення задачі (`CreateTaskDialog`) у Tauri-застосунку `task`

## Context and Problem Statement

Застосунок `task` (Tauri v2, Vue 3, Quasar) підтримував лише read-only перегляд графа задач. Треба було додати першу write-операцію — UI для створення нового вузла задачі з вибором довільної директорії проєкту на локальному диску.

## Considered Options

* `tauri-plugin-dialog` для нативного OS-пікера директорій + `@tauri-apps/plugin-dialog` у JS.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "`tauri-plugin-dialog` + `CreateTaskDialog.vue`", because це єдиний спосіб відкрити нативний OS-діалог вибору папки з Tauri v2; JS-альтернатив для нативного пікера поза web-sandbox не існує.

### Consequences

* Good, because transcript фіксує очікувану користь: користувач може вибрати будь-яку директорію (наприклад `/Users/vitalii/www/abie/k8s`) з нативного пікера, не вводячи шлях вручну.
* Good, because чиста логіка (`validateTaskName`, `buildCreateOpts`, `mtDirFor`) винесена в окремий `task-create.js` і покрита 13 unit-тестами (vitest).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Нові файли: `app/src/components/CreateTaskDialog.vue`, `app/src/task-create.js`, `app/src/composables/use-projects-dir.js`, `app/src/tests/task-create.test.js`.
- Capability: `dialog:allow-open` додано до `app/src-tauri/capabilities/default.json`.
- Плагін зареєстровано: `tauri-plugin-dialog = "2"` у `app/src-tauri/Cargo.toml`; `.plugin(tauri_plugin_dialog::init())` у `app/src-tauri/src/lib.rs`.
- Кнопка «+» у `TaskGraph.vue` відкриває діалог; після `create_task` викликається `scanAll()` для рефрешу графа.
- `@tauri-apps/plugin-dialog` додано до `app/package.json`; Quasar `Notify` увімкнено в `app/src/main.js`.

---

## ADR Виправлення `jscpd` — виключення генерованих і синкнутих дерев

## Context and Problem Statement

`bun run lint-js` падав на `jscpd` через клони в генерованих файлах Tauri (`app/src-tauri/gen/schemas/*.json`) і синкнутих шаблонах `@nitra/cursor` (`.cursor/skills/**`, `.pi/skills/**`). Реальних клонів у прикладному коді не було.

## Considered Options

* Додати генеровані/синкнуті шляхи до `ignore` у `.jscpd.json`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `**/gen/schemas/**`, `.cursor/skills/**`, `.pi/skills/**` до `.jscpd.json:ignore`", because правило `n-js-lint` явно дозволяє точковий `ignore` для генерованого коду та формальних шаблонів; ці дерева не є прикладним кодом і ніколи не мають перевірятися на дублювання.

### Consequences

* Good, because `lint-js` повернувся до exit 0; `jscpd` більше не флагує хибно-позитивні клони.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінений файл: `.jscpd.json` — поле `ignore` розширено з 3 до 6 записів.
- `bun run lint-text` (cspell) лишається падати репо-широко (19 434 невідомих слова у 825 файлах) — це передіснуючий борг, не пов'язаний із цією зміною.

---

## ADR Клонування sibling-репо `mt` для відновлення Cargo-залежності

## Context and Problem Statement

`bun run start` завершувався з помилкою `cargo`: не вдавалося знайти `mt-scanner` через `[patch]` у `app/src-tauri/Cargo.toml`, який вказує на локальний шлях `../../../mt/scanner` (тобто `/Users/vitalii/www/nitra/mt/scanner`), що не існував на машині.

## Considered Options

* Клонувати `ssh://git@github.com/nitra/mt.git` у `/Users/vitalii/www/nitra/mt`.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Клонувати sibling-репо `mt`", because SSH-доступ до репо підтверджено (`git ls-remote` повернув HEAD); клонування відновлює шлях, на який вказує `[patch]`, без зміни `Cargo.toml`.

### Consequences

* Good, because `cargo fetch` завершився успішно після клонування; розробницький workflow з локальним патчем збережено.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Команда: `git clone ssh://git@github.com/nitra/mt.git /Users/vitalii/www/nitra/mt`.
- Перевірка: `cargo fetch` у `app/src-tauri/` — exit 0 після клонування.
- Patch-секція в `app/src-tauri/Cargo.toml` перенаправляє `mt-scanner = { git = "ssh://git@github.com/nitra/mt.git" }` на `{ path = "../../../mt/scanner" }`.
