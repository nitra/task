---
session: a13ef9f9-0817-4ab2-b8d6-42d8e1a68631
captured: 2026-06-11T19:22:11+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/a13ef9f9-0817-4ab2-b8d6-42d8e1a68631.jsonl
---

## ADR Оновлення enum `TaskState` у `mt-scanner` відповідно до нової специфікації `@7n/mt`

## Context and Problem Statement
Специфікація `@7n/mt` (файл `node_modules/@7n/mt/docs/mt.md`) отримала нові стани задачі, змінила пріоритет перевірки станів і перейменувала кілька існуючих. Поточний Rust-crate `mt-scanner` не відображав цих змін: стан `pending-audit` перевірявся пізніше за `resolved`, будь-який `run_*.md` одразу давав `Failed` без урахування `failed_streak`, а стану `unresolvable` не існувало взагалі (замість нього був `Invalidated`, якого у spec немає).

## Considered Options
* Оновити enum і логіку `detect_state` в `mt-scanner/src/lib.rs` відповідно до нової специфікації
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити enum і логіку `detect_state`", because аналіз показав три критичні несумісності (неправильний пріоритет станів, хибна логіка `Failed`, відсутній `unresolvable`) і п'ять відсутніх станів (`blocked`, `plan-review`, `spawned`, `stalled`, `unresolvable`).

### Consequences
* Good, because `cargo check` завершився успішно після змін, підтвердивши сумісність типів.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `/Users/vitaliytv/www/nitra/mt/scanner/src/lib.rs`
- Доданий `[patch]` у `/Users/vitaliytv/www/nitra/task/app/src-tauri/Cargo.toml` для використання локального клону замість git-залежності: `patch."ssh://git@github.com/nitra/mt.git"` → `../../../mt/scanner`
- Новий пріоритет `detect_state`: `unresolvable` → `pending-audit` → `resolved` → `stalled` → `running` → `plan-review` → `spawned` → `failed`/`waiting` (streak-based) → `blocked` → `pending` → `unassigned`
- Стан `Failed` тепер повертається лише коли `failed_streak ≥ agent_retry_max` (читається з `.mt.json`)
- Виявлення `running` через prefix worktree-директорії прибрано (нова схема імен `<node-hash>-<token>` несумісна з попереднім prefix-match); залишено лише sentinel-файл

---

## ADR Синхронізація Vue-компонента `TaskNodeItem` з новим enum станів

## Context and Problem Statement
Vue-компонент `TaskNodeItem.vue` відображав значки та кольори станів через об'єкт `STATE`, де ключі відповідали рядковим значенням серіалізованого `TaskState` з Rust. Після оновлення enum стани `human_pending` та `invalidated` зникли; з'явилися `pending`, `unresolvable`, `blocked`, `plan_review`, `spawned`, `stalled`. Компонент також застосовував `text-strike` до `invalidated`, якого більше не існує.

## Considered Options
* Оновити об'єкт `STATE` і умову `text-strike` у `TaskNodeItem.vue` синхронно зі змінами в Rust
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити `STATE` і умову `text-strike`", because серіалізовані snake_case-назви Rust-enum прямо використовуються як ключі в `STATE`; неузгодженість давала б fallback-відображення для всіх нових станів.

### Consequences
* Good, because transcript фіксує очікувану користь: нові стани отримали власні іконки, кольори та мітки замість беззмістовного fallback.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `/Users/vitaliytv/www/nitra/task/app/src/components/TaskNodeItem.vue`
- Умову `:class="{ 'text-strike text-grey-5': node.state === 'invalidated' }"` замінено на `node.state === 'unresolvable'`
- Ключ `human_pending` замінено на `pending`; додано ключі `blocked`, `plan_review`, `spawned`, `stalled`, `unresolvable`
