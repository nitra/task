# Quasar iconSet передається як імпортований обʼєкт, не рядок

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

Після додавання `CreateTaskDialog.vue` з `q-select` у застосунок у WKWebView виникав краш реактивності Vue: `TypeError: undefined is not an object (evaluating '$q.iconSet.arrow.dropdown')`. Наслідок — усі кнопки переставали реагувати на кліки. Причина: у `app/src/main.js` поле `iconSet` передавалося рядком `'material-symbols-outlined'`, тоді як Quasar очікує обʼєкт із повним маппінгом іконок.

## Considered Options

- Передавати `iconSet` рядком (`'material-symbols-outlined'`)
- Імпортувати обʼєкт із `quasar/icon-set/material-symbols-outlined` і передавати його у `.use(Quasar, { iconSet })`
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Імпортувати обʼєкт iconSet", because Quasar звертається до `$q.iconSet.arrow.dropdown` та інших вкладених полів при рендері `q-select`; рядок як значення `$q.iconSet` не містить цих полів і дає `undefined`, що руйнує цикл оновлення Vue.

### Consequences

- Good, because transcript фіксує: після full-reload Vite лог показав 0 помилок `$q.iconSet` / `component.emitsOptions`; кнопки відновили реакцію на кліки; тести 36/36 ✓.
- Bad, because баг був латентним: до появи `q-select` жоден компонент не звертався до `$q.iconSet`, тому помилка не проявлялася раніше.
- Neutral, because паралельно виявлено і виправлено пов'язану проблему: `backdrop-filter: blur` на `q-header` у WKWebView поглинав pointer events — видалено з `App.vue`; симптоми були схожими (кнопки не реагують), але першопричини різні.

## More Information

Зміна в `app/src/main.js`: `import iconSet from 'quasar/icon-set/material-symbols-outlined'` замість рядка; обʼєкт передається у `.use(Quasar, { ..., iconSet })`. Симптом клікабельності важко відтворити в синтетичних тестах — `dispatchEvent` обходить WKWebView hit-testing, тому баг проявляється лише в живому застосунку.
