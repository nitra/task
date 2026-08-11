---
schema_version: 1
created_at: 2026-08-09T22:59:37.402Z
budget_sec: 1800
audit: required
hint: atomic
---

## Task

Виправити порушення правила `text` (concern `cspell-fix`), які не закрила інлайн fix-драбина.

## Done when

- `text` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @7n/rules lint --no-fix --cwd ../.. text

## Inputs

Target-файли:

- (whole-repo concern)
