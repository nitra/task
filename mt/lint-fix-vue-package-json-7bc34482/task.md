---
schema_version: 1
created_at: 2026-07-14T13:49:47.969Z
budget_sec: 1800
audit: optional
hint: atomic
---

## Task

Виправити порушення правила `vue` (concern `package_json`), які не закрила інлайн fix-драбина.

## Done when

- `vue` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @nitra/cursor lint --no-fix --cwd ../.. vue

## Inputs

Target-файли:
- `owner/package.json`
