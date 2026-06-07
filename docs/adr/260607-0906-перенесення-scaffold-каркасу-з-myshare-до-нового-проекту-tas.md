---
session: 43607719-391b-42fd-8353-905e3494d931
captured: 2026-06-07T09:06:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/43607719-391b-42fd-8353-905e3494d931.jsonl
---

## ADR Перенесення scaffold-каркасу з `myshare` до нового проекту `task`

## Context and Problem Statement
Новий репозиторій `task` (Tauri + Vue 3 + Quasar, bun monorepo) потрібно було налаштувати з нуля. Замість ручного написання всіх конфіг-файлів вирішено перенести перевірений scaffold із наявного проекту `myshare`, видаливши бізнес-логіку та адаптувавши ідентифікатори.

## Considered Options
* Перенести структуру з `myshare`, замінивши бізнес-модулі чистим skeleton-кодом
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести структуру з `myshare`, замінивши бізнес-модулі чистим skeleton-кодом", because так зберігається вся перевірена конфігурація (Vite, Quasar, Tauri, toolchain) без YouTube/Ollama/shared-url-логіки, яка не потрібна новому проекту.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor fix` проходить 15/15 правил після адаптації; Vite dev server стартує і повертає HTTP 200; базовий `q-layout` рендериться без помилок.
* Bad, because `@nitra/cursor@3.29.0` і `4.0.0` обидві не містять `lib/` у npm-тарболі — довелося додати symlink `node_modules/@nitra/cursor/lib → /nitra/cursor/npm/lib` як локальний workaround; баг у пакеті не закритий.

## More Information
* Файли-джерела: `/Users/vitaliytv/www/vitaliytv/myshare/` (root + `app/` workspace)
* Що перенесено: `package.json`, `bunfig.toml`, `.gitignore`, `eslint.config.js`, `knip.json`, `app/vite.config.js`, `app/jsconfig.json`, `app/vitest.config.js`, `app/src/main.js`, `app/src/App.vue`, `app/src/quasar-variables.sass`, `app/src/test-utils/quasar.js`, `app/src-tauri/` skeleton
* Що адаптовано: `productName → task`, `identifier → com.nitra.task`, `Cargo.toml name → task`, `lib.rs` — без `invoke_handler` команд; видалено dep `@tauri-apps/plugin-http` (не використовується)
* Що не перенесено: `scripts/` workspace, stryker config, всі бізнес-модулі (`youtube`, `ollama`, `shared-url`, `page-meta`, `translation-cache`, `url-history`)
* Коміти: `a5ccaa6` (init scaffold), `d2b8b70` (apply n-cursor fix — 56 файлів конфігурації)
* Workaround для `@nitra/cursor lib/`: `ln -s /Users/vitaliytv/www/nitra/cursor/npm/lib node_modules/@nitra/cursor/lib`
