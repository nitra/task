---
type: JS Module
title: stryker.config.mjs
resource: owner/stryker.config.mjs
docgen:
  crc: a1405dc2
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 100
---

## Огляд

Overview
Налаштування тестування Vitest. Використовується `vitest.config.js`.

Поведінка

1. Запуск тестування через Vitest.
2. Використання конфігурації Vitest з `vitest.config.js`.
3. Увімкнення `coverageAnalysis` на рівні `perTest`.
4. Використання `concurrency` для вибору кількості потоків.
5. Використання `inPlace` для ізоляції мутантів у пам'яті через AST-patching замість копіювання `node_modules` у sandbox.
6. Увімкнення `incremental` для збереження результатів між запусками.
7. Увімкнення `incrementalFile` для відновлення результатів після крашу чи зупинки.
8. Пропуск мутації Vue `<script setup>` макросів через `Local plugin`.
9. Виключення `vue-macros` з перевірки для уникнення проблем зі статичним аналізом компілятора SFC.

## Поведінка

Поведінка

1. Запуск тестування через Vitest
2. Використання конфігурації Vitest з `vitest.config.js`
3. Увімкнення `coverageAnalysis` на рівні `perTest`
4. Використання `concurrency` для вибору кількості потоків
5. Використання `inPlace` для ізоляції мутантів у пам'яті через AST-patching замість копіювання `node_modules` у sandbox
6. Увімкнення `incremental` для збереження результатів між запусками
7. Увімкнення `incrementalFile` для відновлення результатів після крашу чи зупинки
8. Пропуск мутації Vue `<script setup>` макросів через `Local plugin`
9. Виключення `vue-macros` з перевірки для уникнення проблем з статичним аналізом компілятора SFC

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
