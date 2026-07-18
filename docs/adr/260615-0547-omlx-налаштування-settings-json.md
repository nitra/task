# `~/.omlx/settings.json` як канонічне джерело конфігурації omlx у Tauri

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

omlx API-ключ зберігався у `localStorage` браузерного webview Tauri і мав вводитися вручну через ⚙-панель `AgentDialog` для кожного застосунку окремо. CLI (`app/bin/task.mjs`) вже читав ключ із `OMLX_API_KEY` env, але Tauri-застосунок цього не робив. GUI `.app`, запущений із Finder/Dock, не бачить `~/.zshrc`, тому env-підхід вимагав `launchctl setenv` або LaunchAgent на кожній машині.

## Considered Options

- Зберігати ключ у `localStorage` — попередній підхід, ручне введення per-app.
- Читати з env-змінної `OMLX_API_KEY` — проміжне рішення; не працює для GUI з Finder/Dock без додаткового налаштування.
- Читати з `~/.omlx/settings.json` (файл, що вже існує на кожній машині з omlx) з env як опційним override.

## Decision Outcome

Chosen option: "Читання з `~/.omlx/settings.json` з fallback на env", because файл вже є канонічним джерелом конфігурації omlx-сервера (host, port, api_key), резолвиться через `$HOME` per-machine, не потребує додаткового launchd/plist і уніфікує джерело для UI та CLI.

### Consequences

- Good, because один файл `~/.omlx/settings.json` покриває всі машини з omlx без ручного виставлення env на кожному комп'ютері.
- Good, because CLI і Tauri UI тепер читають ключ з одного джерела — `auth.api_key` із `~/.omlx/settings.json` (або `OMLX_API_KEY` env як override).
- Bad, because GUI `.app` із Finder/Dock не бачить `~/.zshrc` — env-override потребує `launchctl setenv` або LaunchAgent; пряме читання файлу усуває цю проблему.

## More Information

Змінені файли:
- `src-tauri/src/lib.rs` — нова Tauri-команда `omlx_config`: читає `~/.omlx/settings.json` (поля `server.host`, `server.port`, `auth.api_key`) та env-змінні `OMLX_*` як override; зареєстрована в `invoke_handler`.
- `src/composables/use-omlx.js` — `apiKey` прибрано з `localStorage`; `loadEnv()` викликає `invoke('omlx_config')`.
- `src/components/AgentDialog.vue` — `onMounted(loadEnv)` підтягує конфіг при відкритті діалогу.

Структура `~/.omlx/settings.json`: `server.host`, `server.port`, `auth.api_key`. Перевірено: `cargo check` і `vitest run` (36 тестів) — зелені.

## Update 2026-06-15

Проміжний крок тієї самої сесії `005a85c1` (до запису settings.json-рішення): API-ключ спочатку переведено з `localStorage` на читання через env-змінну — нова Tauri-команда `omlx_config` у `lib.rs` читала `OMLX_BASE_URL`, `OMLX_MODEL`, `OMLX_API_KEY` зі `std::env` і повертала JSON фронту; `loadEnv()` у `use-omlx.js` викликала `invoke('omlx_config')` і перекривала localStorage-дефолт. Цей підхід усував ручне введення у UI, але не вирішував проблему GUI `.app` запущеного з Finder/Dock (не бачить `~/.zshrc`). Саме це обмеження стало головним аргументом на користь прямого читання з `~/.omlx/settings.json`.
