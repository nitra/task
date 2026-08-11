---
schema_version: 1
created_at: 2026-08-09T22:59:37.402Z
budget_sec: 1800
audit: required
hint: atomic
---

## Task

Виправити порушення правила `js` (concern `doc_comments`), які не закрила інлайн fix-драбина.

## Done when

- `js` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @7n/rules lint --no-fix --cwd ../.. js

## Inputs

Target-файли:

- `delta/src/ai-petition.js`
- `delta/src/change-proposal.js`
- `delta/src/composables/use-trust.js`
- `delta/src/device-registry.js`
- `delta/src/mandate-change.js`
- `delta/src/tool/catalog.js`
- `delta/src/tool/index.js`
- `delta/src/track-record.js`
- `delta/src/trust.js`
