---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-15T05:34:01+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

## ADR omlx як OpenAI-сумісний LLM-адаптер для локального агента

## Context and Problem Statement
Проєкт потребує локального LLM-агента без хмари: обрано Gemma 3n E4B на MLX. Питання — через який протокол фронтенд (Tauri) і оркестратор звертаються до моделі та в якому форматі описувати тули.

## Considered Options
* omlx — OpenAI-сумісний MLX-сервер на `localhost` з endpoint `/v1/chat/completions` + `tools`
* Антропік-сумісний формат (tool_use / Messages API)
* MCP як транспортна шина між JS/Rust і Python-раннером

## Decision Outcome
Chosen option: "omlx + OpenAI function-calling формат", because користувач підтвердив omlx як конкретну реалізацію («це omlx на зараз»), а OpenAI-формат обраний тому, що MLX-сервер говорить OpenAI API; MCP залишається ціллю на після MVP — поки що прямий localhost HTTP.

### Consequences
* Good, because transcript фіксує очікувану користь: адаптер `createOpenAiChat` у `app/src/tool/llm.js` inject-ується і в Tauri (`tauri-plugin-http` fetch), і в CLI (`node fetch`), і в тести (mock); повний e2e цикл підтверджено наживо з `gemma-4-e2b-it-4bit` через порт `:8000`.
* Bad, because e4b-модель (`gemma-4-e4b-it-OptiQ-4bit`) впала з HTTP 507 через memory pressure (17.89 GB > 11.84 GB ceiling) — реальна потужніша модель потребує звільнення RAM або підняття `memory_guard_tier`.

## More Information
- `app/src/tool/llm.js` — `createOpenAiChat({ baseUrl, model, apiKey, fetchFn })` + `runAgent({ prompt, dispatch, chat, maxSteps })`
- `app/bin/task.mjs` — команда `task agent "<prompt>"`, конфіг через `OMLX_BASE_URL` / `OMLX_MODEL` / `OMLX_API_KEY`
- Перевірено: `OMLX_BASE_URL=http://127.0.0.1:8000/v1`, `OMLX_API_KEY=omlx-local-test-key`, модель `gemma-4-e2b-it-4bit` (e2b) успішно провела tool-call → `mt-scanner create` → файли `demo-llm/task.md` + `demo-llm/a.md`

---

## ADR per-verb spawn mt-scanner як headless-транспорт тулів

## Context and Problem Statement
Handlers тулів у `src/tool/catalog.js` мають виконувати реальну ФС-роботу: `scan`, `workspaces`, `create`. Ця робота реалізована в Rust-бінарнику `mt-scanner` (воркспейс `mt/`). Потрібен транспорт між JS-диспетчером і Rust-бінарником для CLI/LLM-оркестратора.

## Considered Options
* (A) Per-verb spawn: кожен handler викликає відповідний verb — `mt-scanner scan …`, `mt-scanner workspaces …`, `mt-scanner create …`
* (B) Уніфікований `mt-scanner exec '<json>'`: один транспорт, Rust диспетчить усередині
* (C) Rust-бінарник як єдина точка: JS-каталог лише описує/форвардить

## Decision Outcome
Chosen option: "(A) per-verb spawn", because користувач обрав A для MVP — «mt-репо не чіпаємо, mt-scanner exec — наступний крок».

### Consequences
* Good, because transcript фіксує очікувану користь: нуль змін у `mt/`-репо (три verbs уже є: `scan`, `workspaces`, `create`); повний round-trip підтверджено (`task create …` → `ok:true` + файли; `task scan …` → граф).
* Bad, because argv-мапінг на кожен тул у каталозі — дрібне дублювання; `dispatch`-єдиноманітність буде зламана до впровадження (B).

## More Information
- `app/bin/task.mjs` — функція `spawnVerb(bin, verb, ...args)`, резолвер бінарника шукає `mt/target/release/mt-scanner`
- `app/src/tool/catalog.js` — кожен тул має поле `argv(input) → string[]`, яке bin конвертує у spawn-аргументи
- Бінарник підтверджено: `mt/target/release/mt-scanner` (workspace `mt/`, `scanner/src/main.rs` має `scan`, `workspaces`, `create`-arms)

---

## ADR Спільна архітектура тул-сурфейсу з розподіленою per-stack реалізацією

## Context and Problem Statement
Правило `n-tool-surface` має охоплювати і чисто-вебові проєкти, і Tauri, і Capacitor. Постало питання: єдиний JS-канон скрізь чи різні патерни per-stack.

## Considered Options
* (A) Єдиний JS-канон всюди — handler завжди JS у `src/tool/`, делегує в Rust/native як внутрішня деталь
* (B) Два явні канони — окремий «JS-native handler» і «делегуючий handler»
* (C) Native-first коли є Rust — Rust-крейт = тул-сурфейс, JS — тонкий клієнт

## Decision Outcome
Chosen option: "спільна архітектура + per-stack реалізація в окремих правилах", because користувач уточнив: «web і Tauri розходяться — це допустимо і навіть краще; архітектура спільна, а реалізація під Tauri одна, під Capacitor інша, окремими секціями в правилі, деталі — у своїх правилах».

### Consequences
* Good, because transcript фіксує очікувану користь: правило `n-tool-surface` тримає платформо-незалежний контракт (інваріант паритету, конверт `{ok,output}`, єдиний каталог схем), а per-stack реалізація делегується в `n-tauri`/`n-vue`/`n-capacitor` — проєкти обирають секцію за стеком.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/tool-surface/tool-surface.mdc` у репо `@nitra/cursor` — ядро правила (`alwaysApply: false`, авто-активація на `vue`/`react`/`svelte`/`@tauri-apps/api`/`@capacitor/core`)
- `npm/rules/tauri/tauri.mdc` (версія `1.5`) — доданий розділ «Tool Surface (n-tool-surface) — Tauri-реалізація»: один Rust-fn на тул, `#[tauri::command]`, dispatch-invoke через camelCase-ключі, конверт `{ok,output}`/`{ok:false,error}`
- `docs/specs/260614-n-tool-surface.md` — канон-спека в проєкті `task` з дворівневою структурою (ядро + per-stack)
