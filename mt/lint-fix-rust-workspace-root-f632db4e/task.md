---
schema_version: 1
created_at: 2026-07-27T07:37:15.011Z
budget_sec: 1800
audit: required
hint: atomic
---

## Task

Виправити порушення правила `rust` (concern `workspace_root`), які не закрила інлайн fix-драбина.

## Done when

- `rust` не повідомляє порушень у target-файлах (див. ## Check).

## Check

npx @7n/rules lint --no-fix --cwd ../.. rust

## Inputs

Target-файли:

- `.worktrees/codex-reconcile-feat-owner-add-fractal-owner-scope-2/Cargo.toml`
- `.worktrees/codex-reconcile-feat-owner-add-fractal-owner-scope-2/app/src-tauri/Cargo.toml`
- `.worktrees/codex-reconcile-feat-owner-add-fractal-owner-scope-2/owner/owner-llm/Cargo.toml`
- `.worktrees/codex-reconcile-feat-owner-add-fractal-owner-scope-2/owner/src-tauri/Cargo.toml`
- `.worktrees/codex-reconcile-feat-owner-integrate-cascading-llm-acces-2/Cargo.toml`
- `.worktrees/codex-reconcile-feat-owner-integrate-cascading-llm-acces-2/app/src-tauri/Cargo.toml`
- `.worktrees/codex-reconcile-feat-owner-integrate-cascading-llm-acces-2/owner/Cargo.toml`
- `.worktrees/codex-reconcile-feat-owner-integrate-cascading-llm-acces-2/owner/owner-llm/Cargo.toml`
- `.worktrees/codex-reconcile-feat-owner-integrate-cascading-llm-acces-2/owner/src-tauri/Cargo.toml`
- `.worktrees/codex-reconcile-feat-rust-adopt-the-root-cargo-workspace/Cargo.toml`
- `.worktrees/codex-reconcile-feat-rust-adopt-the-root-cargo-workspace/app/src-tauri/Cargo.toml`
- `.worktrees/codex-reconcile-feat-rust-adopt-the-root-cargo-workspace/owner/owner-llm/Cargo.toml`
- `.worktrees/codex-reconcile-feat-rust-adopt-the-root-cargo-workspace/owner/src-tauri/Cargo.toml`
- `.worktrees/fix-reminders-personal-today/Cargo.toml`
- `.worktrees/fix-reminders-personal-today/app/src-tauri/Cargo.toml`
- `.worktrees/fix-reminders-personal-today/owner/owner-llm/Cargo.toml`
- `.worktrees/fix-reminders-personal-today/owner/src-tauri/Cargo.toml`
