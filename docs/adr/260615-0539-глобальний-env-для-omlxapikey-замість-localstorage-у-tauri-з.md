---
session: 005a85c1-1524-4ddb-aece-77409f4a82d1
captured: 2026-06-15T05:39:14+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/005a85c1-1524-4ddb-aece-77409f4a82d1.jsonl
---

Good, тепер підсумую що зроблено.

**`OMLX_API_KEY` тепер читається з env користувача** — ключ більше не потрібно вводити в кожному UI-діалозі.

### Що змінилось

**`src-tauri/src/lib.rs`** — нова команда `omlx_config`:
- читає `OMLX_BASE_URL`, `OMLX_MODEL`, `OMLX_API_KEY` зі змінних середовища
- повертає JSON-об'єкт фронту

**`src/composables/use-omlx.js`** — `loadEnv()`:
- викликає `invoke('omlx_config')`
- якщо env-змінна встановлена — перекриває `localStorage`-дефолт
- `apiKey` більше **не** зберігається в localStorage (тільки в env)

**`src/components/AgentDialog.vue`** — `onMounted(() => loadEnv())` щоб ключ підтягнувся при відкритті діалогу.

### Як налаштувати

Додай у `~/.zshrc` (або `~/.bashrc`):
```sh
export OMLX_API_KEY="твій-ключ"
# необов'язково:
export OMLX_BASE_URL="http://127.0.0.1:8000/v1"
export OMLX_MODEL="mlx-community/gemma-3-4b-it-4bit"
```

Перезапусти термінал і запусти `tauri dev` — діалог підхопить ключ автоматично.

---

## ADR Глобальний env для OMLX_API_KEY замість localStorage у Tauri-застосунку

## Context and Problem Statement
У Tauri-застосунку API-ключ для локального omlx-сервера (OpenAI-compatible MLX) зберігався в `localStorage` й мав вводитися вручну через ⚙-панель `AgentDialog`. Ключ вже існував у файлі конфігурації системи. Потрібно позбутися дублювання та ручного введення.

## Considered Options
* Читати ключ з env-змінних через нову Tauri-команду (`invoke('omlx_config')`) при монтуванні компонента
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Читати ключ з env-змінних через нову Tauri-команду", because API-ключ вже лежить у файлі конфігурації (наприклад, `~/.zshrc`), тому env є єдиним джерелом правди без дублювання.

### Consequences
* Good, because transcript фіксує очікувану користь: ключ більше не потрібно вводити для кожної програми окремо; `loadEnv()` перекриває localStorage-дефолт при монтуванні.
* Bad, because `apiKey` більше не зберігається в localStorage, тому у випадку запуску без env-змінної поле залишається порожнім і сервер поверне `401`.

## More Information
- `src-tauri/src/lib.rs` — нова команда `omlx_config`, читає `OMLX_BASE_URL`, `OMLX_MODEL`, `OMLX_API_KEY` з `std::env`
- `src/composables/use-omlx.js` — `loadEnv()` викликає `invoke('omlx_config')` і оновлює реактивні `ref`
- `src/components/AgentDialog.vue` — `onMounted(() => loadEnv())` підтягує ключ при відкритті діалогу
- CLI (`app/bin/task.mjs:73`) вже читав `OMLX_API_KEY` з env до цієї зміни
