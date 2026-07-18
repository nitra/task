---
type: JS Module
title: stryker.config.mjs
resource: owner/stryker.config.mjs
docgen:
  crc: a1405dc2
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл керує mutation testing на базі Vitest і потрібен, щоб дати системі звіт про те, які змінені рядки пов’язані з результатами тестів. Він також розмежовує службові артефакти в `reports/stryker/.tmp` і використовує `reports/stryker/mutation.json` та `reports/stryker/incremental.json` як конфіги, на які спирається код, щоб зберігати дані для mutation score і стан incremental-проходу.

## Поведінка

1. Запускає mutation testing через Vitest і оцінює, які мутанти реально вбивають наявні тести.
2. Виконує перевірку лише за тими тестами, що покривають змінену лінію, щоб скоротити час прогону.
3. Працює у тимчасовій директорії `reports/stryker/.tmp`, не змішуючи службові артефакти з основними файлами проєкту.
4. Зберігає підсумок результатів у `reports/stryker/mutation.json`, щоб інші частини системи могли читати звіт про mutation score та статуси мутантів.
5. Застосовує incremental-прохід і пише службовий стан у `reports/stryker/incremental.json`, щоб відновлювати попередній прогрес після переривання запуску.
6. Ігнорує Vue `script setup`-макроси під час мутації, щоб не ламати компіляцію SFC у випадках, де інструмент не може безпечно обробити такі конструкції.
7. Не покладається на окремий command runner для повного прогону всього test-suite на кожен мутант; пропущений шлях саме такий, а не загальна відмова від тестів.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
