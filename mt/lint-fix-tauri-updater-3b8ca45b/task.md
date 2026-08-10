---
schema_version: 1
created_at: 2026-08-09T22:59:37.402Z
budget_sec: 1800
audit: optional
hint: atomic
---

## Task

Виправити порушення правила `tauri` (concern `updater`), які не закрила інлайн fix-драбина.

## Done when

- `tauri` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @7n/rules lint --no-fix --cwd ../.. tauri

## Inputs

Target-файли:
- `delta/src`
- `delta/src-tauri/src/lib.rs`
