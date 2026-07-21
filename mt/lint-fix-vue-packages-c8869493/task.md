---
schema_version: 1
created_at: 2026-07-21T13:37:12.911Z
budget_sec: 1800
audit: required
hint: atomic
---

## Task

Виправити порушення правила `vue` (concern `packages`), які не закрила інлайн fix-драбина.

## Done when

- `vue` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @7n/rules lint --no-fix --cwd ../.. vue

## Inputs

Target-файли:
- (whole-repo concern)
