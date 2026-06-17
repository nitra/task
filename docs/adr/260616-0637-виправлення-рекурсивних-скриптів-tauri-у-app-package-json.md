---
session: 6220396b-6750-408d-9018-b5153cdb0963
captured: 2026-06-16T06:37:33+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/6220396b-6750-408d-9018-b5153cdb0963.jsonl
---

## ADR Виправлення рекурсивних скриптів `tauri` у `app/package.json`

## Context and Problem Statement
Команда `bun run start` завершувалась помилкою `ENOENT: Could not change directory to "app"`. Кореневий `package.json` виконує `bun --cwd=app run tauri dev`, що активує скрипт `tauri` у `app/package.json`. Цей скрипт містив `bun --cwd=app run tauri` — тобто знову намагався зайти в `app/app/`, якого не існує.

## Considered Options
* Виправити скрипт `tauri` в `app/package.json`, щоб він викликав бінарник напряму
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Виправити скрипт `tauri` в `app/package.json`, щоб він викликав бінарник напряму", because бінарник `tauri` хоїститься до кореневого `node_modules/.bin/` через bun workspaces і доступний у PATH під час виконання будь-якого скрипта монорепо. Скрипт `"tauri": "bun --cwd=app run tauri"` створював нескінченну рекурсію. Виправлення: `"tauri": "tauri"`.

### Consequences
* Good, because `bun run start` запустив `tauri dev` і повернув очікуваний dev-сервер.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Файл: `app/package.json`, скрипти `tauri` і `android`. Бінарник знаходиться в `node_modules/.bin/tauri` (кореневий рівень монорепо).

---

## ADR Vite resolve alias для CSS `@quasar/extras` v2.0.0

## Context and Problem Statement
Після оновлення `@quasar/extras` до v2.0.0 іконки Material Symbols Outlined відображалися як текст (наприклад, `person_off`, `history`) замість графічних символів. Пакет переніс усі файли до підкаталогу `exports/`, але не задекларував CSS у полі `exports` `package.json` — стара точка імпорту `@quasar/extras/material-symbols-outlined/material-symbols-outlined.css` (використана в `app/src/main.js`) перестала існувати.

## Considered Options
* Додати Vite `resolve.alias`, що перенаправляє стару CSS-адресу до нового шляху в `exports/`
* Перейти на SVG-іконки (новий підхід v2.0.0: іменовані імпорти + `quasar/icon-set/svg-material-symbols-outlined`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати Vite `resolve.alias`, що перенаправляє стару CSS-адресу до нового шляху в `exports/`", because підхід мінімально інвазивний — жоден Vue-файл і жодна рядкова посилання на іконку не змінюються. SVG-міграція потребувала б рефакторингу кожного використання `icon="sym_o_…"` у всіх компонентах.

### Consequences
* Good, because весь наявний код з рядковими іменами іконок (наприклад, `sym_o_history`, `sym_o_person_off`) продовжує працювати без змін.
* Bad, because рішення прив'язує alias до внутрішньої структури `exports/` пакету `@quasar/extras`, яка не є частиною публічного API і може змінитися в наступних мінорних оновленнях.

## More Information
Файли: `app/vite.config.js` (додано `resolve.alias`), `app/src/main.js` (імпорт залишається без змін). CSS-файл реально існує за шляхом `node_modules/@quasar/extras/exports/material-symbols-outlined/material-symbols-outlined.css`. Версія `@quasar/extras`: 2.0.0; версія Vite: 8.0.16. Альтернативний шлях — `quasar/icon-set/svg-material-symbols-outlined` для повного переходу на SVG-іконки.
