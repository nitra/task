---
schema_version: 1
created_at: 2026-07-27T07:58:15.058Z
budget_sec: 1800
audit: optional
hint: atomic
---

## Task

Виправити порушення правила `doc-files` (concern `check`), які не закрила інлайн fix-драбина.

## Done when

- `doc-files` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @7n/rules lint --no-fix --cwd ../.. doc-files

## Inputs

Target-файли:
- `owner/src-tauri/src/llm.rs`
