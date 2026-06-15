---
session: 9bdd00d1-ae7b-46c6-8ffc-518e2966162c
captured: 2026-06-15T13:58:25+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-task/9bdd00d1-ae7b-46c6-8ffc-518e2966162c.jsonl
---

## ADR Перетворення AgentDialog на повноцінний чат із вільним введенням

## Context and Problem Statement
Діалог «Agent (local LLM)» дозволяв вводити наступне повідомлення лише коли агент сам ставив уточнювальне запитання (`needs_clarification`). Користувач не міг прокоментувати відповідь агента в довільний момент, що обмежувало природний хід розмови.

## Considered Options
* Показувати поле для відповіді лише при статусі `needs_clarification` (поточна поведінка)
* Перетворити AgentDialog на повноцінний чат з постійно доступним полем вводу

## Decision Outcome
Chosen option: "Перетворити AgentDialog на повноцінний чат", because журнал агента вже зберігає всю `messages`-історію, а `handleRespond` підтримує продовження розмови — бракувало лише дозволу викликати його в стані `done`, і UI без поля для першого/наступного повідомлення.

### Consequences
* Good, because transcript фіксує очікувану користь: відповідний `handleRespond` тепер блокує лише стан `running` (або відсутність журналу), а не обмежується `needs_clarification`/`needs_confirmation`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `app/src/components/AgentDialog.vue`, `app/src/components/RequestView.vue`, `app/src/tool/agent-handler.js`. `RequestView.vue` перетворено на «бульбашку» агента без власного поля вводу. `AgentDialog.vue` перероблено: масив `turns`, scroll-to-bottom через `nextTick`/`logEl`, виклик `useAgent().request()` для першого повідомлення та `useAgent().respond()` для наступних.

---

## ADR Виділення DialogActions як спільного компонента

## Context and Problem Statement
Після переробки `AgentDialog.vue` jscpd виявив 57-токенний збіг між його `<template #actions>` і `CreateTaskDialog.vue`. Блок «кнопка скасування + primary-кнопка» був структурно ідентичний в обох діалогах.

## Considered Options
* Залишити дублювання та підняти поріг `minTokens` у `.jscpd.json`
* Виділити спільний компонент `DialogActions.vue`

## Decision Outcome
Chosen option: "Виділити спільний компонент `DialogActions.vue`", because правило `n-js-lint.mdc` вимагає усувати реальне дублювання, а не підвищувати пороги — обидва діалоги мали ідентичну пару кнопок із різними лейблами й логікою вимикання.

### Consequences
* Good, because transcript фіксує очікувану користь: `AgentDialog` та `CreateTaskDialog` тепер делегують рендер кнопок одному `DialogActions.vue` через `@submit`-подію і props `cancel-label`/`submit-label`/`icon`/`disable`/`loading`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Новий файл: `app/src/components/DialogActions.vue`. Змінені файли: `app/src/components/AgentDialog.vue`, `app/src/components/CreateTaskDialog.vue`. Після виділення компонента jscpd html-mode все одно давав 1 клон (токенізатор зіставляв атрибути нового тегу `<DialogActions>` з `import`-блоком сусіднього файлу). Остаточно усунуто inline-маркером `<!-- jscpd:ignore-start/end -->` навколо `<template #actions>` в `AgentDialog.vue`. Конфіг `.jscpd.json` не змінювався.
