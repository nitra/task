---
schema_version: 1
created_at: 2026-06-07T14:00:00Z
budget_sec: 3600
---
## Task

Розширити кнопку "Open in Editor" підтримкою **двох режимів**:

- **Local mode** — робоча директорія задачі вже є на локальному диску користувача; редактор відкривається напряму через URI `file://`.
- **Remote mode** — файли на k8s PVC; бекенд спавнить dev pod через Teleport SSH (як у `open-in-editor`).

Бекенд **не** вибирає режим автоматично: він повертає **список доступних режимів**, а користувач обирає сам. Якщо доступний лише один режим — вибір не показується. Якщо обидва — UI показує перемикач `Local / Remote` перед відкриттям редактора.

Підтримувані редактори:
- **VS Code** — `vscode://file/<path>` (local) / `vscode://vscode-remote/ssh-remote+<host>/tasks` (remote)
- **Cursor** — `cursor://file/<path>` (local) / `cursor://vscode-remote/ssh-remote+<host>/tasks` (remote)
- **Zed** — `zed:///<path>` (local) / копіювання hostname + підказка (remote)

## Done when

### Спільне (обидва режими)
- [ ] `GET /api/workspace/:task_id` повертає `{ available: ["local", "remote"] | ["local"] | ["remote"], … }`
- [ ] Якщо `available` містить обидва — UI показує перемикач `Local / Remote` (default: `local`)
- [ ] Якщо `available` містить лише один варіант — перемикач не рендериться, одразу відповідний UI
- [ ] Вибраний режим зберігається в `localStorage` per task-id і відновлюється при наступному відкритті
- [ ] Всі три редактори присутні в обох режимах

### Local mode
- [ ] Бекенд повертає `{ mode: "local", path: "/absolute/path/to/task/dir" }`
- [ ] VS Code і Cursor — `window.open("vscode://file/<encoded-path>")` / `window.open("cursor://file/<encoded-path>")`
- [ ] Zed — `window.open("zed:///<encoded-path>")` (якщо не спрацьовує — копіює path у буфер + підказка)
- [ ] Path передається URI-encoded (пробіли та спецсимволи екрановані)
- [ ] Якщо `path` не існує — UI показує помилку без спроби відкрити URI

### Remote mode
- [ ] Поведінка ідентична `open-in-editor`: POST `/api/workspace` → spawn pod → Teleport → URI deep link
- [ ] `GET /api/workspace/:task_id` після успішного spawn повертає `{ mode: "remote", host: "…", status: "ready" }`
- [ ] Статусна машина `spawning → ready` відображається в UI

## Inputs

### context
Бекенд повертає `available` на основі: task-node має `local_path` і директорія існує на хості → додає `"local"` до списку; k8s/Teleport доступний → додає `"remote"`. Обидва можуть бути присутні одночасно.

Типовий сценарій: розробник має локальний клон репо (`"local"` є), але хоче попрацювати на remote pod і потім зробити `git pull` локально. Він перемикається на `Remote`, UI спавнить pod — локальна директорія залишається незмінною.

Local path передається безпосередньо без додаткових мережевих з'єднань — браузер відкриває URI, ОС передає встановленому редактору.

Remote mode: архітектура Teleport + k8s PVC ідентична `open-in-editor`.

URI-протоколи редакторів:
- `vscode://file/…` — підтримується нативно починаючи з VS Code 1.82
- `cursor://file/…` — аналогічна підтримка в Cursor
- `zed:///…` — підтримується в Zed 0.145+

### constraints
- Бекенд: Bun/Node HTTP (або розширення існуючого `nitra/task` бекенду)
- `local_path` перевіряється на існування на стороні бекенду перед відповіддю клієнту
- Path не може виходити за межі дозволеного root-каталогу (path traversal guard)
- URI deep link відкривається через `window.open(uri)` — браузер передає встановленому редактору
- Якщо браузер блокує `window.open` (popup blocker) — показати кнопку-fallback з тим самим URI як `href`
