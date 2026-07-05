---
type: ADR
title: Тільки macOS для agent-gateway
description: Agent-gateway реалізується лише для macOS desktop-профілю без Android-абстракцій.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

Початкова архітектура agent-gateway розглядала Mac і Android. Для MCP-stdio, локального FS-доступу до репозиторіїв і локального `omlx` Android-профіль вимагав би окремих capability-профілів, remote-моделей або додаткових abstraction layer.

## Considered Options

- Підтримувати Mac + Android із профілями можливостей.
- Підтримувати лише macOS desktop-профіль.

## Decision Outcome

Chosen option: "Підтримувати лише macOS desktop-профіль", because transcript фіксує явне рішення користувача залишити тільки Mac-версію, що прибирає потребу в Android-specific Store-абстракціях, remote-моделях і capability-профілях.

### Consequences

- Good, because архітектура agent-gateway лишається пласкою: один локальний FS-доступ, один MCP-stdio шлях і одна локальна `omlx` реалізація.
- Bad, because transcript не містить підтвердження негативних наслідків від відмови від Android-профілю.
- Neutral, because рішення стосується desktop-profile і не описує майбутню стратегію повернення Android.

## More Information

Transcript фіксує рішення фразою про залишення тільки Mac-версії. Додаткових файлів або команд для цього рішення в transcript не зафіксовано.
