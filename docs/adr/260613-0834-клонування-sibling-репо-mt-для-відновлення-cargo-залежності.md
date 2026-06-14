---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-13T08:34:51+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

## ADR Клонування sibling-репо `mt` для відновлення Cargo-залежності

## Context and Problem Statement
`app/src-tauri/Cargo.toml` містить `[patch]`, який перенаправляє git-залежність `mt-scanner` на локальний шлях `../../../mt/scanner`. На машині розробника цей шлях (`/Users/vitalii/www/nitra/mt/scanner`) не існував, тому `cargo` завершувався з помилкою «No such file or directory» і застосунок не запускався.

## Considered Options
* Клонувати `ssh://git@github.com/nitra/mt.git` у сусідню директорію `/Users/vitalii/www/nitra/mt`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Клонувати `ssh://git@github.com/nitra/mt.git` у сусідню директорію", because SSH-доступ до репо підтвердився (`git ls-remote` повернув HEAD), а шлях `../../../mt/scanner` жорстко зафіксований у `[patch]` — найшвидший шлях без зміни `Cargo.toml`.

### Consequences
* Good, because `cargo fetch` завершився з exit 0 після клонування, залежність резолвиться без модифікацій tracked-файлів.
* Bad, because будь-який інший розробник мусить мати sibling-checkout `mt/` поруч із `task/`; це неявна умова, яка не задокументована в README.

## More Information
Команда: `git clone ssh://git@github.com/nitra/mt.git /Users/vitalii/www/nitra/mt`
Файл із `[patch]`: `app/src-tauri/Cargo.toml`
Перевірка: `cd app/src-tauri && cargo fetch` → exit 0

---

## ADR Уся взаємодія з файловою системою для задач — через Rust

## Context and Problem Statement
Проєкт `task` вже делегував read-операції (сканування) Rust-крейту `mt-scanner` згідно з `docs/spec-scanner-rust-integration.md`. Потрібно додати можливість **створення** задач — і вирішити, де живе відповідна write-логіка: у Rust-крейті, у CLI-обгортці `@7n/mt` (Node.js), чи в обох.

## Considered Options
* Новий Tauri Rust-command `create_task` — вся логіка в крейті `mt-scanner`
* Виклик `mt init` як sidecar (bun/node CLI з `@7n/mt`)
* Гібрид: Rust пише, формат виноситься в спільний модуль
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Новий Tauri Rust-command `create_task` — вся логіка в крейті `mt-scanner`", because користувач підтвердив директиву «усе, що стосується роботи з файловою системою, має бути в Rust» і вказав, що npm-шим і Tauri-застосунок мають використовувати одну й ту саму Rust-реалізацію.

### Consequences
* Good, because transcript фіксує очікувану користь: єдина реалізація в `mt-scanner`-крейті, яку споживають три клієнти (`mt init` npm-шим через `spawnSync`, `mt-scanner create` CLI-підкоманда, `task` Tauri через пряме лінкування крейту) — без node-рантайму в Tauri.
* Bad, because чинний `mt init` (Node.js) стає тонким шимом над бінарником; потрібно переписати JS-реалізацію створення, аналогічно до вже зробленого для `scan`.

## More Information
Спека: `/Users/vitalii/www/nitra/mt/docs/spec-task-create-rust-integration.md`
Наявний прецедент read-side: `/Users/vitalii/www/nitra/mt/docs/spec-scanner-rust-integration.md`
Pub API крейту: `mt_scanner::create_task(tasks_dir, opts: CreateOpts) -> Result<CreateOutcome>`
CLI-підкоманда: `mt-scanner create <tasks_dir> <name> [--mode --model-tier --budget-sec --hint --dep]`, stdout JSON

---

## ADR Канонічний стан виконавця задачі — прапори `a.md`/`h.md`, без дублів у frontmatter

## Context and Problem Statement
Чинний `mt init` пише поля `mode`, `executor`, `interactive` у frontmatter `task.md` і водночас очікується прапор `a.md` (agent) або `h.md` (human) у директорії вузла. Сканер читає **прапор**, а не frontmatter — через це свіжостворена задача сканувалася як `Unassigned` замість `Pending` (баг: `mt init` писав `mode: human` у frontmatter, але не створював `h.md`).

## Considered Options
* (A) Прибрати `mode`/`executor`/`interactive` із frontmatter — єдине джерело правди = прапор `a.md`/`h.md`
* (B) Лишити обидва механізми
* (C) Прапор — істина, frontmatter — кеш

## Decision Outcome
Chosen option: "(A) Прибрати дублі, істина = прапор `a.md`/`h.md`", because користувач явно обрав варіант A; це усуває дрейф між frontmatter і реальним станом, який вже призводив до помилкового статусу `Unassigned`.

### Consequences
* Good, because transcript фіксує очікувану користь: сканер завжди бачить коректний стан `Pending` одразу після `create`; немає ризику розбіжності між двома джерелами.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Спека §4.3: `create_task` завжди створює `h.md` (дефолт: `mode = human`); якщо `--mode agent` — створює `a.md` замість `h.md`. Поля `mode`/`executor`/`interactive` у frontmatter не пишуться.
Файл: `/Users/vitalii/www/nitra/mt/docs/spec-task-create-rust-integration.md` §4.3

---

## ADR `--dep` створює порожні файли залежностей, `ref:` дописується пізніше

## Context and Problem Statement
При створенні нової задачі через `mt-scanner create --dep <id>` потрібно вирішити, що записувати у `deps/<id>.md`: порожній файл (лише топологічне ребро) чи одразу `ref:`-pointer на конкретний вихідний факт залежного вузла.

## Considered Options
* Порожній `deps/<id>.md` — оголошує ребро без data-flow wiring
* `deps/<id>.md` із `ref:` — вказує на конкретний факт залежного вузла
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Порожній `deps/<id>.md`", because у момент створення залежний вузол ще не виконаний, `fact_NNN.md`-файли не існують; записати `ref:` зараз означає створити dangling ref і вгадувати назву файлу. `ref:`-wiring — окрема authoring-дія на етапі плану/виконання.

### Consequences
* Good, because transcript фіксує очікувану користь: порожній файл правильно оголошує топологічне ребро, оркестратор отримує коректне впорядкування без ризику dangling ref.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Спека §4.4: `for dep in opts.deps { write_empty(node_dir / "deps" / dep + ".md") }`. `ref:`-синтаксис описано в `docs/mt.md` (секція «вміст файлу залежності опційний»). Поле `deps: []` у frontmatter прибирається разом із рішенням ADR «Канонічний стан виконавця» (та сама логіка — єдине джерело правди в файловій структурі).
