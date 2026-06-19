# Tauri HTTP scope: явні порти для loopback-адрес

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

Фронтенд (`AgentDialog.vue`) використовує `@tauri-apps/plugin-http` для запитів до локального LLM-ендпоінта (`http://127.0.0.1:8000/v1/chat/completions`). Tauri відхиляв запит, попри наявний шаблон `http://**` у `capabilities/default.json`: реалізація `urlpattern` трактує шаблон без порту як дозвіл лише на дефолтний порт (80), тому нестандартний `:8000` не проходив scope-перевірку.

## Considered Options

- Залишити `http://**` і очікувати що він покриє будь-який порт (не спрацьовує через семантику `urlpattern`)
- Додати явні шаблони з wildcard-портом `:*` для `127.0.0.1` і `localhost`

## Decision Outcome

Chosen option: "Явні шаблони `http://127.0.0.1:*` і `http://localhost:*`", because `http://**` не матчить нестандартний порт в реалізації `urlpattern` Tauri, а явна вказівка `:*` вирішує проблему без надмірного розширення scope — non-loopback HTTP покривається існуючим `http://**`.

### Consequences

- Good, because запити до `http://127.0.0.1:8000/v1/chat/completions` та будь-яких інших loopback-сервісів на довільному порту тепер проходять scope-перевірку; після виправлення нова помилка — `401 API key required` від omlx-сервера, що підтверджує scope-проблему вирішено повністю і відокремлено від auth.
- Bad, because capabilities вбудовуються в бінарник під час build — hot-reload фронту недостатньо, потрібен повний rebuild (`tauri dev` або `tauri build`).

## More Information

Файл: `app/src-tauri/capabilities/default.json`, блок `http:default` → `allow`. Додано: `{ "url": "http://127.0.0.1:*" }`, `{ "url": "http://localhost:*" }`. Існуючий шаблон `http://**` збережено. Компонент що виконує запит: `app/src/components/AgentDialog.vue` (імпортує `fetch` з `@tauri-apps/plugin-http`).
