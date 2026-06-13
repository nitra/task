---
session: e8e91f68-dadd-4c55-b6c2-b011d44e5a82
captured: 2026-06-13T06:42:43+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/e8e91f68-dadd-4c55-b6c2-b011d44e5a82.jsonl
---

## ADR Клонування репозиторію `nitra/mt` як sibling-каталог для Cargo path-patch

## Context and Problem Statement
`bun run start` завершувався з кодом 101, тому що `cargo` не міг прочитати `/Users/vitalii/www/nitra/mt/scanner/Cargo.toml`. Цей шлях вказаний у `[patch]`-секції `app/src-tauri/Cargo.toml` для локальної підміни git-залежності `mt-scanner`.

## Considered Options
* Клонувати `ssh://git@github.com/nitra/mt.git` у `/Users/vitalii/www/nitra/mt` (sibling до `task/`)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Клонувати `nitra/mt` у sibling-каталог", because репозиторій доступний по SSH (`git ls-remote` повернув HEAD `92d0fab`), а `[patch]` у `Cargo.toml` вже жорстко вказує відносний шлях `"../../../mt/scanner"` — змінювати конфіг не потрібно.

### Consequences
* Good, because `cargo fetch` успішно завершився після клонування, підтверджуючи, що залежність резолвиться коректно.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Команда клонування: `git clone ssh://git@github.com/nitra/mt.git /Users/vitalii/www/nitra/mt`
- Patch-секція в `app/src-tauri/Cargo.toml`:
```toml
[patch."ssh://git@github.com/nitra/mt.git"]
mt-scanner = { path = "../../../mt/scanner" }
```
- Очікуваний шлях до крейту: `/Users/vitalii/www/nitra/mt/scanner/Cargo.toml`
- Верифікація: `cargo fetch` у `app/src-tauri/`
