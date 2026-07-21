---
schema_version: 1
created_at: 2026-07-21T13:37:12.911Z
budget_sec: 1800
audit: optional
hint: atomic
---

## Task

Виправити порушення правила `js` (concern `knip`), які не закрила інлайн fix-драбина.

## Done when

- `js` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @7n/rules lint --no-fix --cwd ../.. js

## Inputs

Target-файли:
- `.pi/extensions/n-rules-adr/index.ts`
- `.pi/extensions/rtk.ts`
