# delta

Референс-реалізація фреймворку «Дельта» — спека
[`docs/specs/260809-delta-app.md`](../docs/specs/260809-delta-app.md). Одиниця інтерфейсу — **мандат**, не задача
(`app`) і не рішення в черзі (`owner`): застосунок показує межу твоїх повноважень, деривовану з `.mt/mandates.yaml`
(схема — mt: `docs/architecture/mandates.md`).

## M0 — скелет + карта мандатів read-only

Поточний мілстоун (демо-критерій: відкрити застосунок двом користувачам — кожен бачить свій зріз; `delta
mandates_show` дає те саме в CLI):

- Tauri 2 + Vue 3 + Quasar скаффолд (порт 1440, `com.nitra.delta`, акцент teal).
- Мок-парсер `.mt/mandates.yaml` (`src/mandates.js`) за контрактом mt — читання, нормалізація, деривації: мій
  мандат за handle, ланцюг ескалації, ШІ-мандати (`kind: model`). Буде замінений napi-викликами mandate-crate з
  mt-rust, коли контракт (M6 фаза 0) зафіксується в специфікації `@7n/mt`.
- Ідентичність (handle) і шлях до воркспейсу — локальний конфіг застосунку (PII поза git), той самий підхід, що
  `owner` (whoami/set_identity).
- UI «Карта мандатів»: мій мандат (підсвічений), ШІ-мандати окремою секцією, уся карта, ланцюг ескалації,
  доброзичливий empty state з поясненням формату — read-only, без редагування.
- CLI-паритет: `bin/delta.mjs` з tools `whoami`, `set_identity`, `mandates_dir`, `set_mandates_dir`,
  `mandates_show` — той самий каталог (`src/tool/catalog.js`) і той самий мок-парсер, що GUI.

## Розробка

```bash
bun install
bun run --cwd=delta dev              # vite dev-сервер (без Tauri-вікна)
bun run tauri dev --config src-tauri/tauri.conf.dev.json   # у delta/: повне Tauri-вікно
bun run --cwd=delta test             # vitest (мок-парсер, онбординг)
cargo test --manifest-path delta/src-tauri/Cargo.toml       # Rust-бекенд
```

## CLI

```bash
cd delta
bun bin/delta.mjs list                                            # каталог tools
bun bin/delta.mjs whoami
bun bin/delta.mjs set_identity '{"handle":"olena"}'
bun bin/delta.mjs set_mandates_dir '{"dir":"/абсолютний/шлях/до/воркспейсу"}'
bun bin/delta.mjs mandates_show '{"mandatesDir":"/абсолютний/шлях","handle":"olena"}'
```

`mandates_show` без явних `mandatesDir`/`handle` бере їх з локального конфігу (той самий, що читає GUI) —
зручно для інтерактивного використання після `set_identity`/`set_mandates_dir`.

## Формат `.mt/mandates.yaml`

```yaml
mandates:
  - owner: olena
    scope:
      refs: ["refs/mt/tasks/design/**"]
      decision_types: [architecture, ux]
    thresholds: { budget_eur: 2000, risk: medium, irreversible: false }
    escalates_to: vitalii
  - owner: fable-5 # модель — першокласний власник мандата
    kind: model
    scope:
      refs: ["refs/mt/tasks/routine/**"]
      decision_types: [ops]
    thresholds: { budget_eur: 200, risk: low, irreversible: false, audacity: medium }
    escalates_to: olena
  - owner: vitalii
    scope: { refs: ["refs/mt/**"], decision_types: ["*"] }
    thresholds: {} # порожньо = кореневий мандат
    escalates_to: null
```

Тестова фікстура з двома людьми й однією моделлю — `src/tests/fixtures/mandates.yaml`.
