# `iconSet` Quasar — передавати об'єктом, не рядком

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

Після додавання першого `q-select` у `CreateTaskDialog.vue` усі кнопки застосунку переставали реагувати на кліки. Налагодження показало, що `$q.iconSet.arrow.dropdown` викидає `TypeError` при рендері `q-select`: Quasar звертається до цієї властивості як до поля об'єкта, а не рядка — рядок не має такої властивості, Vue ламає цикл реактивності й усі обробники кліків губляться.

## Considered Options

- Передати `iconSet` рядком `'material-symbols-outlined'` — початковий підхід у `main.js`.
- Передати `iconSet` імпортованим об'єктом з `quasar/icon-set/material-symbols-outlined.js`.

## Decision Outcome

Chosen option: "Передати `iconSet` імпортованим об'єктом", because Quasar звертається до `$q.iconSet.arrow.dropdown` (властивість об'єкта) при рендері компонентів з іконками вибору; рядок не має цієї властивості → `TypeError` → Vue ламає цикл реактивності → втрата всіх обробників кліків.

### Consequences

- Good, because після виправлення у лозі Vite зафіксовано 0 помилок після full reload; кнопки відновили реакцію на кліки.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because симптом виявляється лише при рендері першого `q-select` у сесії; `q-btn` самостійно баг не тригерить — він може бути прихований у проєктах без `q-select`.

## More Information

Файл: `app/src/main.js`. До виправлення: `iconSet: 'material-symbols-outlined'`. Після: `import materialSymbolsOutlined from 'quasar/icon-set/material-symbols-outlined.js'` + `iconSet: materialSymbolsOutlined`. Баг був прихований відсутністю `q-select` до появи `CreateTaskDialog`.
