---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-14T17:57:23+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

## ADR Архітектура `n-tool-surface`: єдиний викликний шар для UI, CLI та LLM

## Context and Problem Statement
Дії застосунку (scan/workspaces/create) були доступні лише через UI-взаємодію (кліки у компонентах). Виникла потреба, щоб ті самі дії міг виконувати headless-оркестратор і локальний LLM — без фронтенду й без дублювання логіки.

## Considered Options
* Логіка залишається у компонентах; окремі CLI/LLM-адаптери дублюють виклики
* **Єдиний `src/tool/` каталог** — кожна дія описана іменем, схемою та handler-ом; UI, CLI і LLM звертаються до одного `dispatch(name, input)`

## Decision Outcome
Chosen option: "Єдиний `src/tool/` каталог з `dispatch`", because це забезпечує паритет без переносу логіки на бекенд — handler може лишатись JS-функцією у фронтенді; критерій лише у тому, що виклик організовано як іменований callable зі схемою, досяжний усіма трьома способами.

### Consequences
* Good, because transcript фіксує очікувану користь: live-тест довів end-to-end round-trip — Gemma через omlx самостійно обрала тул `create`, `dispatch` виконав через `mt-scanner`, файли `task.md`+`a.md` реально створились.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файли: `app/src/tool/catalog.js`, `dispatch.js`, `manifest.js`, `transports.js`, `index.js`, `llm.js`. Спека-канон: `docs/specs/260614-n-tool-surface.md`. Тести: `app/src/tests/tool.test.js`, `llm.test.js` (34 тести).

---

## ADR Іменування: термін `tool`, правило `n-tool-surface`, тека `src/tool/`

## Context and Problem Statement
Потрібно обрати стабільний набір назв, що піде у канон `@nitra/cursor` для всіх web/Tauri проєктів: як називати одиницю виклику, правило, теку та функцію диспетчу.

## Considered Options
* Термін `action` (Redux/Vuex-конвенція), правило `n-actions`, тека `src/actions/`
* Термін `command` (CQRS), правило `n-command-surface`
* Термін `capability`
* **Термін `tool`** (мовою LLM), правило **`n-tool-surface`**, тека **`src/tool/`**

## Decision Outcome
Chosen option: "`tool` / `n-tool-surface` / `src/tool/`", because ключовий новий гравець — LLM, і термін `tool` є природним у його мові (tool-use); назва правила відображає ціль — surfacing actions for tooling.

### Consequences
* Good, because transcript фіксує очікувану користь: термін не прив'язаний до жодного адаптера (на відміну від `command` → Tauri commands, shell); `n-tool-surface` однозначно розкриває призначення.
* Bad, because `tool` перетинається з терміном «інструмент» у загальному сенсі — потенційна неоднозначність у контексті non-LLM проєктів.

## More Information
Людський CLI (ергономічні verb-и з прапорцями) був відкинутий: головний споживач — скриптовий оркестратор/LLM, люди напряму не викликатимуть. `dispatch(name, input)` — єдина публічна функція диспетчу.

---

## ADR Локальна офлайн LLM через omlx (OpenAI-сумісний MLX-сервер)

## Context and Problem Statement
Для in-app агент-loop потрібен LLM-провайдер. Обирали між хмарним Claude (Anthropic), локальною офлайн-моделлю та провайдер-агностичним інтерфейсом.

## Considered Options
* Claude (Anthropic) через наявний `tauri-plugin-http`
* **Локальна офлайн через omlx (OpenAI-сумісний MLX-сервер) + Gemma 4 E4B**
* Провайдер-агностичний інтерфейс (кілька бекендів)

## Decision Outcome
Chosen option: "Локальна офлайн через omlx + Gemma 4 E4B", because відправна точка MVP — приватність і офлайн-доступність; omlx говорить OpenAI API, тому `tauri-plugin-http` підходить без змін, а формат tools-маніфесту — стандартний OpenAI function-calling.

### Consequences
* Good, because transcript фіксує очікувану користь: live-тест з `gemma-4-e2b-it-4bit` (через `gemma-4-e4b-it-OptiQ-4bit`, що не вліз у памʼять) підтвердив повний цикл — модель самостійно побудувала tool_call, `dispatch` виконав, файли створено.
* Bad, because 4B-модель не завжди надійно генерує коректний JSON для tool_calls; `gemma-4-e4b-it-OptiQ-4bit` потребує ~7.32GB і впала з HTTP 507 (memory ceiling 11.84GB, зайнято 10.57GB) — потрібно звільняти памʼять або використовувати меншу модель.

## More Information
Конфіг: `OMLX_BASE_URL` (дефолт `http://127.0.0.1:8000/v1`), `OMLX_MODEL` (`gemma-4-e4b-it-OptiQ-4bit`), `OMLX_API_KEY`. Модель на сервері: підтверджено командою `/v1/models`. Композабл: `app/src/composables/use-omlx.js` (localStorage). MCP-обгортка — ціль на потім.

---

## ADR Per-verb spawn `mt-scanner` як CLI-транспорт MVP

## Context and Problem Statement
CLI-адаптер `app/bin/task.mjs` має викликати Rust-логіку `mt-scanner` для виконання тулів scan/workspaces/create. Потрібно обрати механізм: per-verb spawn існуючих verbів або додати уніфікований `exec '<json>'` у mt-репо.

## Considered Options
* **Per-verb spawn** (`mt-scanner scan …`, `mt-scanner create …`, `mt-scanner workspaces …`)
* Уніфікований `mt-scanner exec '<json>'` (новий Command-enum у mt-репо)
* Rust-бінарник як єдина точка (вся логіка в `mt-scanner`)

## Decision Outcome
Chosen option: "Per-verb spawn для MVP", because mt-репо не чіпаємо; три verb-и вже є з потрібними прапорцями; `mt-scanner exec` як уніфікований транспорт — запланований наступний крок після MVP.

### Consequences
* Good, because transcript фіксує очікувану користь: MVP реалізовано без змін у mt-репо; live-тест `task create / task scan` з терміналу пройшов успішно.
* Bad, because кожен новий тул потребує окремого argv-мапінгу в `catalog.js`; розходження між JS-схемою і Rust-парсингом аргументів — ручний контроль до появи `exec`.

## More Information
Бінарник `mt-scanner` знайдено за шляхом `/Users/vitalii/www/nitra/mt/target/release/mt-scanner` (workspace-таргет, не `scanner/target/`). Резолвер кандидатів у `app/bin/task.mjs` спочатку містив хибний шлях — виправлено.

---

## ADR Навмисне розходження per-stack реалізацій `n-tool-surface`

## Context and Problem Statement
Правило `n-tool-surface` має охопити всі проєкти (web, Tauri, Capacitor тощо). Постало питання: чи мусить реалізація бути однаковою скрізь, чи допустимо розходження між стеками.

## Considered Options
* Єдиний JS-канон скрізь; native = деталь делегації handler-а
* **Спільна архітектура, розходження реалізацій per-stack — навмисне; окремі секції в правилі, деталі делегуються в `n-tauri`, `n-vue`, `n-capacitor`**
* Native-first коли є Rust (Rust = single source для Tauri-проєктів)

## Decision Outcome
Chosen option: "Спільна архітектура, навмисне розходження per-stack", because web і Tauri мають різні транспортні механізми (fetch vs invoke); конкретика кожного стека доречніше живе у відповідному профільному правилі, а не засмічує ядро.

### Consequences
* Good, because transcript фіксує очікувану користь: ядро `n-tool-surface` лишається платформо-незалежним контрактом; Tauri-деталі (`tauriTransport`, `invoke`) ізольовані в `transports.js` і не потрапляють у `catalog.js`.
* Bad, because LLM-інтеграція і CLI-транспорт різняться per-stack — споживач правила мусить знати, до якої секції звертатись.

## More Information
Спека-канон: `docs/specs/260614-n-tool-surface.md`. Відповідні профільні правила: `n-tauri`, `n-vue` (існують); `n-capacitor` — запланований.

---

## ADR `iconSet` Quasar має передаватись обʼєктом, не рядком

## Context and Problem Statement
Після додавання першого `q-select` у `CreateTaskDialog.vue` усі кнопки застосунку переставали реагувати на кліки. Налагодження показало, що `$q.iconSet.arrow.dropdown` викидає `TypeError` при рендері `q-select`.

## Considered Options
* Передати `iconSet` рядком `'material-symbols-outlined'` (як у початковому `main.js`)
* **Передати `iconSet` імпортованим обʼєктом** з `quasar/icon-set/material-symbols-outlined.js`

## Decision Outcome
Chosen option: "Передати `iconSet` імпортованим обʼєктом", because Quasar звертається до `$q.iconSet.arrow.dropdown` (властивість обʼєкта) при рендері компонентів з іконками вибору; рядок не має цієї властивості → `TypeError` → Vue ламає цикл реактивності → втрата всіх обробників кліків.

### Consequences
* Good, because transcript фіксує очікувану користь: після виправлення в лозі Vite зафіксовано 0 помилок після full reload; кнопки відновили реакцію на кліки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `app/src/main.js`. До виправлення: `iconSet: 'material-symbols-outlined'`. Після: `import materialSymbolsOutlined from 'quasar/icon-set/material-symbols-outlined.js'` + `iconSet: materialSymbolsOutlined`. Симптом виявлявся лише при рендері першого `q-select` у сесії; `q-btn` самостійно не тригерив баг. Баг приховувався відсутністю `q-select` до додавання `CreateTaskDialog`.
