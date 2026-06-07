---
session: 9618a1dd-1e1d-451e-a585-9707e0d4a659
captured: 2026-06-07T07:17:58+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/9618a1dd-1e1d-451e-a585-9707e0d4a659.jsonl
---

Based on the session transcript, here is the decision documentation:

## ADR Підтримка двох режимів відкриття редактора (local / remote)

## Context and Problem Statement
Існуюча задача `tasks/open-in-editor/` реалізує лише remote-режим (k8s dev pod через Teleport SSH). Потрібно розширити механізм "Open in Editor" так, щоб він підтримував і локальні файли. Окрема проблема: користувач може мати директорію задачі **і** локально, **і** хотіти відкрити її remote — тому режим не може визначатися автоматично бекендом.

## Considered Options
* Бекенд автоматично визначає режим за наявністю `local_path` у task-node
* Бекенд повертає список доступних режимів, користувач обирає сам

## Decision Outcome
Chosen option: "Бекенд повертає список доступних режимів, користувач обирає сам", because коли файли є і локально, і remote-доступ теж можливий, автовибір некоректний — потрібен явний вибір з боку користувача, а після remote-роботи синхронізація відбувається через `git pull`.

### Consequences
* Good, because покривається сценарій "є локально, але йду в remote" без зміни логіки визначення доступності.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Нова задача: `tasks/open-in-editor-local/task.md`
- Оригінальна задача: `tasks/open-in-editor/task.md`
- `GET /api/workspace/:task_id` повертає `{ available: ["local", "remote"], … }` замість `{ mode: "local" | "remote", … }`
- Local mode URI-схеми: `vscode://file/<path>`, `cursor://file/<path>`, `zed:///<path>`
- Вибір режиму зберігається в `localStorage`
- Захист: path traversal guard, URI encoding, fallback при popup blocker
