# Клонування репозиторію `nitra/mt` як sibling-каталог для Cargo path-patch

**Status:** Accepted
**Date:** 2026-06-13

## Context and Problem Statement

`bun run start` завершувався з помилкою `cargo` (exit 101): не вдавалося знайти `/Users/vitalii/www/nitra/mt/scanner/Cargo.toml`. Цей шлях жорстко вказаний у `[patch]`-секції `app/src-tauri/Cargo.toml` для локальної підміни git-залежності `mt-scanner`. Репозиторій `nitra/mt` не було клоновано на машині розробника.

## Considered Options

- Клонувати `ssh://git@github.com/nitra/mt.git` у `/Users/vitalii/www/nitra/mt` (sibling до `task/`)
- Прибрати `[patch]`-секцію і використовувати git-залежність напряму
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Клонувати `nitra/mt` у sibling-каталог", because репозиторій доступний по SSH (`git ls-remote` повернув HEAD `92d0fab`), а `[patch]` свідомо розрахований на layout `../../../mt/scanner` — клон відновлює dev-workflow без змін у `Cargo.toml`.

### Consequences

- Good, because `cargo fetch` і `cargo check` успішно завершилися після клонування.
- Bad, because будь-який розробник мусить мати sibling-checkout `mt/` поруч із `task/`; неявна умова, не задокументована в README.

## More Information

Команда: `git clone ssh://git@github.com/nitra/mt.git /Users/vitalii/www/nitra/mt`

Patch-секція в `app/src-tauri/Cargo.toml`:
```toml
[patch."ssh://git@github.com/nitra/mt.git"]
mt-scanner = { path = "../../../mt/scanner" }
```
Перевірка: `cargo fetch` у `app/src-tauri/` → exit 0.
