---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-15T09:57:55+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

Напишу ADR-и безпосередньо на основі аналізу транскрипту.

## ADR Спільний агент як єдиний інтерфейс (human-grade = agent-grade)

## Context and Problem Statement

Виникла потреба, щоб зовнішній LLM-оркестратор міг звертатися до додатку `task` з природномовними запитами («сходи до task і скажи його агенту створи задачу…»). Обговорювалась архітектура окремого «thick-агента» для агентних викликів, проте користувач сформулював ключовий принцип: агент має відповідати однаково якісно і людині, і зовнішньому агенту — тому немає сенсу розрізняти два інтерфейси.

## Considered Options

* Thick-агент лише для зовнішніх агентів (окремий, слабший, локальний)
* Один спільний in-app NL-агент (human-grade = agent-grade)

## Decision Outcome

Chosen option: "Один спільний in-app NL-агент", because якість для людини є обовʼязковою умовою релізу, а тому агент зовнішніх викликів автоматично отримує той самий рівень; розрізняти два інтерфейси — дублювання без виграшу.

### Consequences

* Good, because transcript фіксує очікувану користь: аргумент «розумний делегує дурному» знімається — ми не опускаємо інтелект заради агентів, а підіймаємо його заради людини.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Зафіксовано у `docs/specs/260615-agent-gateway.md`; реалізація — `app/src/tool/agent-handler.js` (`handleRequest`/`handleRespond`), `app/src/composables/use-agent.js`.

---

## ADR MCP-stdio як єдиний транспорт agent-gateway

## Context and Problem Statement

Зовнішній LLM-оркестратор потребує транспорту для звернення до in-app агента `task`. Потрібно обрати **один** транспорт, щоб уникнути зайвої складності.

## Considered Options

* CLI-subprocess (`task request '<json>'`)
* MCP-сервер (stdio або SSE/HTTP)
* Локальний HTTP-демон (`POST /request`)
* FS-черга (watched dir)

## Decision Outcome

Chosen option: "MCP-stdio", because це галузевий стандарт для «агент ↔ можливості додатку», discoverable зі схемами тулів, нативно підхоплюється Claude/Cursor та іншими MCP-хостами без кастомної інтеграції; лягає на наявний `dispatch`/каталог як тонка обгортка.

### Consequences

* Good, because transcript фіксує очікувану користь: typed-схеми тулів автоматично знімають проблему «треба знати параметри й нюанси» для caller-а; clarification і structured result — нативно в протоколі.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

`app/bin/task.mjs` (режим `mcp`); SDK `@modelcontextprotocol/sdk`; MCP-smoke e2e перевірено наживо: `app/mcp-smoke.mjs`; фікс keep-alive: коміт `54130b4`.

---

## ADR Глобальний app-data журнал запитів (варіант b)

## Context and Problem Statement

Усі запити — людські (UI) й агентські (MCP) — мають потрапляти в єдиний журнал для візуального аудиту («хто/що/коли просив, який статус»). Потрібно вирішити, де зберігати журнал.

## Considered Options

* (a) per-project `mt/.requests/*.jsonl` (поряд із задачами, git-trackable)
* (b) глобальний `appLocalDataDir/requests/<id>.json`

## Decision Outcome

Chosen option: "(b) глобальний appLocalDataDir", because запит — подія рівня застосунку, а не артефакт репо; failed/clarification-запит може виникнути до того, як визначено проєкт (нікуди лягти в (a)); крос-проєктна стрічка аудиту вимагає єдиного потоку.

### Consequences

* Good, because кожен запис має постійне місце незалежно від стану ґраундингу; обидва процеси (GUI + MCP-бін) резолвлять шлях детерміновано за bundle-id.
* Bad, because аудит не «їде» з репо в git (відпало разом із Android-вимогою та per-project аргументом).

## More Information

Шлях: `appLocalDataDir/requests/<id>.json`; `app/src-tauri/src/journal.rs`; Tauri команди `journal_create`, `journal_load`, `journal_update`, `journal_list`.

---

## ADR Per-file JSON записи журналу

## Context and Problem Statement

Обравши глобальний app-data журнал, потрібно визначити формат зберігання: один великий файл або окремі файли на запит.

## Considered Options

* per-file `requests/<id>.json`
* append-only `requests.jsonl`

## Decision Outcome

Chosen option: "per-file `requests/<id>.json`", because мутації статусу (running→done, дописування відповіді на clarification) простіші при перезаписі одного файлу; аудит-UI читає поточний стан + повну нитку без потреби фолдити події; запис містить `messages[]` для sessional-resume.

### Consequences

* Good, because transcript фіксує очікувану користь: аудит-UI показує повну нитку розмови на кожен запит; sessional-resume читає збережені `messages[]`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

`app/src-tauri/src/journal.rs` (функції `create`, `load`, `update`, `list`); бінарник `app/src-tauri/src/bin/journal.rs`; поля запису: `id`, `createdAt`, `updatedAt`, `actor`, `intent`, `status`, `messages`, `actions`, `summary`, `error`, `question`.

---

## ADR Sessional clarification (resume agent loop)

## Context and Problem Statement

Агент може не отримати достатньо даних для виконання наміру з першого разу («який саме k8s?»). Потрібно вирішити, як обробляти multi-turn уточнення.

## Considered Options

* One-shot + parentId (stateless: відповідь = новий `request` з `parentId`)
* Sessional resume (той самий запис, збережений `messages[]`, loop відновлюється)

## Decision Outcome

Chosen option: "Sessional resume", because він робить уточнення природним без перезапуску loop з нуля; збережені `messages[]` у записі дають повний аудит нитки; `parentId` залишається лише для явного retry.

### Consequences

* Good, because `runAgent` отримав параметр `{ messages }` для resume; аудит-UI рендерить повну нитку розмови.
* Bad, because потребує running-lock на запис, щоб два `respond` не запустили loop одночасно.

## More Information

`app/src/tool/agent-handler.js` (`handleRequest` / `handleRespond`); `app/src/tool/llm.js` (`runAgent` з resume); тести: `app/src/tests/agent-handler.test.js`.

---

## ADR Мінімальний контракт request(intent)

## Context and Problem Statement

При проєктуванні MCP-тулу `request` потрібно вирішити, що передавати як вхід: лише намір, чи також контекст (наприклад, вибраний проєкт).

## Considered Options

* Мінімальний `{ intent }` — агент завжди ґраундить сам
* `{ intent, context?: { project? } }` — опційна підказка ґраундингу
* Багатий `{ intent, context?, defaults? }` — дефолти виконання ззовні

## Decision Outcome

Chosen option: "Мінімальний `{ intent }`", because відсутність контекст-шорткатів для UI, яких немає в зовнішнього агента, є прямим дотриманням принципу паритету human = agent; неоднозначність вирішується через clarification-петлю.

### Consequences

* Good, because transcript фіксує очікувану користь: UI не отримує прихованих переваг — обидві сторони проходять той самий шлях ґраундингу через workspace-скан.
* Bad, because людина може отримати clarification-питання навіть якщо в UI вже обрано workspace (свідомо прийнята ціна паритету).

## More Information

`app/bin/task.mjs` (MCP tool `request` — схема лише `intent`); `app/src/tool/agent-handler.js`; `docs/specs/260615-agent-gateway.md`.

---

## ADR Два MCP-тули: request і respond

## Context and Problem Statement

При sessional clarification через MCP потрібно вирішити: один overloaded тул для старту і продовження, чи два окремих.

## Considered Options

* Один overloaded тул `request({ intent? | requestId+message })`
* Два тули `request(intent)` і `respond(requestId, message)`

## Decision Outcome

Chosen option: "Два тули `request` і `respond`", because чіткі схеми дозволяють LLM однозначно розрізняти «почати новий запит» і «відповісти на уточнення»; умовні поля в одному тулі погіршують дискримінацію для моделі.

### Consequences

* Good, because transcript фіксує очікувану користь: MCP-клієнт (LLM) надійніше розрізняє операції; схеми обох тулів прості і без опційних полів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

`app/bin/task.mjs` (реєстрація `request` і `respond` у MCP-сервері); e2e smoke-тест `app/mcp-smoke.mjs`.

---

## ADR macOS-only платформа (без Android)

## Context and Problem Statement

Обговорювалася кросплатформна підтримка (macOS + Android). Android вимагає суттєво іншого стеку: sandbox без довільної ФС, відсутність MCP-stdio, відсутність MLX/omlx. Потрібно вирішити обсяг підтримки.

## Considered Options

* Профілі можливостей: macOS (повний хост) + Android (клієнт, remote модель, синкований store)
* Лише macOS

## Decision Outcome

Chosen option: "Лише macOS", because користувач прямо підтвердив: «залишаємо тільки мак версію»; це усуває потребу в Store-абстракції, профілях можливостей, remote-моделі та кросплатформній ФС-логіці.

### Consequences

* Good, because дизайн і реалізація суттєво спрощуються: одна ФС-реалізація, один транспорт, оne профіль.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

`docs/specs/260615-agent-gateway.md` (секція «Platform»); omlx (`localhost`) як єдина модель-реалізація.

---

## ADR Вся ФС журналу через Rust (FS-in-Rust)

## Context and Problem Statement

Модуль журналу спочатку реалізовано на `node:fs` (`journal.js`) для node MCP-бінарника. У вебвʼю (Tauri) `node:fs` недоступний. Проєкт дотримується принципу «вся ФС → Rust».

## Considered Options

* `journal.js` на `node:fs` (node-only, вебвʼю через `@tauri-apps/plugin-fs` у JS)
* Rust-модуль `journal.rs` + бінарник `journal` + Tauri-команди `journal_*`

## Decision Outcome

Chosen option: "Rust-модуль + бінарник + Tauri-команди", because дотримання принципу «вся ФС → Rust»; єдина реалізація FS-логіки ділиться між node-біном (спавнить `journal`-бінарник) і вебвʼю (invoke Tauri-команди) без дублювання коду.

### Consequences

* Good, because `journal.js` (node:fs) видалено; `agent-handler` отримав інжектований store-інтерфейс (`journal.create/load/update`) — один handler для обох середовищ.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

`app/src-tauri/src/journal.rs`; `app/src-tauri/src/bin/journal.rs`; Tauri-команди: `journal_create`, `journal_load`, `journal_update`, `journal_list`; `app/src/tool/journal-store-node.js`; `app/src/tool/journal-store-tauri.js`; коміт `a68c115`.

---

## ADR Правило tool-surface у @nitra/cursor

## Context and Problem Statement

Принцип «будь-яка дія фронтенду має бути виконуваною без UI через спільний каталог тулів» реалізовано в проєкті `task`. Щоб він поширювався на нові проєкти автоматично, його треба підняти в пакет `@nitra/cursor`.

## Considered Options

* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Нове правило `tool-surface` у `npm/rules/tool-surface/`", because фіксує інваріант паритету (catalog → dispatch → UI/CLI/LLM-адаптери) на рівні організаційного пакету правил, щоб він автоматично синкався у нові проєкти.

### Consequences

* Good, because правило зʼявляється в `AUTO_RULE_ORDER` між `text` і `vue`; авто-активується на фронтенд-залежностях (`vue`, `react`, `@tauri-apps/api` тощо); `tauri.mdc` отримав per-stack секцію реалізації.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

`/Users/vitalii/www/nitra/cursor/npm/rules/tool-surface/tool-surface.mdc`; `npm/rules/tool-surface/meta.json`; `npm/rules/tool-surface/fix.mjs`; `npm/rules/tauri/tauri.mdc` (версія `1.4 → 1.5`); гілка `feat/tool-surface-rule` у репо `@nitra/cursor`; 693 тести пройшли після додавання правила.
