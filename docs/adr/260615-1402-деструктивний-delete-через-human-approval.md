---
type: ADR
title: Деструктивний delete через human approval
description: Агент може ініціювати видалення задачі, але виконання ставиться на паузу до явного підтвердження людини.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

Agent-gateway відкриває зовнішньому агенту доступ до Tool Surface через MCP-stdio. Для деструктивної операції `delete` потрібен механізм, який не дозволяє агенту автономно видалити задачу, але дає змогу поставити намір на підтвердження людині.

## Considered Options

- `needs_approval` через журнал: агент викликає деструктивний тул, запис переходить у `needs_approval`, людина підтверджує в audit UI, після чого дія виконується.
- Заборонити деструктивні тули агентам повністю.
- Дозволити деструктивні дії без підтвердження, лише з аудитом.

## Decision Outcome

Chosen option: "`needs_approval` через журнал", because це продовжує наявну модель `needs_clarification`: той самий журнал зберігає стан паузи, pending action і подальший approve/reject flow.

### Consequences

- Good, because деструктивна дія не виконується до людського approval; transcript фіксує, що `mcp-demo` лишилась на диску при `status: needs_approval`.
- Good, because `pendingApproval` містить тул і input, які людина бачить в audit UI перед підтвердженням.
- Bad, because transcript не містить підтвердження негативних наслідків.
- Neutral, because approval додає третій стан scope-класифікації: `allow | approval | deny`.

## More Information

Файли: `app/src/tool/catalog.js` (`delete` з `tier: 'destructive'`), `app/src/tool/scope.js` (`classify`), `app/src/tool/llm.js` (`gate`), `app/src/tool/agent-handler.js` (`handleApprove`), `app/src/components/AuditDialog.vue`, `app/src-tauri/src/lib.rs` (`delete_task`). Коміт у transcript: `690fe1a`.
