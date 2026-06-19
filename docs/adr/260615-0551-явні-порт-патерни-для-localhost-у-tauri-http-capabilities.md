---
session: 005a85c1-1524-4ddb-aece-77409f4a82d1
captured: 2026-06-15T05:51:50+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/005a85c1-1524-4ddb-aece-77409f4a82d1.jsonl
---

## ADR Явні порт-патерни для localhost у Tauri HTTP capabilities

## Context and Problem Statement

`@tauri-apps/plugin-http` відхиляв запити до `http://127.0.0.1:8000/v1/chat/completions`, хоча в `src-tauri/capabilities/default.json` вже існував дозвіл `{ "url": "http://**" }`. Причина: Tauri-реалізація `urlpattern` трактує патерн без явного порту як «лише дефолтний порт» (80 для HTTP), тому `:8000` не потрапляв під правило.

## Considered Options

* Додати явні `localhost`/`127.0.0.1` патерни з wildcardом на порт і шлях: `http://127.0.0.1:*/*`, `http://localhost:*/*`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Явні localhost-патерни з wildcard-портом", because `http://**` не покриває нестандартні порти в Tauri urlpattern — потрібно виписати `http://127.0.0.1:*/*` і `http://localhost:*/*` окремо.

### Consequences

* Good, because transcript фіксує очікувану користь: запит до `http://127.0.0.1:8000/v1/chat/completions` після зміни пройшов scope-перевірку.
* Bad, because capabilities компілюються в бінарник — потрібен повний ребілд Tauri-застосунку, гаряче перезавантаження фронтенду недостатньо.

## More Information

Змінений файл: `src-tauri/capabilities/default.json` — додано два об'єкти `{ "url": "http://127.0.0.1:*/*" }` і `{ "url": "http://localhost:*/*" }` до масиву `allow` під `identifier: "http:default"`.

---

## ADR Читання конфігу omlx із ~/.omlx/settings.json через Rust-команду

## Context and Problem Statement

omlx API key задавався вручну в кожному застосунку окремо (localStorage у Tauri-UI, `OMLX_API_KEY` env у CLI). При переході на новий комп'ютер або після перевипуску ключа треба оновлювати кожен застосунок окремо. Сам omlx-сервер вже зберігає і key, і host, і port у `~/.omlx/settings.json` — це єдине джерело правди про локальний сервер.

## Considered Options

* Читати конфіг із `~/.omlx/settings.json` через нову Tauri-команду `omlx_config` (Rust)
* Задавати `OMLX_*` env через `launchctl` або `~/.zshrc` вручну на кожній машині
* Зберігати API key у localStorage (попередня поведінка)

## Decision Outcome

Chosen option: "Читати `~/.omlx/settings.json` через Rust `omlx_config`", because файл вже присутній на кожній машині де встановлено omlx, а `$HOME` резолвиться per-machine — жодних додаткових налаштувань для нового комп'ютера не потрібно. Env-override (`OMLX_*`) спочатку додавався як запасний механізм, але потім видалений на прохання — єдине джерело конфігу тепер файл.

### Consequences

* Good, because transcript фіксує очікувану користь: API key, host і port підтягуються автоматично на будь-якій машині з omlx без `launchctl`, plist або ручного заповнення полів діалогу.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли:

* `src-tauri/src/lib.rs` — нова команда `omlx_config()`, повертає `OmlxConfig { base_url, api_key }`, читаючи `server.host`/`server.port`/`auth.api_key` з `$HOME/.omlx/settings.json` (JSON парсинг через `serde_json`); зареєстрована в `invoke_handler`.
* `src/composables/use-omlx.js` — `apiKey` вилучено з localStorage; додано `loadEnv()` що виконує `invoke('omlx_config')` і заповнює `apiKey`, `baseUrl`, `model` з відповіді Rust.
* `src/components/AgentDialog.vue` — `onMounted(loadEnv)` викликає підтягування конфігу при відкритті діалогу.

Структура `~/.omlx/settings.json` що читається: `server.host`, `server.port` → `base_url`; `auth.api_key` → `api_key`. CLI (`app/bin/task.mjs`) раніше вже читав `OMLX_API_KEY` з env — після цього рішення UI і CLI використовують різні механізми читання одного й того ж файлу.
