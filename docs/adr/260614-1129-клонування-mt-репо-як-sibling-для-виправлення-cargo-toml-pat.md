---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-14T11:29:13+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

Спека зафіксована в документі — оновлення через Edit потребує підтвердження прав. Переходжу до головного завдання: виробити ADR-документацію за цим transcript.

## ADR Клонування mt-репо як sibling для виправлення Cargo.toml patch

## Context and Problem Statement
`app/src-tauri/Cargo.toml` містить `[patch]` що переспрямовує git-залежність `mt-scanner` на локальний шлях `../../../mt/scanner` (= `/Users/vitalii/www/nitra/mt/scanner`). На машині цього checkout не було, через що `cargo` не міг зчитати `Cargo.toml` і `bun run start` завершувався з exit 101.

## Considered Options
* Клонувати `ssh://git@github.com/nitra/mt.git` у `/Users/vitalii/www/nitra/mt`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Клонувати sibling-репо mt", because SSH-доступ до `github.com/nitra/mt.git` підтверджено (`git ls-remote` повернув HEAD), а `[patch]` уже декларує очікуваний шлях — клонування у потрібне місце є найменшим інвазивним виправленням, що зберігає локальний dev-workflow.

### Consequences
* Good, because `cargo fetch` після клонування завершився успішно (exit 0), залежність розв'язана без зміни `Cargo.toml`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Команда виправлення: `cd /Users/vitalii/www/nitra && git clone ssh://git@github.com/nitra/mt.git mt`. Patch-секція у `app/src-tauri/Cargo.toml`: `mt-scanner = { path = "../../../mt/scanner" }`.

---

## ADR Rust як єдина точка запису на файлову систему (create_task)

## Context and Problem Statement
Застосунок `task` підтримував лише read-операції (Rust `mt-scanner` сканує ФС, фронт відображає граф). При додаванні механізму створення задач виникло питання: де реалізувати write-логіку — у Rust чи у JS через наявний `@7n/mt` CLI (`mt init`).

## Considered Options
* Новий Tauri Rust-command `create_task` пише `task.md` напряму (Rust-first)
* Виклик `mt init` як sidecar через `spawnSync` (JS/Node-рантайм у застосунку)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Rust-first — `create_task` у `mt-scanner` крейті", because в mt-репо вже існує специфікація `docs/spec-scanner-rust-integration.md` з директивою «уся взаємодія з файловою системою — через Rust»; write-side мусить дотримуватись того самого принципу.

### Consequences
* Good, because transcript фіксує очікувану користь: єдиний контракт read+write у Rust-крейті, без node-рантайму у продакшн-застосунку; `mt init` стає JS-шимом навколо `mt-scanner create`.
* Bad, because логіка `mt init` (`buildTaskFrontMatter`) дублюється в Rust — ризик розбіжності, якщо npm-бік оновлять незалежно.

## More Information
Специфікація write-side: `mt/docs/spec-task-create-rust-integration.md`. Tauri-команда зареєстрована у `app/src-tauri/src/lib.rs:14`: `fn create_task(tasks_dir, name, opts: CreateOpts) -> Result<CreateOutcome, String>`. Крейт: `/Users/vitalii/www/nitra/mt/scanner/src/lib.rs`.

---

## ADR Канонічний frontmatter нової задачі без полів mode/executor/deps

## Context and Problem Statement
Чинна реалізація `mt init` писала у `task.md` frontmatter-поля `mode`, `executor`, `interactive`, `deps` — але `docs/mt.md` визначає виконавця через файл-прапор (`a.md`/`h.md`), а не через frontmatter. Також не писала `schema_version: 1` (перше обов'язкове поле за специфікацією) і не створювала `h.md`, через що нова задача сканувалась як `Unassigned` замість `Pending`.

## Considered Options
* (A) Прибрати дублі `mode`/`executor`/`interactive`/`deps` із frontmatter; істина — прапор `a.md`/`h.md`
* (B) Лишити обидва джерела (frontmatter + прапор)
* (C) Прапор як істина + frontmatter як кеш

## Decision Outcome
Chosen option: "(A) Прибрати дублі", because виконавця вже визначає `a.md`/`h.md` за специфікацією; frontmatter-копія — дрейф від одного джерела правди.

### Consequences
* Good, because transcript фіксує очікувану користь: `create` пише `schema_version: 1` (перше поле) + прапор `a.md`/`h.md` → нова задача коректно сканується як `Pending`; усуває два баги чинного `mt init`.
* Bad, because `schema_version` мігрується лише до нових файлів (рішення 2: наявні не чіпаємо) — сканер мусить продовжувати обробляти задачі без цього поля.

## More Information
Канонічний frontmatter після рішення: `schema_version`, `created_at`, `budget_sec`, `hint`. Поле `deps:` прибрано — залежності зберігаються лише в `deps/<id>.md`. Зафіксовано у `mt/docs/spec-task-create-rust-integration.md §12`.

---

## ADR Порожній deps/<id>.md при створенні задачі з --dep

## Context and Problem Statement
При створенні задачі з залежністю (`--dep Y`) виникло питання: що писати у файл `deps/<id>.md` — залишати порожнім (топологічне ребро) або одразу вписувати `ref:` на конкретний вихідний файл депа.

## Considered Options
* Порожній `deps/<id>.md` — оголошує топологічне ребро без data-flow wiring
* З `ref:` — вказує конкретний файл/секцію з виходів депа

## Decision Outcome
Chosen option: "Порожній `deps/<id>.md`", because у момент створення деп ще не виконаний і `fact_NNN.md` не існує — записати `ref:` зараз означало б dangling ref на неіснуючий файл із вгаданим номером.

### Consequences
* Good, because transcript фіксує очікувану користь: `ref:` дописується пізніше, на етапі плану/виконання, коли деп resolved і відомо на який саме факт і секцію посилатись; поділ відповідальностей збережено.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Зафіксовано у `mt/docs/spec-task-create-rust-integration.md §4.4` (після перейменування у `§4.5`). `ref:` синтаксис: `ref: ../Y/fact_001.md` або `ref: ../Y/fact_001.md#section`.

---

## ADR Архітектурний принцип n-tool-surface: паритет UI ↔ LLM ↔ оркестратор

## Context and Problem Statement
Після реалізації UI-кнопки «+» для створення задачі виникла ширша потреба: будь-яку дію застосунку мусить вміти виконати LLM або скриптовий оркестратор без запуску UI, при цьому бізнес-логіка може залишатись де вона є (на фронтенді чи в Rust) — без примусового переносу на бекенд.

## Considered Options
* Принцип n-tool-surface: дія організована як іменований `tool` зі схемою (callable), до якого дотягуються UI, оркестратор і LLM через єдиний `dispatch`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "n-tool-surface", because ключовий новий гравець — LLM, а не людина в CLI; термін `tool` відображає це центральне рішення. Правило мовно-незалежне: однаково застосовується до чистого web (JS-handlers) і до Tauri+Rust (JS = опис+транспорт, логіка в Rust).

### Consequences
* Good, because transcript фіксує очікувану користь: жодної бізнес-логіки, досяжної лише через кліп; LLM-tools ніколи не розходяться з бекендом бо деривуються з єдиного каталогу `src/tool/`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Правило планується як `n-tool-surface.mdc` у `@nitra/cursor`. MVP-файли: `app/src/tool/{catalog,dispatch,manifest,transports}.js` + `app/bin/task.mjs`. Специфікація: `docs/specs/260614-n-headless-actions.md`.

---

## ADR Реалізаційні рішення n-tool-surface MVP: термін, транспорт, LLM, логіка

## Context and Problem Statement
Для реалізації MVP принципу n-tool-surface потрібно зафіксувати чотири конкретних рішення: термінологію, LLM-провайдер і формат тулів, транспорт оркестратора, де живе виконавча логіка.

## Considered Options
* Термін одиниці: `action` / `command` / `tool` / `capability`
* LLM: Claude (Anthropic, online) / локальна MLX+Gemma / провайдер-агностик
* Транспорт: argv JSON / stdin JSON / HTTP
* CLI: людський (verb-и) + машинний / тільки машинний
* Де логіка: Rust-first / JS-first / гібрид за фактом

## Decision Outcome
Chosen option: "tool + MLX/Gemma + argv JSON + тільки машинний + гібрид", because:
- `tool` — бо ключовий споживач LLM, а не людина;
- MLX+Gemma через ollm (OpenAI-сумісний) — локальна офлайн-модель, OpenAI tools format стандартний для сервера;
- argv JSON → stdout JSON (exit 0 завжди) — найпростіший для скриптового оркестратора;
- без людського CLI — дії кличе скриптовий оркестратор, не людина;
- гібрид: Rust-тули через `spawn mt-scanner`, JS-тули — пряма функція; не рухаємо код який вже є і правильний.

### Consequences
* Good, because transcript фіксує очікувану користь: MCP як природна ціль після MVP (модель стає `localhost`-ендпоінтом, тул-сурфейс монтується будь-яким агентом без кастомної інтеграції); маніфест OpenAI tools format генерується з каталогу (паритет гарантовано).
* Bad, because Gemma 3n E4B (4B параметрів) має слабший нативний tool-use порівняно з Claude — потрібен structured output/JSON-grammar та мала кількість тулів за раз.

## More Information
Правило: `n-tool-surface`. Тека: `src/tool/`. Точка входу: `dispatch(name, input)`. Bin: `app/bin/task.mjs '<tool-call-json>'` → stdout JSON. Маніфест: `{"tool":"schema"}` → OpenAI format. Ollm: OpenAI-compatible HTTP на localhost. Специфікація MVP: `docs/specs/260614-n-headless-actions.md §MVP`.
