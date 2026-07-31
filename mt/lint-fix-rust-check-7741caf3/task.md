---
schema_version: 1
created_at: 2026-07-27T07:37:15.011Z
budget_sec: 1800
audit: required
hint: atomic
---

## Task

Виправити порушення правила `rust` (concern `check`), які не закрила інлайн fix-драбина.

## Done when

- `rust` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @7n/rules lint --no-fix --cwd ../.. rust

## Inputs

Target-файли:

- (whole-repo concern)
