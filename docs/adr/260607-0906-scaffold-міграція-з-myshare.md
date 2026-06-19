# Перенесення scaffold-каркасу з myshare до нового проекту task

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Новий репозиторій `task` (Tauri + Vue 3 + Quasar, bun monorepo) потрібно було налаштувати з нуля. Замість ручного написання всіх конфіг-файлів вирішено перенести перевірений scaffold із наявного проекту `myshare`, видаливши бізнес-логіку та адаптувавши ідентифікатори.

## Considered Options

* Перенести структуру з `myshare`, замінивши бізнес-модулі чистим skeleton-кодом
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Перенести структуру з `myshare`, замінивши бізнес-модулі чистим skeleton-кодом", because `myshare` вже є перевіреним проєктом тієї самої технологічного стека і власник явно зазначив «перенеси з нього структуру без бізнес логіки, каркас у них буде схожий».

### Consequences

* Good, because готовий monorepo-скелет закомічено за одну сесію; `npx @nitra/cursor fix` проходить 15/15 правил після адаптації; Vite dev server стартує і повертає HTTP 200; базовий `q-layout` рендериться без помилок.
* Bad, because `@nitra/cursor@3.29.0` і `4.0.0` обидві не містять `lib/` у npm-тарболі — потрібний symlink як локальний workaround.

## More Information

* Файли-джерела: `/Users/vitaliytv/www/vitaliytv/myshare/` (root + `app/` workspace)
* Що перенесено: `package.json`, `bunfig.toml`, `.gitignore`, `eslint.config.js`, `knip.json`, `app/package.json`, `app/index.html`, `app/vite.config.js`, `app/jsconfig.json`, `app/vitest.config.js`, `app/src/main.js`, `app/src/App.vue`, `app/src/quasar-variables.sass`, `app/src/test-utils/quasar.js`, `app/src-tauri/` skeleton
* Що адаптовано: `productName → task`, `identifier → com.nitra.task`, `Cargo.toml name → task`, `lib.rs` без команд у `invoke_handler`; видалено dep `@tauri-apps/plugin-http`
* Що не перенесено: `scripts/` workspace, stryker config, бізнес-модулі (`youtube`, `ollama`, `shared-url`, `page-meta`, `translation-cache`, `url-history`)
* Коміти: `a5ccaa6` (init scaffold), `d2b8b70` (apply n-cursor fix — 56 файлів конфігурації)

## Update 2026-06-07

### Symlink-workaround для відсутнього `lib/` у `@nitra/cursor`

Рішення: `ln -s /Users/vitaliytv/www/nitra/cursor/npm/lib node_modules/@nitra/cursor/lib`.

`npx @nitra/cursor fix` падав з `Cannot find module '…/node_modules/@nitra/cursor/lib/models.mjs'`. Директорія `lib/` відсутня в опублікованому tarball як `@nitra/cursor@3.29.0`, так і `@nitra/cursor@4.0.0` — поле `files` у `package.json` пакету не включало `"lib"`. Оновлення до v4.0.0 не вирішило проблему.

Файл, що бракував: `lib/models.mjs` — імпортується з `skills/fix/js/llm-worker.mjs:7` та `scripts/coverage-fix.mjs`. Symlink не survives `bun install --clean`. Довгострокове виправлення: додати `"lib"` до поля `files` у `npm/package.json` source-репо та перепублікувати.

### Конфігурація `.oxlintrc.json` за зразком myshare

Рішення: використати конфігурацію myshare (`"categories": {}`, вибіркові `rules`).

`npx @nitra/cursor fix` генерував canonical config з усіма категоріями `"deny"`, що спричинило каскадні oxlint-помилки: `no-default-export` у `vite.config.js`/`vitest.config.js`, `unicorn/filename-case` у `App.vue`, `import/unambiguous` у `vite-env.d.ts`. Canonical config із `@nitra/cursor` розрахований на source-репо пакету, а не на consuming-проєкти.

Ключова різниця: `"categories": {}` замість `"correctness":"deny","suspicious":"deny","pedantic":"warn"`; плагін `"vue"` доданий до `plugins`; додані `ignorePatterns`: `"app/src-tauri/target/**"`, `"app/src-tauri/gen/**"`, `"app/dist/**"`. Виправлення: `catch (e)` → `catch (error_)` (правило `unicorn/catch-error-name`) у `TaskGraph.vue`. Файл: `.oxlintrc.json`.
