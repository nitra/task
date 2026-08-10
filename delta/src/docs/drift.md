---
type: JS Module
title: drift.js
resource: delta/src/drift.js
docgen:
  crc: ce7d8027
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Інструмент дозволяє виявляти застарілі рішення за допомогою `runDriftScan` та `detectDrift` шляхом порівняння стану директорій із параметрами `defaultDriftConfig`. Система дозволяє керувати актуальністю даних через `loadDriftCards`, `saveDriftCards`, `parseDriftFile` та `formatDriftFile`.

## Поведінка

Процес виявлення дрейфу починається з повного перерахунку стану через `runDriftScan`, що є єдиною точкою входу для автоматизованих завдань та ручного запуску. Під час сканування `detectDrift` аналізує зібрані дані з директорій з рішеннями, використовуючи `defaultDriftConfig` для визначення порогів застарілості та ітерацій. Результати аналізу групуються за типами рішень, формуючи набір дрейф-карток.

Для роботи з результатами використовується механізм збереження: `saveDriftCards` повністю перезаписує локальний файл `drift.json`, забезпечуючи актуальність даних без накопичення застарілих записів. Зворотне читання та розбір структури виконуються через `loadDriftCards` та `parseDriftFile`, а підготовка тексту для запису здійснюється за допомогою `formatDriftFile`. Таким чином, потік даних забезпечує перехід від сирих файлів рішень до структурованого звіту про дрейф.

## Публічний API

- detectDrift — Деривує дрейф-картки одного власника з уже сканованих `decisions/`-
директорій — pure-функція (той самий підхід, що `watcher.js:
scanForNotifications`): не читає диск сама, `now` завжди явно
ін'єктований.
- parseDriftFile — Розбирає локальний файл дрейф-карток (`drift.json`, поза git) — той самий
fail-safe парсинг, що `knowledge.js: parseKnowledgeFile`.
- loadDriftCards — Читає ЛОКАЛЬНІ дрейф-картки (той самий `{read, write}`-io-контракт, що
`knowledge.js: loadKnowledgeEntries`).
- saveDriftCards — Перезаписує ЛОКАЛЬНІ дрейф-картки СВІЖИМ результатом скану (кожен
`drift_scan` — повний перерахунок, не інкрементальний append — той самий
підхід, що `watcher.js` НЕ використовує тут: watcher дописує, дрейф
перераховує, бо картка «клас Х відкладається» застаріває сама собою,
коли клас закрито — append накопичував би мертві картки назавжди).
- runDriftScan — Повний потік `drift_scan`: деривує картки ({@link detectDrift}) і
перезаписує локальний файл ({@link saveDriftCards}) — спільна точка
входу для CLI/GUI tool і headless-крону.
- defaultDriftConfig — повертає налаштування за замовчуванням для виявлення відхилень.
- formatDriftFile — формує структуру файлу на основі конфігів NNNN-approval.json, knowledge.json, device_key.json, drift.json, config.json та approval.json.

## Сценарії використання

- `delta/src/tests/drift.test.js` (defaultDriftConfig; detectDrift) — staleDays: 7, iterationsThreshold: 3; без handle — порожньо; застаріла ops-розвилка olena (opened_at ~39 днів тому, staleDays: 7) — картка класу ops; свіжа відкрита розвилка (без opened_at, без застарілого квізу) — НЕ дрейф; закрита (approval поруч) — НЕ дрейф, навіть якщо стара; ще 8

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
