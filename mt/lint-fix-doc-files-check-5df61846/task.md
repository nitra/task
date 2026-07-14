---
schema_version: 1
created_at: 2026-07-13T18:49:26.639Z
budget_sec: 1800
audit: optional
hint: atomic
---

## Task

Виправити порушення правила `doc-files` (concern `check`), які не закрила інлайн fix-драбина.

## Done when

- `doc-files` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @nitra/cursor lint --no-fix --cwd ../.. doc-files

## Inputs

Target-файли:

- `app/src/components/PipelineStatusDialog.vue`
- `owner/stryker.config.mjs`
