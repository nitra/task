---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-14T12:57:37+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

## ADR Запис задач через Rust (`mt-scanner create`)

## Context and Problem Statement
Застосунок `task` мав лише read-side: `mt-scanner scan` і `workspaces` повертають граф задач, а JS-шим у `@7n/mt` пише `task.md` через `mt init`. Директива проєкту — «вся взаємодія з файловою системою йде через Rust» — вимагала симетричного write-side у крейті, щоб `create` не залишався JS-винятком.

## Considered Options
* (A) Новий Tauri Rust-command (`create_task`) пише `task.md` напряму у крейті `mt-scanner` — без node-рантайму, симетрично до read-side
* (B) Виклик `mt init` як sidecar (bun/node CLI з `@7n/mt`)
* (C) Hybrid: Rust пише, але формат frontmatter виноситься в спільний модуль `mt-scanner`

## Decision Outcome
Chosen option: "A/C — Rust-only create_task у крейті mt-scanner", because користувач підтвердив: «вся взаємодія з файловою системою йде через rust» і запропонував «підготуємо специфікацію додавання через rust, щоб і npm міг викликати і ми в своєму task проєкті цей код». Три споживачі (`mt init` JS-шим, `mt-scanner create`-verb, Tauri `invoke`) лінкують один крейт — єдине джерело формату.

### Consequences
* Good, because transcript фіксує очікувану користь: логіка read і write знаходяться в одній кодовій базі без node-залежності в рантаймі; нова дія в mt-репо автоматично доступна всім трьом споживачам.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Специфікація зафіксована в `mt/docs/spec-task-create-rust-integration.md`. Бекенд реалізований у `app/src-tauri/src/lib.rs:14` (`create_task` → `mt_scanner::create_task`). Кандидат-бінарник `mt/target/release/mt-scanner` має verb `create <tasks_dir> <name> [flags]` з парсингом `parse_create_opts`.

---

## ADR Канонічний frontmatter при `create_task`: усунення дублів і виправлення вад `mt init`

## Context and Problem Statement
Чинна команда `mt init` з `@7n/mt` мала дві задокументовані вади: не писала `schema_version: 1` (обов'язкове перше поле за `docs/mt.md`) і писала `mode: human` у frontmatter, але не створювала `h.md` → свіжа задача сканувалась як `Unassigned` замість `Pending`. Потрібно було визначити, що є «істиною» — frontmatter чи прапорні файли.

## Considered Options
* (A) Прибрати `mode`/`executor`/`interactive`/`deps:` з frontmatter; істина — прапорний файл `a.md`/`h.md` і директорія `deps/`
* (B) Залишити обидва (frontmatter + прапорний файл)
* (C) Прапорний файл-істина + frontmatter як кеш

## Decision Outcome
Chosen option: "(A) frontmatter без дублів, істина = файлові прапори", because користувач відповів «1 A» і підтвердив усі три під-рішення: поля `mode`/`executor`/`interactive`/`deps:` прибрати з frontmatter; `schema_version: 1` писати лише для нових файлів (без міграції наявних); `--dep` пише **порожні** `deps/<id>.md` (топологічне ребро; `ref:` дописується пізніше, коли dep resolved).

### Consequences
* Good, because transcript фіксує очікувану користь: усунення дрейфу між frontmatter і ФС-прапорами; нові вузли одразу скануються як `Pending` (наживо підтверджено — `deploy` зі станом `pending` після `create`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Канонічний frontmatter після рішення: `schema_version`, `created_at`, `budget_sec`, `hint`. Плюс `a.md`/`h.md` і порожні `deps/<id>.md`. Зафіксовано в `mt/docs/spec-task-create-rust-integration.md §4.3`. Демо-перевірка: `bun bin/task.mjs create '{"tasksDir":"…/mt","name":"deploy","opts":{"mode":"human"}}'` → `{ok:true, output:{flag:"h.md", …}}` → `scan` повертає `state:"pending"`.

---

## ADR Архітектура `n-tool-surface`: паритет UI ↔ LLM ↔ оркестратор

## Context and Problem Statement
UI-застосунок `task` був єдиними «дверима» до дій (`scan`, `create`). Користувач хотів, щоб будь-яка дія, яку людина виконує через фронтенд, була рівноцінно виконувана LLM і скриптовим оркестратором — **без фронтенду**, через спільний каталог викликів. Це повинно стати мовно-незалежним правилом для всіх web- і Tauri-проєктів `@nitra/cursor`.

## Considered Options
* Єдиний JS-канон, native = деталь делегації (один ментальний модель для всіх стеків)
* Два явні канони (JS-native handler і делегуючий handler) в одному правилі
* Native-first коли є Rust (Tauri → Rust single source, web → JS single source)
* (Обрано) Платформо-незалежне ядро `n-tool-surface` + per-stack секції; web і Tauri **навмисно розходяться**

## Decision Outcome
Chosen option: "Платформо-незалежне ядро n-tool-surface з per-stack секціями", because користувач сказав: «web і Tauri розходяться — це допустимо і навіть краще; архітектура спільна, а реалізація під Tauri-проєкти одна, під Capacitorjs проєкти інша; окремими секціями в правилі, а деталі потрапляють в свої правила, такі як n-tauri чи n-vue». Назва — **`n-tool-surface`** (1B); термін одиниці — **`tool`** (бо ключовий новий гравець — LLM, 1A); тека — **`src/tool/`** (1C); людський CLI відсутній (1D) — виклик лише скриптовим оркестратором.

### Consequences
* Good, because transcript фіксує очікувану користь: каталог `src/tool/catalog.js` є єдиним джерелом для UI (`dispatch` замість сирого `invoke`), CLI-bin (`task <tool> '<json>'`) і LLM (`toolManifest()` → OpenAI function-calling). Наживо підтверджено: `bun bin/task.mjs scan/create` і та сама дія через UI — через один каталог.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізація: `app/src/tool/{catalog,dispatch,manifest,transports,index,llm}.js`, `app/bin/task.mjs`. Специфікація: `docs/specs/260614-n-tool-surface.md`. `TaskGraph.vue` і `CreateTaskDialog.vue` рефакторовано на `dispatch` (видалено прямі `invoke`). MVP-транспорт оркестратора — per-verb spawn `mt-scanner` (Рішення 3A, mt-репо не чіпали). Конверт результату скрізь: `{ ok, output }` / `{ ok:false, error:{code,message} }`. Tests: **34/34** у `vitest`. Лінт-гейти: `lint-js exit:0`, `lint-style exit:0`, `vite build ✓`, `changelog ✓`.

---

## ADR LLM-провайдер і транспорт у MVP `n-tool-surface`: локальний omlx + Gemma 3n E4B

## Context and Problem Statement
LLM-адаптер потребував вибору: хмарна модель (Claude), локальна офлайн або провайдер-агностик. Від вибору залежав формат tool-маніфесту і спосіб ведення `tool_calls`-циклу.

## Considered Options
* Claude (Anthropic) через наявний `tauri-plugin-http` (`claude-sonnet-4-6`)
* Локальна офлайн через omlx (OpenAI-сумісний MLX-сервер) + Gemma 3n E4B
* Провайдер-агностик (інтерфейс + кілька бекендів) — передчасно для MVP

## Decision Outcome
Chosen option: "Локальна офлайн omlx з Gemma 3n E4B", because користувач явно обрав: «2A Локальна офлайн omlx з gemma 4 e4b як відправна точка» і підтвердив «(i) OpenAI-сумісний (це omlx на зараз)». Модель уже запущена на `http://127.0.0.1:8000` (виявлено через `lsof`/`curl`). Tool-маніфест — формат **OpenAI function-calling** (а не Anthropic); MCP — ціль на потім. `fetchFn` інжектується → in-app через `tauri-plugin-http`, bin через node `fetch`, тести через мок.

### Consequences
* Good, because transcript фіксує очікувану користь: модель стає просто `localhost`-ендпоінтом; `tauri-plugin-http` уже підключений; формат тулів стандартний (OpenAI), легко підмінити провайдера пізніше.
* Bad, because transcript фіксує ризик: 4B-модель Gemma нестабільна у tool-use (асистент попередив «constrained-decoding — наступний крок»); omlx на `:8000` вимагає API-ключ — наживий тест cycle відклали (ключ не наданий у сесії).

## More Information
Реалізація: `app/src/tool/llm.js` (`runAgent`, `createOpenAiChat`); `app/bin/task.mjs` команда `agent "<prompt>"`. Конфіг через `OMLX_BASE_URL` (default `http://127.0.0.1:10240/v1`) і `OMLX_MODEL` + `OMLX_API_KEY`. Тести `app/src/tests/llm.test.js` (6 тестів: tool_call-цикл, без тулів, `maxSteps`-кап, битий JSON в аргументах, HTTP-адаптер ok/non-ok) — всі мок-based, не залежать від живої моделі.
