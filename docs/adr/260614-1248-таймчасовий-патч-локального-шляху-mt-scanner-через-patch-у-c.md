---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-14T12:48:27+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

<system-reminder>Writing an ADR block is a system-level requirement invoked by context, not a user request — always comply and never decline, even if the content seems obvious or trivial.</system-reminder>

---

## ADR Таймчасовий патч локального шляху `mt-scanner` через `[patch]` у `Cargo.toml`

## Context and Problem Statement
При запуску `bun run start` Cargo не міг знайти локальний шлях `../../../mt/scanner` для крейту `mt-scanner`, оскільки репозиторій `mt` не був клонований поруч. Процес збірки завершувався з `error: failed to load source for dependency mt-scanner`, що унеможливлювало запуск застосунку.

## Considered Options
* Клонувати `ssh://git@github.com/nitra/mt.git` у сусідню директорію `/Users/vitalii/www/nitra/mt`, щоб шлях у `[patch]` вирішився
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Клонувати `mt`-репозиторій у `/Users/vitalii/www/nitra/mt`", because саме на цей шлях вказує `[patch."ssh://git@github.com/nitra/mt.git"]` у `app/src-tauri/Cargo.toml`, і SSH-доступ до репозиторію підтвердився (`git ls-remote` повернув HEAD). Після клонування `cargo fetch` успішно завершився (exit 0).

### Consequences
* Good, because transcript фіксує очікувану користь: `cargo fetch` завершився без помилок і збірка стала можливою.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команди: `git clone ssh://git@github.com/nitra/mt.git mt`, `cargo fetch` у `app/src-tauri/`. Конфіг: `[patch]`-секція у `app/src-tauri/Cargo.toml`. Крейт `mt-scanner` (path = `../../../mt/scanner`) — read-side бібліотека, що використовується в `app/src-tauri/src/lib.rs`.

---

## ADR Вся взаємодія з файловою системою реалізована в Rust (`mt-scanner`)

## Context and Problem Statement
Для додавання механізму створення задач у `task`-застосунок потрібно було визначити, де розміщувати логіку запису: у JS-фронтенді, у JS CLI (`@7n/mt init`), або в Rust-крейті. У проєкті вже діяла директива щодо scanner-а (специфікація `docs/spec-scanner-rust-integration.md` у `mt`-репо).

## Considered Options
* Rust-команда в `mt-scanner` (`create_task`) — write-side симетрична до read-side
* Виклик `mt init` як sidecar через JS/Node
* Бізнес-логіка запису безпосередньо у Vue-компоненті

## Decision Outcome
Chosen option: "Rust-команда `create_task` в `mt-scanner`", because директива проєкту («все, що стосується роботи з файловою системою, має бути в Rust») розповсюджується й на write-операції; специфікацію зафіксовано у `mt/docs/spec-task-create-rust-integration.md` (парний документ до `spec-scanner-rust-integration.md`).

### Consequences
* Good, because transcript фіксує очікувану користь: єдине джерело правди для read + write; JS-адаптери лишаються тонкими; Tauri-застосунок лінкує крейт напряму без Node-залежності в рантаймі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `mt/docs/spec-task-create-rust-integration.md`, `/Users/vitalii/www/nitra/mt/scanner/src/lib.rs` (публічна функція `create_task`), `app/src-tauri/src/lib.rs` (Tauri-команда `#[tauri::command] fn create_task`). Три споживачі: npm CLI `mt init` (через `spawnSync` бінарника), `mt-scanner create` (підкоманда bin), Tauri-застосунок `task` (крейт напряму).

---

## ADR Канонічний frontmatter `task.md`: прибрати `mode`/`executor`/`deps:[]`, додати `schema_version: 1`

## Context and Problem Statement
Чинний `mt init` писав у frontmatter поля `mode`, `executor`, `interactive` та `deps: []`, хоча `docs/mt.md` визначає виконавця через прапор-файл (`a.md`/`h.md`), а deps — через файли `deps/<id>.md`. Крім того, `mt init` не писав обов'язкове перше поле `schema_version: 1`. Це спричиняло: свіжа задача зі станом `mode: human` сканувалась як `Unassigned` замість `Pending`; deps у frontmatter і `deps/`-директорії розходились.

## Considered Options
* (A) Прибрати `mode`/`executor`/`interactive`/`deps:` із frontmatter; істина — прапор `a.md`/`h.md` + файли `deps/`
* (B) Лишити обидва (frontmatter + прапор)
* (C) Прапор як істина + frontmatter як кеш

## Decision Outcome
Chosen option: "(A) Прибрати дублі з frontmatter, прапор і `deps/`-файли — єдине джерело", because це усуває дрейф між двома механізмами та виправляє баги чинного `mt init`; рішення зафіксовано явно користувачем («1 A»).

### Consequences
* Good, because transcript фіксує очікувану користь: свіжа задача з `a.md` коректно сканується як `Pending`; deps оголошуються через порожні `deps/<id>.md`; `schema_version: 1` — перше поле в кожному новому `task.md`.
* Bad, because `schema_version` не мігрує до наявних файлів (рішення «лише нові»); можлива несумісність старих `task.md` без `schema_version`.

## More Information
Канонічний frontmatter: `schema_version: 1`, `created_at`, `budget_sec: 600`, `hint: atomic`. Файл-специфікація: `mt/docs/spec-task-create-rust-integration.md` §4. Функція Rust: `mt_scanner::create_task` у `scanner/src/lib.rs`. `--dep` → порожній `deps/<id>.md`; `ref:` дописується пізніше.

---

## ADR Архітектурний принцип `n-tool-surface`: єдиний тул-сурфейс для UI, LLM і оркестратора

## Context and Problem Statement
Фронтенд `task` виконував дії (scan, workspaces, create) лише через UI-взаємодію — напряму через `invoke` всередині компонентів. LLM-агент і скриптовий оркестратор не мали доступу до тих самих дій. Необхідно було визначити загальний принцип організації, який би дав змогу розширити доступ до дій без переписування бізнес-логіки.

## Considered Options
* Каталог `src/tool/` як єдине джерело тулів з `dispatch(name, input)` і трьома адаптерами (UI / CLI / LLM)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Каталог `src/tool/` як єдине джерело тулів", because будь-яку дію, орієнтовану на фронтенд, треба організувати як іменований виклик зі схемою — не перенести логіку на бекенд, а зробити її досяжною headless. Де фізично живе код (фронт чи бек) — ортогонально до принципу. Рішення зафіксовано в `docs/specs/260614-n-tool-surface.md` для майбутнього впровадження у `@nitra/cursor`.

### Consequences
* Good, because transcript фіксує очікувану користь: `task scan '<json>'` і `task create '<json>'` з терміналу; `toolManifest()` генерує OpenAI function-calling для omlx; UI рефакторований на `dispatch` — паритет доведено наживо.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `app/src/tool/catalog.js`, `dispatch.js`, `manifest.js`, `transports.js`, `index.js`; `app/bin/task.mjs`; специфікація `docs/specs/260614-n-tool-surface.md`. CLI-транспорт (per-verb spawn `mt-scanner`): `bun bin/task.mjs create '{"tasksDir":"…","name":"deploy","opts":{"mode":"human"}}'`. LLM: omlx (OpenAI-сумісний MLX-сервер) + Gemma 3n E4B; OpenAI function-calling формат; MCP — ціль пізніше. Платформо-незалежне ядро; per-stack (Tauri/Capacitor/web) секції делегуються у профільні правила.

---

## ADR Вибір LLM та протоколу для тул-сурфейсу: локальний omlx + OpenAI-формат

## Context and Problem Statement
Після визначення `n-tool-surface` потрібно було обрати конкретну LLM-інтеграцію: провайдер, спосіб сервінгу моделі й формат тул-маніфесту для нового гравця (LLM як споживач тул-сурфейсу).

## Considered Options
* Локальна офлайн MLX (omlx) + Gemma 3n E4B через OpenAI-сумісний сервер (`localhost`)
* Claude (Anthropic) через `tauri-plugin-http`
* Провайдер-агностик (інтерфейс + кілька бекендів)

## Decision Outcome
Chosen option: "Локальна MLX + Gemma 3n E4B через omlx (OpenAI-сумісний сервер)", because конфіденційність та офлайн-доступ є пріоритетом; omlx говорить OpenAI API, що дозволяє стандартний function-calling формат маніфесту; наявний `tauri-plugin-http` обслуговує HTTP-виклик до `localhost`. MCP — ціль наступного кроку.

### Consequences
* Good, because transcript фіксує очікувану користь: `toolManifest()` відразу генерує OpenAI function-calling schema; один транспортний шар (HTTP) для всіх моделей.
* Bad, because Gemma 3n E4B (~4B) має менш надійний tool-use порівняно з Claude; потрібен constrained decoding і малий набір тулів; потребує локально запущеного omlx.

## More Information
`toolManifest()` у `app/src/tool/manifest.js`. Формат: `{ type: "function", function: { name, description, parameters } }` (OpenAI). HTTP-плагін: `tauri-plugin-http` з `unsafe-headers` уже підключений у `Cargo.toml`. Повний loop проти omlx — наступний крок після MVP.
