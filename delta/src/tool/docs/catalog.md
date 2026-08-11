---
type: JS Module
title: catalog.js
resource: delta/src/tool/catalog.js
docgen:
  crc: 23f9c23c
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 60
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Єдине джерело правди tool-поверхні delta-застосунку (n-tool-surface). Кожна дія — іменований tool зі схемою, досяжний однаково з UI (src/tool/index.js) і headless CLI (bin/delta.mjs): `cli: true` — маркер, що обидва входи фактично реалізовані. M1 додає чергу «Вирішую» + квіз-гейт + підпис (docs/specs/260809-delta-app.md, п.6 «CLI-паритет») — та сама вимога повного паритету, що й у M0 мандатів.

## Публічний API

- TOOLS — Trust tier per tool (n-tool-surface D-E1): read < write.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
