---
created_at: 2026-06-07T12:30:00Z
budget_sec: 3600
---
## Task

Реалізувати кнопку "Open in Editor" у UI перегляду задач (`nitra/task`).

При натисканні — бекенд спавнить dev pod у k8s, монтує `tasks-pvc`, реєструє pod у Teleport, повертає SSH connection string. Розробник підключається через обраний редактор.

Підтримувані редактори:
- **VS Code** — URI deep link `vscode://vscode-remote/ssh-remote+<host>/tasks`
- **Cursor** — URI deep link `cursor://vscode-remote/ssh-remote+<host>/tasks`
- **Zed** — копіювання hostname у буфер + інструкція (URI-протоколу немає)

## Done when

- [ ] UI показує три варіанти підключення: VS Code, Cursor, Zed
- [ ] VS Code і Cursor відкриваються кліком (URI deep link через `window.open`)
- [ ] Zed: копіює hostname у буфер + показує підказку з кроками
- [ ] Натискання відправляє POST `/api/workspace` з `{ task_node: "<id>" }`
- [ ] Бекенд перевіряє права доступу до task-node (middleware auth)
- [ ] Бекенд робить `kubectl apply` dev pod з labels `task=<id>`, `owner=<email>`
- [ ] Pod монтує `tasks-pvc` у `/tasks` (read-write)
- [ ] Teleport node-agent у поді реєструється автоматично після Ready
- [ ] Бекенд повертає `{ host: "<id>.teleport.nitra.com", status: "ready" }` коли pod Ready
- [ ] UI показує статус (`spawning` → `ready`) перед тим як відкрити URI
- [ ] Lifecycle: pod auto-shutdown після N хвилин без активної SSH-сесії (configurable)
- [ ] При переході task-node у стан `resolved` — UI попереджає що pod буде видалено

## Inputs

### context
Архітектура доступу: Teleport Auth+Proxy у k8s, SSO через GitHub/Google.
Dev pod монтує той самий `tasks-pvc` що і worker-поди з `n-cursor graph`.
Lifecycle: spawn on demand → grace period після закриття SSH → auto-delete.

VS Code і Cursor використовують однаковий URI-формат (`vscode-remote` протокол).
Всі три редактори використовують `~/.ssh/config` з `ProxyCommand tsh proxy ssh`.

### constraints
- Бекенд: Bun/Node HTTP (або розширення існуючого `nitra/task` бекенду)
- Розробник не має прямого доступу до kubectl або k8s API
- Teleport Operator керує реєстрацією нод декларативно через CRD
- URI deep link відкривається через `window.open(uri)` — браузер передає встановленому редактору
