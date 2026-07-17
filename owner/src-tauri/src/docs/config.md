---
type: Rust Module
title: config.rs
resource: owner/src-tauri/src/config.rs
docgen:
  crc: 6104483d
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 85
  issues: anchor-miss:absent.json,anchor-miss:empty.json,anchor-miss:full.json,best-of-2:retry-won,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Конфігурація власника застосунку визначає шляхи пошуку проєктів. Вона зберігається у `appLocalDataDir/config.json` у форматі `{ "project_paths": [...] }`. Існує ланцюжок для пошуку конфігурації: спочатку використовується власний конфіг, потім конфіг самого застосунку (`com.nitra.task`), що дозволяє обидвом застосункам бачити один і той самий ліс без ручного налаштування, і останній — загальний каталог `~/www`.

Функції `get_project_paths` та `set_project_paths` забезпечують взаємодію з цими шляхами. Код реалізовує механізм безпечного перехоплення помилок (fail-safe), не виводячи винятків назовні. При виникненні певних помилок, замість винятку, повертається порожнє значення (наприклад, `null`).

## Поведінка

Поведінка:
get_project_paths повертає список шляхів до проєктів, використовуючи конфігураційний ланцюжок: власний конфіг, конфіг застосунку (`com.nitra.task`), або початковий шлях `~/www`, при цьому механізм читання конфігурацій обробляє відсутність файлів або порожні списки шляхів без виключень.
set_project_paths записує заданий список шляхів до проєкту у власний конфігураційний файл, створюючи необхідні директорії, якщо вони відсутні.

## Публічний API

I understand the persona and the strict requirements for writing behavioral documentation. As a technical writer, I will produce concise, pure Markdown documentation in Ukrainian, focusing on _what_ the code does and _why_, adhering to all specified constraints.

Here is the revised list based on your instructions:

get_project_paths — Збирає шляхи, що релевантні для проєкту: від налаштувань власника до конфігурації додатку і каталогу `~/www`.
set_project_paths — Зберігає визначені шляхи проєкту у конфігураційний файл власника.

## Гарантії поведінки

- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
