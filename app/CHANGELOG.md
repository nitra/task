# Changelog

## [0.5.0] - 2026-07-11

### Added

- GUI: live-стрічка run-draft.md для запущених вузлів (Completed/Blockers/Next Attempt, поллінг 2.5s), індикатор `[slots: X/N]` на воркспейс — Фаза 3 закрита.
- GUI: cost/time ledger на воркспейс — агрегація wall_sec/tokens/cost_usd по всіх run_NNN.md графу (per-node + TOTAL), доступна через іконку на панелі воркспейсу.
- GUI: DAG-візуалізація dependency-графу на воркспейс — layered SVG (leaf-и зліва, deps-ребра як стрілки), клік на вузол відкриває деталі.

## [0.4.1] - 2026-07-06

### Fixed

- Реліз падав на бандлінгу macOS: Tauri трактує будь-яку підпапку в src-tauri/src/bin/ як окремий бінарник, а doc-files генератор поклав туди src/bin/docs/ (дзеркало документації) — прибрано, щоб не плутати бандлер.

## [0.4.0] - 2026-07-06

### Added

- Показ версії застосунку в заголовку вікна й у toolbar; увімкнено createUpdaterArtifacts для генерації артефактів апдейтера
- Автооновлення з GitHub Releases: підпис updater-артефактів у CI, перевірка щогодини, діалог встановлення і перезапуск у нову версію після інсталяції (relaunch); dev-only MCP-міст
- GUI Фаза 1: version chain timeline, attention inbox, live-оновлення через FS-watcher, remote claims (running/stalled + runner_id), клікабельні deps-ребра; mt-core з nitra/mt як єдине ядро протоколу
- GUI Фаза 2 (старт): plan-review з деталей вузла — таблиця ## Children + Approve/Reject із причиною; призначення виконавця unassigned-вузлам (agent/human)
- GUI: invalidate/kill з підтвердженням у деталях вузла; призначення виконавця з model_tier (agent) або кваліфікацією (human)
- GUI: human-флоу done/audit/failed для h.md-вузлів — fact із `## Summary`, `## Check`-гейт перед прийняттям сигналу, composite-агрегація вгору (mt-core signal).
- GUI: локальний запуск агентських вузлів (кнопка Run) — mt-core runner із бюджетами, progress-watchdog і підсумком через done/audit/failed; фінал рану — подія `mt-run-finished`.
- GUI: тумблер "Run auto" на воркспейс — одноразовий batch-прохід усіх waiting-агентських вузлів через mt-core оркестратор, з подією `mt-auto-finished` для підсумку.

### Changed

- Локальний use-updater.js замінено на спільний useUpdater() з @7n/tauri-components/vue (0.8.0) — та сама логіка, тепер в одній копії для mlmail/myshare/myllm/task.

### Fixed

- Виправлено структуру workspace для відповідності правилу changelog.
- Апдейтер не запускається в dev-режимі: версія dev-збірки завжди 0.1.0, тож перевірка помилково пропонувала «оновитись» до опублікованого релізу
- банер помилок сканування (затінення error ref), кореневий vitest через projects, cargo manifest-path у lint-rust
- Автооновлення не працювало: у capabilities/default.json бракувало дозволу `updater:default`, тож перевірка оновлень падала з permission-denied ще до мережевого запиту. Додано дозвіл (той самий баг знайдено й виправлено в mlmail і myshare).
- updater:default винесено в окрему capability з `platforms: [macOS, windows, linux]` — плагін не реєструється на Android/iOS, тож у task ще нема Android-білда, але дозвіл лишався б проблемним, коли APK-job з'явиться (див. коментар у release.yml).

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), версіонування — [SemVer](https://semver.org/lang/uk/).

## [Unreleased]

### Added

- GUI: plan-review approve/reject і призначення виконавця (Фаза 2)
- GUI: invalidate/kill з підтвердженням та опціями призначення виконавця

### Changed

- deps: mt-core оновлено з main nitra/mt (claims+spawn+lifecycle)

## [0.3.0]

### Added

- GUI Фаза 1: chain, inbox, watcher, claims
- GUI: remote claims — running/stalled з refs/mt/claims + runner_id
- GUI: клікабельні deps-ребра — перехід до dep-вузла з дерева
