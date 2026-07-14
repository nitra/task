---
schema_version: 1
created_at: 2026-07-14T13:49:47.969Z
budget_sec: 1800
audit: required
hint: atomic
---

## Task

Виправити порушення правила `tauri` (concern `tooling`), які не закрила інлайн fix-драбина.

## Done when

- `tauri` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @nitra/cursor lint --no-fix --cwd ../.. tauri

## Inputs

Target-файли:
- (whole-repo concern)
