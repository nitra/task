---
type: ADR
title: Retryable approve при невдачі виконання
description: Помилка виконання approve не переводить запис у failed, а залишає його в needs_approval для повторної спроби.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

Під час live demo `handleApprove` отримав помилку `Command delete_task not found`, бо застосунок був запущений зі старою збіркою без нової Rust-команди. Попередня поведінка переводила запис у термінальний `failed` і втрачала `pendingApproval`, тож після перезапуску застосунку людина не могла повторити вже підтверджену дію.

## Considered Options

- Переводити запис у `failed` при будь-якій помилці виконання approve.
- Залишати запис у `needs_approval` при помилці виконання, зберігаючи `pendingApproval` для retry.

## Decision Outcome

Chosen option: "Залишати запис у `needs_approval` при помилці виконання", because транзиторна інфраструктурна помилка не змінює людський намір підтвердити дію; після усунення причини користувач має повторити approve без нового agent request.

### Consequences

- Good, because після перезапуску застосунку з новою Rust-командою людина може повторно натиснути approve для того самого запису.
- Good, because `pendingApproval` не втрачається при execution failure.
- Bad, because transcript не містить підтвердження негативних наслідків.
- Neutral, because явне reject або інша семантична відмова лишаються окремими станами від транзиторного execution failure.

## More Information

Файл: `app/src/tool/agent-handler.js`, функція `handleApprove`. При збої execution запис зберігає `status: needs_approval`, `pendingApproval` і `approvalError`. Тест у transcript: `agent-handler.test.js` — `handleApprove keeps needs_approval (retryable) when execution fails`. Коміт у transcript: `aa45100`.

## Update 2026-06-15

- Live demo підтвердило retry-сценарій: після fresh request запис перейшов у `needs_approval` з `pending: {"tool":"delete","input":{"tasksDir":"/Users/vitalii/www/nitra/task/mt","name":"mcp-demo"}}`, а `mcp-demo` залишився на диску.
- Для фінального демо потрібно перезапустити застосунок, відкрити Journal, знайти `needs_approval` запис і натиснути «Підтвердити»; якщо виконання впаде через застарілу збірку або відсутню команду, запис має лишитися retryable.
