# Оновлення `TaskState` у `mt-scanner` та синхронізація Vue-компонента

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Специфікація `@7n/mt` отримала нові стани задачі, змінила пріоритет перевірки та перейменувала існуючі. Rust-crate `mt-scanner` не відображав змін: `pending-audit` перевірявся пізніше за `resolved`, будь-який `run_*.md` давав `Failed` без `failed_streak`, стану `unresolvable` не існувало (був `Invalidated`, якого нема у spec). Vue-компонент `TaskNodeItem.vue` використовував застарілі ключі `human_pending`, `invalidated`.

## Considered Options

- Оновити enum і логіку `detect_state` в `mt-scanner/src/lib.rs` та синхронізувати `TaskNodeItem.vue`
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Оновити enum і логіку `detect_state`", because три критичні несумісності (пріоритет, логіка `Failed`, відсутній `unresolvable`) і п'ять відсутніх станів; snake_case-назви Rust-enum прямо використовуються як ключі у Vue, тому зміни мусять бути синхронними.

### Consequences

- Good, because `cargo check` завершився успішно після змін.
- Good, because нові стани отримали власні іконки, кольори та мітки замість fallback.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Змінені файли: `/Users/vitaliytv/www/nitra/mt/scanner/src/lib.rs`, `app/src/components/TaskNodeItem.vue`
- Доданий `[patch]` у `app/src-tauri/Cargo.toml`: `patch."ssh://git@github.com/nitra/mt.git"` → `{ path = "../../../mt/scanner" }`
- Новий пріоритет `detect_state`: `unresolvable` → `pending-audit` → `resolved` → `stalled` → `running` → `plan-review` → `spawned` → `failed`/`waiting` (streak-based) → `blocked` → `pending` → `unassigned`
- `Failed` лише коли `failed_streak ≥ agent_retry_max` (з `.mt.json`); виявлення `running` через prefix worktree прибрано — лише sentinel-файл
- `TaskNodeItem.vue`: `text-strike` змінено з `invalidated` на `unresolvable`; `human_pending` → `pending`; додано `blocked`, `plan_review`, `spawned`, `stalled`, `unresolvable`
