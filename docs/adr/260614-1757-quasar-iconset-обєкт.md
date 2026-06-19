# Quasar iconSet має передаватись обʼєктом, не рядком

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Після додавання першого `q-select` у `CreateTaskDialog.vue` усі кнопки застосунку переставали реагувати на кліки. Налагодження показало, що `$q.iconSet.arrow.dropdown` викидає `TypeError` при рендері `q-select`, що ламає Vue-цикл реактивності й призводить до втрати всіх обробників кліків.

## Considered Options

- Передати `iconSet` рядком `'material-symbols-outlined'` (початковий підхід у `main.js`)
- Передати `iconSet` імпортованим обʼєктом з `quasar/icon-set/material-symbols-outlined.js`

## Decision Outcome

Chosen option: "Передати `iconSet` імпортованим обʼєктом", because Quasar звертається до `$q.iconSet.arrow.dropdown` (властивість обʼєкта) при рендері компонентів з іконками вибору; рядок не має цієї властивості → `TypeError` → Vue ламає цикл реактивності → втрата всіх обробників кліків.

### Consequences

- Good, because після виправлення Vite зафіксував 0 помилок після full reload; кнопки відновили реакцію на кліки.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because симптом проявлявся лише при рендері першого `q-select` у сесії — `q-btn` самостійно не тригерив баг; баг приховувався відсутністю `q-select` до додавання `CreateTaskDialog`.

## More Information

Файл: `app/src/main.js`. До виправлення: `iconSet: 'material-symbols-outlined'`. Після: `import materialSymbolsOutlined from 'quasar/icon-set/material-symbols-outlined.js'` + `iconSet: materialSymbolsOutlined`.
