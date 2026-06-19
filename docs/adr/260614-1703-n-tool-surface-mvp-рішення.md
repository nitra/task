# n-tool-surface MVP: реалізаційні рішення

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Після ухвалення принципу n-tool-surface (паритет UI ↔ LLM ↔ оркестратор, зафіксований у `260614-1104-headless-actions-паритет-фронтенд-llm-cli.md`) потрібно було прийняти чотири конкретних реалізаційних рішення для MVP: вибір LLM-провайдера та формату тул-маніфесту, транспорт для headless CLI-оркестратора, підхід до per-stack реалізації адаптерів, усунення jscpd-клону між UI-компонентами діалогів.

## Considered Options

**LLM-провайдер:**

- Claude (Anthropic) через `tauri-plugin-http` (онлайн, Anthropic tools format)
- Локальна офлайн MLX + Gemma 3n/4 E4B через omlx (OpenAI-сумісний сервер на localhost)
- Провайдер-агностик (кілька бекендів)

**CLI headless транспорт:**

- Per-verb spawn: окремий `spawnSync` для кожного verb-у (`mt-scanner scan/workspaces/create …`)
- Уніфікований `mt-scanner exec '<json>'` — один JSON-dispatch endpoint у mt-репо

**Per-stack реалізація адаптерів:**

- Єдиний JS-канон для всіх стеків (native-деталь — внутрішня справа)
- Платформо-незалежне ядро + per-stack секції у профільних правилах (n-tauri, n-vue, n-capacitor)

**UI-компоненти діалогів:**

- `jscpd` ignore для клонів між `AgentDialog` і `CreateTaskDialog`
- Спільний базовий компонент `BaseDialog.vue`

## Decision Outcome

Chosen option: "omlx (локальна MLX) + per-verb spawn + per-stack секції + BaseDialog", because omlx на localhost надає стандартний OpenAI function-calling API (`/chat/completions` з `tools`), а `tauri-plugin-http` вже підключений; три verb-и `mt-scanner` вже існують — mt-репо не потребує змін для MVP; ядро правила залишається платформо-незалежним, а розходження реалізацій між стеками — допустиме і навмисне; рефактор `BaseDialog` усуває справжній дублікат, а не обходить лінтер.

### Consequences

- Good, because транскрипт фіксує повний LLM-loop наживо: `gemma-4-e2b-it-4bit` через omlx `:8000` сама обрала тул `create`, `dispatch` виконав його через `mt-scanner`, реально створено `demo-llm/task.md` + `demo-llm/a.md` без будь-якого UI.
- Good, because `fetchFn` інжектується в `createOpenAiChat` — in-app: `@tauri-apps/plugin-http`, CLI: node `fetch`, тести: `vi.fn()`; 34 тести зелені без живого omlx; `lint-js exit 0`, `lint-style exit 0`, `vite build ✓`.
- Bad, because `gemma-4-e4b-it-OptiQ-4bit` впала через memory ceiling (потрібно 17.89 GB, доступно 11.84 GB) — реально запустилась `gemma-4-e2b-it-4bit`; 4B-модель потребує constrained decoding і малого набору тулів за раз.
- Neutral, because поле `argv(input)` у кожному тулі `catalog.js` дублює логіку при додаванні нового тула (схема + argv); усувається при впровадженні `mt-scanner exec '<json>'` як наступного кроку.

## More Information

Файли MVP у `app/src/tool/`: `catalog.js` (3 тули: scan, workspaces, create з полями `name`, `description`, `schema`, `tauriCmd`, `argv`), `dispatch.js` (`dispatch(name, input)` → `{ok, output}` / `{ok:false, error:{code,message}}`), `manifest.js` (`toolManifest()` → OpenAI function-calling schema, `listTools()`), `transports.js`, `llm.js` (`runAgent({prompt, dispatch, chat, maxSteps})`, `createOpenAiChat({baseUrl, model, apiKey, fetchFn})`), `index.js`.

`app/bin/task.mjs` — `task <tool> '<json>'` | `task list` | `task schema` | `task agent "<prompt>"`. Env: `OMLX_BASE_URL` (default `http://127.0.0.1:8000/v1`), `OMLX_MODEL` (default `gemma-4-e4b-it-OptiQ-4bit`), `OMLX_API_KEY`.

`app/src/components/BaseDialog.vue` — props: `modelValue`, `title`, `icon`, `width`, `bodyClass`; слоти `default` + `actions`. `AgentDialog.vue` і `CreateTaskDialog.vue` переписані на `<BaseDialog>`.

Резолвер `mt-scanner`: `MT_SCANNER_BIN` env → `mt/target/release/mt-scanner` → `mt/target/debug/mt-scanner` → `/usr/local/bin/mt-scanner`.

Специфікація: `docs/specs/260614-n-tool-surface.md`. Тести: `app/src/tests/tool.test.js` (21 тест), `app/src/tests/llm.test.js` (13 тестів). Гілка: `feat/create-task-command`.

## Update 2026-06-14

Виявлена і усунена вада WKWebView (macOS): `backdrop-filter: blur(12px)` на `position:fixed` хедері перехоплює pointer events по всьому вікну — реальні кліки не проходять, тоді як синтетичні (в тестах) обходять хіт-тест і проходять. Вирішення: видалено `backdrop-filter` і `background: transparent`, хедер отримав суцільний нативний фон з підтримкою тем. Стан після виправлення: тести 36/36 ✓, lint-js ✓, build ✓, cspell ✓, changelog ✓.

## Update 2026-06-14

**Термінологія тул-сурфейсу.** Обрано термін `tool` (відхилено `action`, `command`, `capability`) — ключовий новий гравець LLM використовує `tool` як галузевий стандарт (OpenAI function-calling, MCP, Anthropic tool-use). Правило: `n-tool-surface`. Тека: `src/tool/`. Публічна функція: `dispatch(name, input)`. CLI `app/bin/task.mjs` надає лише машинний інтерфейс (`task <tool> '<json>' | list | schema | agent`) — людський ergonomic CLI виключено свідомо: єдиний споживач — скриптовий оркестратор/LLM.

**Per-verb spawn MVP.** Handlers тулів у `app/bin/task.mjs` спавнять verb-и `mt-scanner` (`scan`, `workspaces`, `create`) напряму. Уніфікований `mt-scanner exec '<json>'` залишено наступним кроком — mt-репо не змінювалось.

## Update 2026-06-15

**Публікація в `@nitra/cursor`.** Правило `n-tool-surface` опубліковано як `npm/rules/tool-surface/tool-surface.mdc` у репо `n/cursor` (гілка `feat/tool-surface-rule`, коміт `22925f07`). Авто-активація через `depInAnyPackageJson` для `vue`, `react`, `svelte`, `@tauri-apps/api`, `@capacitor/core`. Changelog: `npm/.changes/260615-0530.md` (`minor`/`Added`). Тести cursor-репо після додавання: 693/693 ✓.

**Per-stack секції.** Правило тримає платформо-незалежне ядро; Tauri-деталі (`tauriTransport`, `invoke`) ізольовані в `transports.js` і делегуються в `n-tauri` (v1.5, розділ «Tool Surface — Tauri-реалізація»). `n-capacitor` — запланований.
