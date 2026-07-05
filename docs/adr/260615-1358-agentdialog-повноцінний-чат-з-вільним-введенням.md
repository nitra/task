---
type: ADR
title: AgentDialog як повноцінний чат з вільним введенням
description: AgentDialog отримує постійне поле вводу і може продовжувати розмову не лише у стані clarification.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

Діалог `AgentDialog` дозволяв вводити наступне повідомлення лише тоді, коли агент повертав `needs_clarification`. Користувач не міг прокоментувати відповідь агента після `done` або продовжити розмову у довільний момент, хоча журнал уже зберігав `messages[]`, а `handleRespond` підтримував resume розмови.

## Considered Options

- Показувати поле відповіді лише при `needs_clarification`.
- Перетворити `AgentDialog` на повноцінний чат із постійно доступним полем вводу.

## Decision Outcome

Chosen option: "Перетворити `AgentDialog` на повноцінний чат із постійно доступним полем вводу", because журнал агента вже зберігає повну `messages`-історію, а `handleRespond` може продовжувати loop; бракувало лише UI-дозволу надсилати перше й наступні повідомлення поза станом `needs_clarification`.

### Consequences

- Good, because `handleRespond` тепер блокує лише стан `running` або відсутність журналу, а не обмежується clarification-статусами.
- Good, because `RequestView.vue` стає бульбашкою агента без власного поля вводу, а `AgentDialog.vue` відповідає за turns, scroll-to-bottom і submit.
- Bad, because transcript не містить підтвердження негативних наслідків.
- Neutral, because для усунення jscpd-дублювання виділено спільний `DialogActions.vue` для action-кнопок діалогів.

## More Information

Змінені файли: `app/src/components/AgentDialog.vue`, `app/src/components/RequestView.vue`, `app/src/tool/agent-handler.js`, `app/src/components/CreateTaskDialog.vue`. Новий спільний компонент: `app/src/components/DialogActions.vue`. `AgentDialog.vue` використовує `useAgent().request()` для першого повідомлення та `useAgent().respond()` для наступних.
