---
created_at: 2026-06-07T12:30:00Z
budget_sec: 3600
---
## Task

Реалізувати кнопку "Open in Zed" у UI перегляду задач (`nitra/task`).

При натисканні — бекенд спавнить dev pod у k8s, монтує `tasks-pvc`, реєструє pod у Teleport, повертає SSH connection string. Розробник підключається через Zed Remote.

## Done when

- [ ] Кнопка "Open in Zed" присутня на сторінці кожного task-node
- [ ] Натискання відправляє POST `/api/workspace` з `{ task_node: "<id>" }`
- [ ] Бекенд перевіряє права доступу до task-node (middleware auth)
- [ ] Бекенд робить `kubectl apply` dev pod з labels `task=<id>`, `owner=<email>`
- [ ] Pod монтує `tasks-pvc` у `/tasks` (read-write)
- [ ] Teleport node-agent у поді реєструється автоматично після Ready
- [ ] Бекенд повертає `{ host: "<id>.teleport.nitra.com", status: "ready" }` коли pod Ready
- [ ] UI показує connection string і статус (`spawning` → `ready` → `connected`)
- [ ] Lifecycle: pod auto-shutdown після N хвилин без активної SSH-сесії (configurable)
- [ ] При переході task-node у стан `resolved` — UI попереджає що pod буде видалено

## Inputs

### context
Архітектура доступу: Teleport Auth+Proxy у k8s, SSO через GitHub/Google.
Dev pod монтує той самий `tasks-pvc` що і worker-поди з `n-cursor graph`.
Lifecycle: spawn on demand → grace period після закриття SSH → auto-delete.

### constraints
- Бекенд: Bun/Node HTTP (або розширення існуючого `nitra/task` бекенду)
- Zed підключається через `~/.ssh/config` з `ProxyCommand tsh proxy ssh`
- Розробник не має прямого доступу до kubectl або k8s API
- Teleport Operator керує реєстрацією нод декларативно через CRD
