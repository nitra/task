# Tauri HTTP-плагін — явний wildcard-порт для localhost у capabilities

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

Фронтенд (`AgentDialog.vue`) використовує `@tauri-apps/plugin-http` для запитів до локального LLM-сервера (`http://127.0.0.1:8000/v1/chat/completions`). Tauri відхиляв запит, попри наявний шаблон `{ "url": "http://**" }` у `capabilities/default.json`. Причина: реалізація `urlpattern` у Tauri трактує шаблон без явного порту як дозвіл лише на порт за замовчуванням (80 для `http://`) — нестандартний порт `:8000` ніколи не збігався з цим шаблоном.

## Considered Options

- Залишити `http://**` і розраховувати, що він покриє будь-який порт (не спрацьовує через семантику `urlpattern`).
- Додати явні шаблони з wildcard-портом `:*` для `127.0.0.1` і `localhost`.

## Decision Outcome

Chosen option: "Явні шаблони `http://127.0.0.1:*/*` і `http://localhost:*/*`", because `http://**` не матчить нестандартний порт в реалізації `urlpattern` Tauri, а явна вказівка `:*` вирішує проблему без надмірного розширення scope.

### Consequences

- Good, because запити до `http://127.0.0.1:8000/v1/chat/completions` тепер проходять Tauri scope-перевірку; після виправлення нова помилка стала `401 API key required` від omlx-сервера — scope-проблему повністю вирішено.
- Bad, because capabilities компілюються у бінарник під час build — зміна набирає чинності лише після перезапуску `tauri dev` / повного rebuild; hot-reload фронтенду недостатньо.

## More Information

Змінений файл: `app/src-tauri/capabilities/default.json` — блок `http:default` → `allow`, додано `{ "url": "http://127.0.0.1:*/*" }` і `{ "url": "http://localhost:*/*" }`. Існуючий `http://**` збережено для non-loopback HTTP. Компонент, що виконує запит: `app/src/components/AgentDialog.vue` (імпортує `fetch` з `@tauri-apps/plugin-http`). Перевірено: `cargo check`.

## Update 2026-06-15

Попередній фрагмент тієї самої сесії `005a85c1` (за 1 хвилину до основного запису): шаблони `{ "url": "http://127.0.0.1:*" }` і `{ "url": "http://localhost:*" }` застосовані в `capabilities/default.json`; існуючий `http://**` збережено для non-loopback HTTP. Семантика підтверджена: `urlpattern` Tauri трактує шаблон без явного порту як дозвіл лише на default-порт (80 для `http://`).
