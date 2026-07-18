---
schema_version: 1
created_at: 2026-07-13T18:44:35.779Z
budget_sec: 1800
audit: optional
hint: atomic
---

## Task

Виправити порушення правила `tauri` (concern `updater`), які не закрила інлайн fix-драбина.

## Done when

- `tauri` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @nitra/cursor lint --no-fix --cwd ../.. tauri

## Inputs

Target-файли:

- `app/src`
- `owner/src`
- `owner/src-tauri/src/lib.rs`
