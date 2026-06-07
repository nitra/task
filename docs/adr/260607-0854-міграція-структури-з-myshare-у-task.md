---
session: 43607719-391b-42fd-8353-905e3494d931
captured: 2026-06-07T08:54:51+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/43607719-391b-42fd-8353-905e3494d931.jsonl
---

## ADR Міграція структури з `myshare` у `task`

## Context and Problem Statement
Новий проєкт `task` потребував стартового каркасу (Tauri 2 + Vue 3 + Quasar + Bun monorepo). Замість будувати структуру з нуля, власник взяв за основу вже працюючий проєкт `myshare`, відкинувши всю бізнес-логіку.

## Considered Options
* Перенести каркас із `myshare`, прибравши бізнес-логіку
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перенести каркас із `myshare`, прибравши бізнес-логіку", because `myshare` вже є перевіреним проєктом тієї самої технологічного стека і власник явно зазначив «перенеси з нього структуру без бізнес логіки, каркас у них буде схожий».

### Consequences
* Good, because transcript фіксує очікувану користь: готовий monorepo-скелет (22 файли) закомічено за одну сесію замість ручного налаштування.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Що включено: `package.json`, `bunfig.toml`, `.gitignore`, `eslint.config.js`, `knip.json`, `app/package.json`, `app/index.html`, `app/vite.config.js`, `app/jsconfig.json`, `app/vitest.config.js`, `app/src/main.js`, `app/src/App.vue`, `app/src/quasar-variables.sass`, `app/src/test-utils/quasar.js`, `app/src-tauri/` (мінімальний Cargo.toml без youtube/reqwest/tokio, `tauri.conf.json` з `identifier: com.nitra.task`).
Що виключено: `scripts/` workspace, stryker-конфіги, усі бізнес-модулі (`youtube.rs`, `ollama.js`, `shared-url.js`, `page-meta.js`, `url-history.js`, `translation-cache.js`).
Перший коміт: `a5ccaa6 feat: init project skeleton from myshare`.

---

## ADR Symlink-workaround для відсутнього `lib/` в `@nitra/cursor`

## Context and Problem Statement
`npx @nitra/cursor fix` падає з `Cannot find module '.../node_modules/@nitra/cursor/lib/models.mjs'`, оскільки `lib/` відсутня у `files` у `package.json` обох версій `3.29.0` і `4.0.0` опублікованого пакету. Source-репо (`/Users/vitaliytv/www/nitra/cursor/npm/lib/`) містить потрібний файл.

## Considered Options
* Створити symlink з local source `lib/` до встановленого пакету в `node_modules/@nitra/cursor/lib`
* Чекати на виправлення в npm publish
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Створити symlink з local source `lib/` до встановленого пакету в `node_modules/@nitra/cursor/lib`", because проблема у пакеті, а не у проєкті, тому лише local workaround дозволяє негайно продовжити роботу.

### Consequences
* Good, because transcript фіксує очікувану користь: `npx @nitra/cursor fix` запрацював після symlink.
* Bad, because symlink вказує на живий source-репо на машині розробника — зламається на іншому середовищі або після `bun install --reset`.

## More Information
Команда: `ln -s /Users/vitaliytv/www/nitra/cursor/npm/lib /Users/vitaliytv/www/nitra/task/node_modules/@nitra/cursor/lib`.
Корінь проблеми: поле `files` у `package.json` `@nitra/cursor` не містить `"lib"`, хоча `skills/fix/js/llm-worker.mjs:7` та `scripts/auto-skills.mjs` імпортують з `../../../lib/models.mjs` і `./lib/skill-meta.mjs`.
Довгострокове виправлення: додати `"lib"` до поля `files` у `npm/package.json` source-репо та перепублікувати.

---

## ADR Використання `.oxlintrc.json` з `myshare` замість canonical-конфігу

## Context and Problem Statement
`n-cursor fix` згенерував `.oxlintrc.json` з `"categories": { "correctness": "deny", "suspicious": "deny", ... }`, який спричиняв десятки помилок oxlint для стандартних Vite/Vitest/Vue-шаблонних файлів, зокрема `no-default-export` у конфіг-файлах та `filename-case` для Vue SFC.

## Considered Options
* Перезаписати `.oxlintrc.json` перевіреною конфігурацією з `myshare`
* Вручну виправляти кожне правило з generated canonical-конфігу
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Перезаписати `.oxlintrc.json` перевіреною конфігурацією з `myshare`", because `myshare` — це той самий технологічний стек і вже проходить lint clean, а canonical-конфіг із `@nitra/cursor` розрахований на source-репо пакету, а не на consuming-проєкти.

### Consequences
* Good, because transcript фіксує очікувану користь: `bunx oxlint .` повертає чистий результат після заміни.
* Bad, because Neutral, because transcript не містить підтвердження наслідку — майбутні оновлення правил `@nitra/cursor` не потраплять автоматично у `.oxlintrc.json`.

## More Information
Ключові відмінності: `myshare` використовує `"categories": {}` (пусто) і `"plugins": [..., "vue"]` замість суворого deny-all та відсутності vue-плагіна.
До конфігу `myshare` додані ігнори: `"app/src-tauri/target/**"`, `"app/src-tauri/gen/**"`, `"app/dist/**"`.
Два залишкові порушення `unicorn/catch-error-name` у `app/src/components/TaskGraph.vue` виправлені перейменуванням `e` → `error_`.
