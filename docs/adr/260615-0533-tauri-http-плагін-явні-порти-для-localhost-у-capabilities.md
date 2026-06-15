---
session: 005a85c1-1524-4ddb-aece-77409f4a82d1
captured: 2026-06-15T05:33:24+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/005a85c1-1524-4ddb-aece-77409f4a82d1.jsonl
---

## ADR Tauri HTTP-плагін: явні порти для localhost у capabilities

## Context and Problem Statement
Запит від фронтенду (через `@tauri-apps/plugin-http`) до локального LLM-сервера на `http://127.0.0.1:8000/v1/chat/completions` отримував відмову Tauri scope-перевірки, хоча в `app/src-tauri/capabilities/default.json` вже стояло дозвільне правило `{ "url": "http://**" }`. Причина: Tauri URL-pattern matcher (реалізація `urlpattern`) трактує шаблон без явного порту як дозвіл лише на порт за замовчуванням (80 для `http://`), тому нестандартний порт `:8000` ніколи не збігався з цим шаблоном.

## Considered Options
* Залишити `http://**` і сподіватися, що він покриє будь-який порт (не спрацьовує через семантику `urlpattern`)
* Додати явні шаблони з `host:port/*` для `localhost` і `127.0.0.1` з wildcard-портом `:*`

## Decision Outcome
Chosen option: "Явні шаблони з wildcard-портом `:*` для localhost і 127.0.0.1", because в transcript підтверджено: `http://**` не матчить `http://127.0.0.1:8000` через семантику `urlpattern`, і єдиний спосіб дозволити нестандартні порти — вказати `host:*/*` явно.

### Consequences
* Good, because запит до `http://127.0.0.1:8000/v1/chat/completions` тепер проходить Tauri scope-перевірку — transcript фіксує очікувану користь: "the scope is fixed (the request now reaches the server)".
* Bad, because capabilities компілюються у бінарник під час build, тому зміна набирає чинності лише після перезапуску `tauri dev` / rebuild — гаряче перезавантаження фронтенду недостатнє.

## More Information
Змінений файл: `app/src-tauri/capabilities/default.json` — блок `http:default` → `allow`, додано шаблони для `http://127.0.0.1:*/*` та `http://localhost:*/*`.
Виклик HTTP у фронтенді: `app/src/components/AgentDialog.vue` використовує `fetch` з `@tauri-apps/plugin-http`.
Після виправлення scope нова помилка — `401 API key required` від omlx-сервера, тобто scope-проблема відокремлена від auth-проблеми і вирішена повністю.
