# LLM-агент loop з інжектованими залежностями

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

Потрібно запустити LLM-агент loop (вибір тулу → dispatch → результат → наступний крок) у трьох середовищах одночасно: Tauri WebView (мережа через `@tauri-apps/plugin-http`), headless CLI (node `fetch`), юніт-тести (`vi.fn()` без мережі). Жорсткий `fetch` у тілі loop робить усі три середовища несумісними між собою.

## Considered Options

- `runAgent({ chat, dispatch, maxSteps })` — loop не знає про мережу; `chat` (LLM-клієнт) і `dispatch` (тул-виконавець) інжектуються ззовні через `createOpenAiChat({ baseUrl, apiKey, model, fetchFn })`
- Хардкод `fetch` + умовне галуження `if (isTauri)` всередині loop
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "`runAgent` з інжектованими `chat` і `dispatch`", because лише інжекція дозволяє один і той самий loop тестувати з мок-функцією без мережі, запускати з CLI через node `fetch` і монтувати в UI через `tauri-http`-обгортку — без розгалуження у ядрі loop.

### Consequences

- Good, because transcript фіксує: 6 юніт-тестів покривають сценарії tool-call → результат → фінал, без тулів, maxSteps-кап, битий JSON, HTTP ok/non-ok — всі проходять без реальної мережі.
- Good, because e2e перевірено наживо: `gemma-4-e2b-it-4bit` через omlx — loop завершився за 2 кроки, задача реально створена на диску.
- Bad, because `gemma-4-e4b-it-OptiQ-4bit` повернула 507 memory ceiling при 10.57 GB зайнятих із порогом 11.84 GB — обмеження середовища, не коду.

## More Information

Файли: `app/src/tool/llm.js` (`runAgent`, `createOpenAiChat`), `app/src/tests/llm.test.js` (6 тестів), `app/bin/task.mjs` (команда `agent`). `createOpenAiChat` приймає `{ baseUrl, apiKey, model, fetchFn }` — `fetchFn` підставляється залежно від середовища: node `fetch`, `tauri-http`-обгортка або `vi.fn()`. Env-конфіг для CLI: `OMLX_BASE_URL`, `OMLX_MODEL`, `OMLX_API_KEY`; у Tauri-UI конфіг читається через Rust-команду `omlx_config` зі `~/.omlx/settings.json`. Підтверджена робоча модель: `gemma-4-e2b-it-4bit` на `http://127.0.0.1:8000/v1`.
