---
session: 6220396b-6750-408d-9018-b5153cdb0963
captured: 2026-06-16T07:17:43+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/6220396b-6750-408d-9018-b5153cdb0963.jsonl
---

Я бачу тільки `TaskGraph.vue` без лівої панелі. Можливо, проблема з `AgentDialog.vue` або іншим компонентом, що рендериться як drawer. Скажи коли будеш готовий до фіксу — подивимось разом.

---

Ось ADR з цієї сесії:

## ADR Локальний CSS-файл для Material Symbols шрифту замість пакетного шляху

## Context and Problem Statement
`@quasar/extras` оновлено до v2.0.0, яка перемістила всі asset-файли у підкаталог `exports/`. Стара точка входу `@quasar/extras/material-symbols-outlined/material-symbols-outlined.css` більше не існує, тому шрифт Material Symbols Outlined не завантажувався у Vite dev-режимі, і Quasar рендерив іконки `sym_o_*` як сирий текст (через незадіяні CSS-ліґатури).

## Considered Options
* Vite `resolve.alias` для перенаправлення старого CSS-шляху на новий
* Локальний CSS-файл із `@font-face`, що посилається на woff2 напряму через відносний шлях до `node_modules`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Локальний CSS-файл із `@font-face`", because Vite 8 може відхиляти CSS-підшляхи, не присутні в `exports`-карті пакету, тоді як прямий відносний шлях до `node_modules` вирішується надійно без жодних alias-хаків.

### Consequences
* Good, because Vite резолвить відносні URL у CSS-файлах без перевірки `exports`-мапи пакету — рішення стабільне при будь-яких змінах структури пакету.
* Bad, because при оновленні `@quasar/extras` потрібно вручну оновлювати URL woff2 у `app/src/material-symbols-outlined.css`, якщо ім'я файлу шрифту зміниться.

## More Information
- Новий файл: `app/src/material-symbols-outlined.css` — містить `@font-face` з посиланням на `../../node_modules/@quasar/extras/exports/material-symbols-outlined/web-font/*.woff2`
- `app/src/main.js`: змінено `import '@quasar/extras/material-symbols-outlined/material-symbols-outlined.css'` → `import './material-symbols-outlined.css'`
- Пакет `@quasar/extras` v2.0.0: CSS і woff2 знаходяться в `exports/material-symbols-outlined/`, але у `package.json#exports`-полі немає відповідного CSS-запису
- `app/vite.config.js`: тимчасово доданий `resolve.alias` було видалено після вибору фінального рішення
