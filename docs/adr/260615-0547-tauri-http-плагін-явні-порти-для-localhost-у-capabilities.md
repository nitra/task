---
session: 005a85c1-1524-4ddb-aece-77409f4a82d1
captured: 2026-06-15T05:47:50+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/005a85c1-1524-4ddb-aece-77409f4a82d1.jsonl
---

## ADR Tauri HTTP-плагін: явні порти для localhost у capabilities

## Context and Problem Statement
Запити від `AgentDialog.vue` до локального LLM-сервера (`http://127.0.0.1:8000/v1/chat/completions`) відхилялись Tauri HTTP-плагіном, попри те що `capabilities/default.json` містив шаблон `http://**`. Причина: `urlpattern` Tauri трактує шаблон без порту як «тільки дефолтний порт» (80), тому нестандартний порт `:8000` не проходив перевірку scope.

## Considered Options
* Замінити `http://**` на явні шаблони з `:*` для `127.0.0.1` і `localhost`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Явні шаблони `http://127.0.0.1:*/*` і `http://localhost:*/*`", because `http://**` не матчить нестандартний порт в реалізації `urlpattern` Tauri, а явна вказівка `:*` (будь-який порт) вирішує проблему без надмірного розширення scope.

### Consequences
* Good, because запити до `http://127.0.0.1:8000/v1/chat/completions` тепер проходять scope-перевірку.
* Bad, because зміни в capabilities вимагають повного перебілду бінарника (`tauri dev` / rebuild) — hot-reload фронту недостатньо.

## More Information
Змінений файл: `src-tauri/capabilities/default.json` — додано два об'єкти в масив `allow` всередині `http:default` permission. Компіляція Rust перевірена через `cargo check`.

---

## ADR Глобальний `~/.omlx/settings.json` як канонічне джерело omlx API-ключа

## Context and Problem Statement
API-ключ для локального omlx/MLX-сервера зберігався в `localStorage` браузерного webview Tauri і мав задаватись окремо для кожної програми. CLI (`app/bin/task.mjs`) вже читав ключ із `OMLX_API_KEY` env, але Tauri-застосунок цього не робив. Потрібна була єдина конфігурація, яка б автоматично підхоплювалась на будь-якій машині з omlx без ручних налаштувань per-app.

## Considered Options
* Зберігати ключ у `localStorage` (попередній підхід)
* Читати з env-змінної `OMLX_API_KEY` (проміжне рішення — лише для dev/terminal)
* Читати безпосередньо з `~/.omlx/settings.json` — файлу, що вже існує на кожній машині де встановлено omlx, з env як опційним override

## Decision Outcome
Chosen option: "Читання з `~/.omlx/settings.json` з fallback на env", because файл вже є канонічним джерелом конфігурації omlx-сервера (host, port, api_key), резолвиться через `$HOME` per-machine, не потребує додаткового launchd/plist на кожному комп'ютері й уніфікує джерело для UI та CLI.

### Consequences
* Good, because transcript фіксує очікувану користь: один файл `~/.omlx/settings.json` покриває всі машини з omlx без ручного виставлення env на кожному комп'ютері.
* Good, because CLI і Tauri UI тепер читають ключ з одного джерела — `api_key` із `~/.omlx/settings.json` (або `OMLX_API_KEY` env як override).
* Bad, because GUI `.app`, запущений із Finder/Dock, не бачить `~/.zshrc`, тому env-override потребує `launchctl setenv` або LaunchAgent — складніший шлях порівняно з читанням файлу напряму.

## More Information
Змінені файли:
- `src-tauri/src/lib.rs` — нова Tauri-команда `omlx_config`: читає `~/.omlx/settings.json` (поля `server.host`, `server.port`, `auth.api_key`) та env-змінні `OMLX_*` як override; зареєстрована в `invoke_handler`.
- `src/composables/use-omlx.js` — `apiKey` прибрано з `localStorage`; додано `loadEnv()`, що викликає `invoke('omlx_config')`.
- `src/components/AgentDialog.vue` — `onMounted(loadEnv)` підтягує конфіг при відкритті діалогу.

Структура `~/.omlx/settings.json`: `server.host`, `server.port`, `auth.api_key`. Перевірено: `cargo check` і `vitest run` (36 тестів) — зелені.
