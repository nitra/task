---
schema_version: 1
created_at: 2026-07-13T19:16:45.041Z
budget_sec: 1800
audit: required
hint: atomic
---

## Task

Виправити порушення правила `style` (concern `lint`), які не закрила інлайн fix-драбина.

## Done when

- `style` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @nitra/cursor lint --no-fix --cwd ../.. style

## Inputs

Target-файли:

- (whole-repo concern)
