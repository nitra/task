---
session: 9618a1dd-1e1d-451e-a585-9707e0d4a659
captured: 2026-06-07T07:10:41+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/9618a1dd-1e1d-451e-a585-9707e0d4a659.jsonl
---

## ADR Двохрежимне відкриття редактора: local vs remote

## Context and Problem Statement
В `tasks/open-in-editor/task.md` вже описано механізм відкриття редактора через SSH/Teleport з k8s dev pod. Виникла потреба підтримати також сценарій, коли файли задачі вже присутні локально на машині розробника — у цьому разі спавнити pod і прокидати SSH зайве.

## Considered Options
* Єдиний режим з умовним флоу всередині існуючої задачі
* Окрема задача `tasks/open-in-editor-local/task.md` з явним двохрежимним API (`local` / `remote`)

## Decision Outcome
Chosen option: "Окрема задача `tasks/open-in-editor-local/task.md` з явним двохрежимним API", because бекенд визначає режим автоматично — наявність поля `localPath` у `TaskNode` означає `local mode`, відсутність — `remote mode`; це дозволяє не змінювати існуючий remote-флоу і додати новий незалежно.

### Consequences
* Good, because local mode не потребує k8s pod, SSH і Teleport — відкриття відбувається через URI-схему редактора (`vscode://file/<path>`, `cursor://file/<path>`, `zed:///<path>`), що значно простіше.
* Good, because remote mode залишається незмінним (той самий флоу що в `open-in-editor`), backward compatibility збережено.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Новий файл: `tasks/open-in-editor-local/task.md`
- Новий endpoint: `GET /tasks/:id/editor-url` — повертає `{ mode: "local"|"remote", url: string }`
- `TaskNode` розширюється полем `localPath` (опціональне); його наявність є єдиним критерієм вибору режиму
- URI-схеми: `vscode://file/<path>`, `cursor://file/<path>`, `zed:///<path>`
- Безпека: path traversal guard + URI encoding на бекенді; fallback у UI при popup blocker
- Референсна задача: `tasks/open-in-editor/task.md`
