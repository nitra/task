---
session: 5a27ef2b-566f-45fb-9a11-25dbbc20b542
captured: 2026-06-18T10:12:51+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/5a27ef2b-566f-45fb-9a11-25dbbc20b542.jsonl
---

## ADR Інверсія каталогу в `createAgentKit`

## Context and Problem Statement

Агентний рушій у `task` мав каталог інструментів (`TOOLS`) як статичний імпорт-сінглтон усередині модулів `dispatch.js`, `manifest.js`, `scope.js`. Це унеможливлювало витягнення рушія в спільний пакет `@7n/tauri-components`: кожен споживач (`task`, `mlmail`, `myshare`) має власний каталог.

## Considered Options

* Передавати `catalog` параметром у кожну функцію рушія (інверсія каталогу)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Передавати `catalog` параметром у кожну функцію рушія", because функції `createDispatch`, `listTools`, `toolManifest`, `classify`, `scopedManifest`, `scopedToolNames` тепер приймають `catalog` першим аргументом; фасадний `createAgentKit({ catalog, systemPrompt, transport, journal, actorTiers, grounding })` є єдиним seam інтеграції для споживача.

### Consequences

* Good, because transcript фіксує очікувану користь: пакет можна підключити у будь-якому Tauri-додатку з власним каталогом без зміни коду рушія.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* `npm/src/core/{tools,dispatch,manifest,scope,agent-kit}.js` у репо `nitra/tauri-components`
* Тести `agent-kit.test.js` (14 pass) охоплюють сценарії request→done, approval, reject, grounding-ін'єкцію в промпт
* Тонка обгортка в `task`: `app/src/composables/use-agent.js` — 5 рядків, підставляє локальний `TOOLS` і `createSystemPrompt`

---

## ADR Один npm-пакет зі subpath-exports для спільного агентного шару

## Context and Problem Statement

Три Tauri-додатки (`task`, `mlmail`, `myshare`) дублювали один і той самий agentний рушій + Vue/Quasar UI. Потрібна спільна одиниця розповсюдження.

## Considered Options

* Один пакет `@7n/tauri-components` із subpath-exports `.` / `./vue` / `./components`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Один пакет `@7n/tauri-components` із subpath-exports", because це дозволяє споживачу вибирати лише потрібний шар (headless-core без Vue, Vue без компонентів Quasar) і не тягнути peer-deps Vue/Quasar туди, де вони не потрібні.

### Consequences

* Good, because transcript фіксує очікувану користь: peer-deps (`vue`, `quasar`, `@tauri-apps/*`) залишаються у споживача — немає дублювання інстансу Vue.
* Good, because `marked` оголошено у `dependencies` з `knip.ignoreDependencies` як свідомий компроміс: безпечний markdown-рендер у Tauri-webview вимагає санітайзера (вектор XSS через output LLM → Tauri IPC), тому підключається окремо.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* `npm/package.json` у репо `nitra/tauri-components`: `exports`, `files`-whitelist з негативними glob на тести, `publishConfig.access = "public"`
* Опубліковано через OIDC trusted publishing на `@7n/tauri-components@0.3.0`

---

## ADR OIDC trusted publishing для npm-пакета

## Context and Problem Statement

Репозиторій `nitra/tauri-components` потребував автоматичної публікації `@7n/tauri-components` на npm при push у `main`, але без збереження довготривалого `NPM_TOKEN` у секретах GitHub.

## Considered Options

* OIDC trusted publishing (GitHub Actions → npm registry) із sigstore-provenance
* `NPM_TOKEN` у GitHub Secrets
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "OIDC trusted publishing із sigstore-provenance", because `NPM_TOKEN` відсутній у секретах — CI успішно публікував через OIDC (підтверджено 4× в рамках сесії: версії `0.1.1`, `0.2.0`, `0.3.0`).

### Consequences

* Good, because transcript фіксує очікувану користь: кожна публікація отримує sigstore-provenance (`npm view @7n/tauri-components dist.integrity` підтвердив).
* Bad, because перший прогін впав через відсутнє поле `repository.url` у `package.json` — provenance потребує його для валідації; виправлено у `0.1.1`.

## More Information

* `.github/workflows/npm-publish.yml` у репо `nitra/tauri-components`
* Крок `Release` виконує `n-cursor release` (bump + CHANGELOG + git-tag + commit-back)
* Виправлення: `npm/package.json` додано `repository.url = "git+https://github.com/nitra/tauri-components.git"`

---

## ADR `journal.rs` залишається в `task` для MCP-оркестратора

## Context and Problem Statement

Після витягнення `tauri-plugin-agent`, який реєструє `journal_*` як Tauri-команди для webview, у `task` є ще standalone-бінар `bin/journal.rs`, який спавниться Node MCP-оркестратором (`bin/task.mjs`) для доступу до файлового журналу поза контекстом Tauri GUI.

## Considered Options

* Залишити `journal.rs` у `task` для standalone-бінара; плагін обслуговує лише webview
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Залишити `journal.rs` у `task` для standalone-бінара", because node MCP-шлях потребує прямого Rust-бінара (без Tauri-runtime), тоді як плагін реєструє команди виключно через Tauri IPC. Обидва розв'язують один і той самий файловий журнал.

### Consequences

* Good, because transcript фіксує очікувану користь: MCP CLI (`bin/task.mjs`) продовжує працювати без Tauri-runtime через `createNodeJournalStore`.
* Bad, because логіка журналу існує в двох місцях (`tauri-plugin-agent/src/journal.rs` і `task/app/src-tauri/src/journal.rs`) — розбіжності треба синхронізувати вручну.

## More Information

* `task/app/src-tauri/src/journal.rs` — залишається
* `task/app/src/tool/journal-store-node.js` — залишається; спавнить Rust-бінар через `spawnSync`
* `tauri-plugin-agent/src/journal.rs` — дублює логіку для webview-шляху

---

## ADR Git-залежність для `tauri-plugin-agent` у Cargo.toml

## Context and Problem Statement

Rust-кrейт `tauri-plugin-agent` живе у репозиторії `nitra/tauri-components`, окремому від Tauri-додатків. Необхідно вказати, як споживачі (`task`, `mlmail`, `myshare`) посилаються на нього в `Cargo.toml`.

## Considered Options

* Git-залежність: `tauri-plugin-agent = { git = "https://github.com/nitra/tauri-components", ... }`
* Path-залежність: `{ path = "../../../tauri-components/tauri-plugin-agent" }`

## Decision Outcome

Chosen option: "Git-залежність", because user явно обрав git (`рішення 3 — git`) замість path; path прив'язує build до конкретного розташування чекаута на файловій системі й не працює в CI.

### Consequences

* Good, because transcript фіксує очікувану користь: `cargo check` у CI підтягує плагін напряму з GitHub без додаткових кроків налаштування.
* Bad, because для локальної розробки зміна плагіна потребує push у `nitra/tauri-components` перед тим, як `task` зможе її підхопити (на відміну від path-залежності).

## More Information

* `task/app/src-tauri/Cargo.toml`: `tauri-plugin-agent = { git = "https://github.com/nitra/tauri-components", tag = "..." }`
* `cargo tree` підтвердив: `├── tauri-plugin-agent v0.1.0 (https://github.com/nitra/tauri-components#15a41271)`
* `cargo clippy --all-targets` пройшов чисто після підключення
