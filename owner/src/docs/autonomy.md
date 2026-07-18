---
type: JS Module
title: autonomy.js
resource: owner/src/autonomy.js
docgen:
  crc: f6ef7458
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

File: /Users/vitalii/www/nitra/task/AGENTS.md
(No changes to be made to AGENTS.md based on the request, as the request is about rewriting documentation for a specific file, not AGENTS.md itself. I will proceed with rewriting the documentation.)

GATES визначають доступність дій. ACTION_CLASSES описують допустимі класи дій. parseAutonomy аналізує декларації автономності вузлів. serializeAutonomy представляє автономність у певному форматі. mergeAutonomy об'єднує політики автономності. resolveAction визначає кінцевий статус виконання конкретних дій відповідно до сформованої політики.

## Поведінка

GATES — Фіксований набір дозволених класів дій.
ACTION_CLASSES — Фіксований словник відомих класів дій, які можуть бути згадані у політиці.
parseAutonomy — Аналізує текст, що описує політику вузла, і повертає карту декларованих класів дій.
serializeAutonomy — Перетворює карту політики вузла у формат тексту для файлу.
mergeAutonomy — Об'єднує успадковану політику з власною декларацією вузла, забезпечуючи, що політика лише посилюється.
resolveAction — Визначає кінцевий статус виконання дії для певного класу, використовуючи ефективну політику, де недекларовані дії за замовчуванням вимагають затвердження.

## Публічний API

Applying the "technical writer" role with specific constraints: concise, behavioral documentation in Ukrainian Markdown, focusing on "What" and "Why" not "How" or signatures, strict adherence to provided names, and targeted simplification.

Here is the rewritten list:

GATES — Визначає загальні правила для роботи вузла.
ACTION_CLASSES — Декомпозиція класів дій у політику вузла.
parseAutonomy — Читає файл `autonomy.yml` і виносить декларації правил (`клас: gate`) у політику вузла, ігноруючи коментарі та порожні рядки.
serializeAutonomy — Зберігає політику вузла у файл `autonomy.yml` у заданому порядку ключів.
mergeAutonomy — Об'єднує політику вузла з політикою його предка, застосовуючи правила: власна декларація вузла може посилити політику (наприклад, змінити `auto` на `approve`), але ніколи не може послабити вже встановлену політику предка.
resolveAction — Вирішує політику для певної дії: у випадку відсутності декларації в предків, дія отримує значення за замовчуванням `fail-closed`, і дозволяється (`approve`), якщо жоден предок явно це не заборонив.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
