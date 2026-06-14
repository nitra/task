---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-14T18:03:24+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

Готово — `main` і `origin/main` на `e36a107`.

GitHub сповіщає про 1 moderate vulnerability в залежностях (не від моїх змін) — варто глянути `gh api …/dependabot/alerts` або прямо на GitHub Security tab.

Тепер `@nitra/cursor` — фіналізуємо правило `n-tool-surface` і переносимо туди?
---
Transcript is truncated.

## ADR Уніфікований командний інтерфейс (n-tool-surface)

## Context and Problem Statement
У проєкті `task` фронтенд був єдиною точкою входу до дій: компоненти `TaskGraph` і `CreateTaskDialog` викликали `invoke` напряму. LLM і оркестратори не мали доступу до тих самих дій без UI. Потрібно було зробити кожну дію виклюкаємою headless — з CLI і через LLM — при цьому не переносячи логіку обовʼязково на бекенд.

## Considered Options
* Залишити логіку в компонентах, додати окремий CLI-бінарник із дублюванням
* **Єдиний каталог тулів (`src/tool/`) як single source; UI/CLI/LLM — лише адаптери**
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Єдиний каталог тулів `src/tool/` як single source", because це не вимагає перенесення логіки на бекенд — JS-логіка може лишатися у фронтенді, але організована як іменований callable зі схемою, доступний усім трьом споживачам.

### Consequences
* Good, because transcript фіксує очікувану користь: паритет UI/CLI/LLM доведено end-to-end (CLI `task create` і UI через `dispatch` → той самий Rust `mt-scanner`; LLM через omlx прогнав тул `create` і реально створив `task.md`).
* Bad, because у Tauri-проєкті схеми в JS-каталозі та Rust-типи можуть розійтися; мітигується валідацією входу в `dispatch.js` до виклику транспорту.

## More Information
Файли: `app/src/tool/{catalog,dispatch,manifest,transports,index,llm}.js`, `app/bin/task.mjs`, `docs/specs/260614-n-tool-surface.md`. Команди: `bun bin/task.mjs list | schema | <tool> '<json>' | agent "<prompt>"`. Commit: `e36a107`.

---

## ADR Термінологія та структура тул-сурфейсу

## Context and Problem Statement
Потрібно було обрати стабільні назви для нового шару абстракції, бо ці назви мають увійти в канонічне правило `@nitra/cursor` для всіх web/Tauri-проєктів.

## Considered Options
* Термін одиниці: `action`, `command`, `capability`, `operation`, **`tool`**
* Назва правила: `n-actions`, `n-headless`, `n-callable`, **`n-tool-surface`**
* Тека: `src/actions/`, **`src/tool/`**
* CLI-режими: людський verb + машинний exec / **тільки машинний** (без ергономічного CLI для людей)

## Decision Outcome
Chosen option: "термін `tool`, правило `n-tool-surface`, тека `src/tool/`, тільки машинний CLI", because ключовий новий гравець — LLM, тому термін має дзеркалити LLM tool-use; людський CLI виключено свідомо — точка входу для скриптового оркестратора, а не для ручного використання.

### Consequences
* Good, because transcript фіксує очікувану користь: термінологія однозначна, нема конфлікту з Tauri-командами чи shell-командами.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Рішення зафіксовано у `docs/specs/260614-n-tool-surface.md`. Термін `dispatch(name, input)` як функція виклику, `app/bin/task.mjs` як машинний bin.

---

## ADR LLM-провайдер і протокол для тул-сурфейсу

## Context and Problem Statement
Необхідно визначити, яку модель/провайдера використовувати для LLM-адаптера тул-сурфейсу і через який протокол передавати визначення тулів, щоб це відповідало вимозі «локально, без фронтенду».

## Considered Options
* LLM: Claude (Anthropic), **локальна офлайн MLX + Gemma 4 E4B через omlx**, провайдер-агностик
* Протокол: **OpenAI-сумісний HTTP (`/v1/chat/completions` з `tools`)**, Anthropic tools-маніфест, власний JSON-маніфест, MCP (як ціль на потім)

## Decision Outcome
Chosen option: "локальна MLX + Gemma 4 E4B через omlx (OpenAI-сумісний сервер)", because вимога — офлайн, приватність; omlx вже запущений і підтримує OpenAI function-calling endpoint; наявний `tauri-plugin-http` підходить без додаткової інфраструктури. MCP залишено як подальший крок.

### Consequences
* Good, because transcript фіксує очікувану користь: end-to-end прогін підтверджено на живій моделі `gemma-4-e2b-it-4bit` (e4b не влізла через memory ceiling 11.84 GB); конверт `{ok, output}` повернувся, `task.md`+`a.md` реально створено.
* Bad, because малий ~4B Gemma нестабільний у tool-use; рекомендовано тримати малий набір тулів (3), по 1 за хід, і використовувати constrained decoding.

## More Information
Змінні середовища: `OMLX_BASE_URL` (дефолт `http://127.0.0.1:8000/v1`), `OMLX_MODEL` (дефолт `gemma-4-e4b-it-OptiQ-4bit`), `OMLX_API_KEY`. Файл: `app/src/tool/llm.js` (`createOpenAiChat`, `runAgent`). Commit: `e36a107`.

---

## ADR Headless-точка входу: per-verb spawn vs уніфікований exec

## Context and Problem Statement
У Tauri-проєкті реальна робота (обхід ФС, створення задач) живе в Rust-крейті `mt-scanner`. Потрібно вирішити, як JS-handler у каталозі тулів звертається до бінарника — через окремий argv-verb на кожен тул або через єдиний уніфікований JSON-dispatch.

## Considered Options
* **(A) Per-verb spawn** — handler кожного тула спавнить наявний verb: `mt-scanner scan/workspaces/create …`
* **(B) Уніфікований `mt-scanner exec '<json>'`** — один транспорт, Rust диспетчить усередині
* **(C) Rust-бінарник як єдина точка** — JS-каталог лише форвардить

## Decision Outcome
Chosen option: "(A) per-verb spawn для MVP", because mt-репо не чіпаємо, 3 verb-и (`scan`, `workspaces`, `create`) вже існують; уніфікований `exec` залишено наступним кроком.

### Consequences
* Good, because transcript фіксує очікувану користь: нуль змін у mt-репо; CLI-демо `task create / scan` відпрацювало з першого запуску.
* Bad, because потрібен argv-мапінг у каталозі для кожного нового тула (дрібне дублювання); вирішується на кроці B.

## More Information
Файл: `app/bin/task.mjs` (функція `resolveScanner` шукає `mt/target/release/mt-scanner`). Env `MT_SCANNER_BIN` перевизначає шлях. Commit: `e36a107`.

---

## ADR Подвійний канон Rust↔JS: per-stack секції в правилі

## Context and Problem Statement
Правило `n-tool-surface` має охоплювати і pure-web проєкти (без Rust), і Tauri-проєкти, і Capacitor-проєкти. Потрібно вирішити, як описати розбіжність «де живе реальна логіка» без суперечності єдиному принципу.

## Considered Options
* **(A) Єдиний JS-канон** — handler завжди JS, native = деталь делегації
* **(B) Два явні канони** — правило описує обидва патерни
* **(C) Native-first** — у Rust-проєктах JS = тонкий клієнт, Rust = single source

## Decision Outcome
Chosen option: "per-stack секції в правилі `n-tool-surface`", because web і Tauri розходяться свідомо й це перевага: архітектура спільна (каталог + dispatch + manifest), реалізація транспорту — per-stack, і ці деталі делегуються в профільні правила (`n-tauri`, `n-vue`, `n-capacitor`).

### Consequences
* Good, because transcript фіксує очікувану користь: правило залишається платформо-незалежним ядром, без вимушеного компромісу між стеками.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Специфікація: `docs/specs/260614-n-tool-surface.md` (структура «ядро + per-stack секції»). Commit: `e36a107`.
