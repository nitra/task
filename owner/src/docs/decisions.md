---
type: JS Module
title: decisions.js
resource: owner/src/decisions.js
docgen:
  crc: fdf082b8
  model: openai-codex/gpt-5.4-mini
  score: 100
  issues: judge:inaccurate:0.93
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

`collectDecisions` збирає вузли, які очікують рішення власника. `collectPersonal` збирає особисті pending-завдання власника. Модуль потрібен, щоб окремо отримувати два різні набори станів для подальшої обробки.

## Поведінка

- collectDecisions — збирає по всьому лісі рішення, що чекають вердикту власника, і впорядковує їх за ціною помилки.
- collectPersonal — збирає особисті pending-задачі власника з усього лісу; ці вузли не потрапляють у чергу рішень і показуються у брифі.

## Публічний API

- collectDecisions — збирає всі рішення, що очікують на власника, по всьому лісі й ставить першими ті, де помилка найдорожча.
- collectPersonal — збирає особисті задачі власника; pending h.md-вузли лишає як роботу для брифу, а не як рішення в черзі.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
