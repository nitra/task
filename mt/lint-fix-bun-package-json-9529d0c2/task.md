---
schema_version: 1
created_at: 2026-07-14T13:49:47.969Z
budget_sec: 1800
audit: optional
hint: atomic
---

## Task

Виправити порушення правила `bun` (concern `package_json`), які не закрила інлайн fix-драбина.

## Done when

- `bun` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @nitra/cursor lint --no-fix --cwd ../.. bun

## Inputs

Target-файли:
- `package.json`
