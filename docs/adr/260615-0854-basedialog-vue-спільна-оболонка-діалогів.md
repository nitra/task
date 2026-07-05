# BaseDialog.vue — спільна оболонка діалогів

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

jscpd виявив клон між `AgentDialog.vue` і `CreateTaskDialog.vue`: обидва містили ідентичний каркас `q-dialog` + `q-card` + секція заголовка. Клон порушував правило про відсутність дублювання коду.

## Considered Options

- Додати `// jscpd:ignore-start` / `// jscpd:ignore-end` навколо клону
- Винести спільний каркас у новий компонент `BaseDialog.vue`
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Винести спільний каркас у `BaseDialog.vue`", because правило вимагає коректного рефактору, а не обходу інструменту: ignore-коментар приховує проблему, а не вирішує її.

### Consequences

- Good, because transcript фіксує: jscpd-клон зник, `lint-js exit: 0`, тести 34/34 ✓, `bun run build` ✓.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Новий файл: `app/src/components/BaseDialog.vue`. Перероблені компоненти: `app/src/components/AgentDialog.vue`, `app/src/components/CreateTaskDialog.vue`. Перевірки: `bun run lint-style`, `bun run lint-js`, `bun run build`, `bun run test`.
