# MT — формат задач

Специфікація: [`node_modules/@7n/mt/docs/mt.md`](../node_modules/@7n/mt/docs/mt.md)

Пакет: `@7n/mt`

## Ключові точки

- Задачі живуть у `mt/<node-id>/task.md`
- Стан вузла derived із файлів: `a.md` (агент) / `h.md` (людина) / `fact_*.md` (resolved) тощо
- `schema_version: 1` — перше поле у кожному YAML-фронтматері
- `deps/<dep-node-id>.md` — залежності (без читання вмісту)
- Worktrees: `.worktrees/<node>-<epoch>/`

## Конфіг проекту

`.mt.json` у корені репо.
