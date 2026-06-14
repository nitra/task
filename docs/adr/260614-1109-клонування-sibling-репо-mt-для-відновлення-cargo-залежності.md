---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-14T11:09:15+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

## ADR Клонування sibling-репо `mt` для відновлення Cargo-залежності

## Context and Problem Statement
При запуску `bun run start` Cargo не міг знайти `mt/scanner/Cargo.toml` за шляхом `../../../mt/scanner`, бо `[patch]`-секція в `app/src-tauri/Cargo.toml` перенаправляє git-залежність `mt-scanner` на локальний checkout, якого не було на машині.

## Considered Options
* Клонувати `ssh://git@github.com/nitra/mt.git` у sibling-директорію `/Users/vitalii/www/nitra/mt`
* Прибрати `[patch]`-секцію і використовувати залежність напряму через git

## Decision Outcome
Chosen option: "Клонувати `mt` у sibling-директорію", because SSH-доступ до репо підтвердився (`git ls-remote` повернув HEAD), і `[patch]`-секція свідомо розрахована на саме такий layout (`../../../mt/scanner`); клон відновлює задуманий dev-workflow без змін у Cargo.toml.

### Consequences
* Good, because `cargo fetch` і наступний `cargo check` завершились успішно після клонування.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `app/src-tauri/Cargo.toml` (`[patch."ssh://git@github.com/nitra/mt.git"]`). Команди: `git ls-remote ssh://git@github.com/nitra/mt.git HEAD`, `git clone ssh://git@github.com/nitra/mt.git mt`, `cargo fetch`. Додаткова документація: `docs/adr/260613-...-клонування-sibling-репо-mt-для-відновлення-cargo-залежності.md`.

---

## ADR Усі FS-операції запису задач — через Rust (`create_task` в `mt-scanner`)

## Context and Problem Statement
Застосунок `task` умів лише читати (Rust-крейт `mt-scanner` + `scan_tasks`); написання нових задач потребувало рішення: де реалізувати логіку створення `task.md` та супутніх файлів (`a.md`/`h.md`, `deps/`).

## Considered Options
* Rust-крейт `mt-scanner` — нова публічна функція `create_task(tasks_dir, name, opts)` (і нова підкоманда бінарника)
* Виклик `mt init` CLI (`@7n/mt`, Node.js) як sidecar
* JS-логіка безпосередньо у фронтенді

## Decision Outcome
Chosen option: "Rust-крейт `mt-scanner`", because наявна директива користувача «всі FS-операції — через Rust» вже зафіксована у `docs/spec-scanner-rust-integration.md`; write-side мусить бути симетричним read-side, без node-рантайму в рантаймі застосунку.

### Consequences
* Good, because єдиний canonical формат `task.md` (з `schema_version: 1` як першим полем) формується в одному місці; Tauri-застосунок та npm CLI обидва викликають ту саму реалізацію.
* Bad, because логіка `mt init` (`@7n/mt`) не мігрує автоматично — два дефекти чинного init (відсутність `schema_version`, відсутність `h.md`/`a.md`) виявлені й зафіксовані як окремі виправлення у спеці.

## More Information
Файли: `app/src-tauri/src/lib.rs` (Tauri-обгортка `create_task`), `/Users/vitalii/www/nitra/mt/scanner/src/lib.rs` (pub fn), `/Users/vitalii/www/nitra/mt/docs/spec-task-create-rust-integration.md` (нова спека). Struct-и: `CreateOpts` (snake_case), `CreateOutcome` (externally-tagged enum `Created`/`Exists`). Tauri-виклик: `invoke('create_task', { tasksDir, name, opts })`.

---

## ADR Frontmatter задачі: прапори-файли замість дублювання полів

## Context and Problem Statement
Чинний `mt init` писав `mode`, `executor`, `interactive`, `deps` у frontmatter `task.md`, тоді як фактичним джерелом правди за `docs/mt.md` є окремі прапор-файли `a.md`/`h.md` і директорія `deps/`. Під час написання спеки `create_task` треба було вирішити, що писати в frontmatter нових задач.

## Considered Options
* (A) Прибрати дублі з frontmatter; єдина істина — `a.md`/`h.md` і `deps/<id>.md`
* (B) Лишити обидва (frontmatter і прапори)
* (C) Прапор як істина, frontmatter як кеш

## Decision Outcome
Chosen option: "(A) Прибрати дублі", because сканер читає стан саме з прапорів, а frontmatter-дублі вже спричинили баг: свіжа задача без `h.md` сканувалась як `Unassigned` замість `Pending`.

### Consequences
* Good, because transcript фіксує очікувану користь: усувається дрейф між frontmatter і реальним станом задачі; `create_task` завжди пише `a.md` або `h.md` і відповідний прапор видно сканеру одразу після створення.
* Bad, because `schema_version: 1` мігрується лише в нові файли (наявні — не мігруються); старі `task.md` без `schema_version` залишаються.

## More Information
Канонічний frontmatter нових задач: `schema_version: 1`, `created_at`, `budget_sec`, `hint`. Файли: `/Users/vitalii/www/nitra/mt/docs/spec-task-create-rust-integration.md` §4.2, §4.3; `/Users/vitalii/www/nitra/mt/docs/mt.md` (специфікація формату вузла).

---

## ADR `--dep` пише порожні `deps/<id>.md`; `ref:` — пізніше

## Context and Problem Statement
При створенні задачі з залежностями (`--dep <id>`) треба було вирішити: що записувати в `deps/<id>.md` — лише топологічне ребро (порожній файл) чи відразу `ref:` на конкретний вихідний файл депа.

## Considered Options
* Порожній `deps/<id>.md` (лише топологія)
* `deps/<id>.md` із `ref:` на вихід депа (data-flow wiring)

## Decision Outcome
Chosen option: "Порожній `deps/<id>.md`", because у момент створення нова задача ще не знає конкретного fact-файлу депа (деп не виконаний); записати `ref:` зараз = створити dangling ref на неіснуючий файл і вгадати номер `fact_NNN.md`. `ref:`-вміст дописується пізніше, на етапі планування, коли деп resolved.

### Consequences
* Good, because transcript фіксує очікувану користь: топологічне ребро оголошується без зайвих припущень; поле `deps: []` у frontmatter теж прибрано як дубль.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `/Users/vitalii/www/nitra/mt/docs/spec-task-create-rust-integration.md` §4.3; `/Users/vitalii/www/nitra/mt/docs/mt.md` (опис `ref:` синтаксису — `ref: ../id/fact.md`, `ref: …#section`, `ref: … lines N-M`).

---

## ADR Принцип `n-headless`: іменовані виклики, досяжні з UI, CLI і LLM-тулів

## Context and Problem Statement
Фронтенд застосунку був єдиними дверима до дій (Tauri `invoke` прямо з компонентів); LLM і термінал не мали способу виконати ті самі дії headless, бо логіка була розсіяна по компонентах.

## Considered Options
* Action Layer — каталог іменованих дій з `dispatch(name, input)`, де кожна дія реєструє handler (де б він фізично не жив — JS чи Rust) і до нього дотягуються UI, CLI і LLM-тул
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Action Layer з `dispatch`", because користувач прямо сформулював вимогу: «замість просто людського інтерактиву через фронтенд, додати рівень, коли LLM без фронтенду може повноцінно виконувати ті ж задачі». Уточнення: мета — не перенести логіку на бекенд, а організувати її як іменовані виклики; JS-логіка може лишатися на фронтенді, якщо вона зареєстрована у каталозі.

### Consequences
* Good, because transcript фіксує очікувану користь: одне джерело схем для CLI-help, LLM tool-definitions і фронтенду; нова дія реєструється один раз і автоматично стає доступною в усіх трьох режимах.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `docs/specs/260614-n-headless-actions.md` (чернетка правила + план MVP). MVP охоплює 3 дії (`scan`, `workspaces`, `create`) з Action Layer у `app/src/actions/`, CLI-бінарник `app/bin/task.mjs` і рефактор `TaskGraph.vue` / `CreateTaskDialog.vue` на `dispatch`. Кінцева мета — оформити як правило в пакеті `@nitra/cursor`.
