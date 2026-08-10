---
type: JS Module
title: candor.js
resource: delta/src/candor.js
docgen:
  crc: 1b442407
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min
  score: 80
  issues: anchor-miss:directory.json,anchor-miss:knowledge.json,anchor-miss:device_key.json,anchor-miss:config.json,judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль забезпечує формування та збереження ідентифікованих записів за допомогою `buildCandorRecord` та `appendCandorRecord` у лог-файл, що визначається через `candorLogPath`. Система дозволяє зчитувати історію через `parseCandorLog`, перевіряти цілісність даних за допомогою `validateCandorAudacity` та відображати записи через `candorShow`. Робота з позначками прочитання реалізована через `parseCandorReadMarks`, `formatCandorReadMarks` та `markCandorRead` з використанням унікального `candorId` для `aiCandor`.

## Поведінка

Процес формування запису починається з визначення шляху до лог-файлу через `candorLogPath`. Функція `aiCandor` оркеструє повний цикл: вона перевіряє рівень зухвалості через `validateCandorAudacity`, створює структуру запису за допомогою `buildCandorRecord` та зберігає його в лог за допомогою `appendCandorRecord`. Для забезпечення стабільності ідентифікаторів використовується `candorId`, що базується на властивостях запису.

Для відображення даних `candorShow` зчитує лог через `candorLogPath`, розбирає його за допомогою `parseCandorLog` та зводить з локальними позначками прочитання, отриманими через `parseCandorReadMarks`. Результат об'єднується в інбокс, де кожен запис отримує унікальний ідентифікатор. Робота з локальним станом прочитання здійснюється через `markCandorRead`, яка оновлює дані, використовуючи `parseCandorReadMarks` та `formatCandorReadMarks` для запису у `candor_read.json`.

## Публічний API

- parseCandorLog — Розбирає JSONL-лог кандору — той самий fail-safe парсинг, що
`watcher.js: parseNotificationsLog` (битий рядок пропускається, не валить лог).
- validateCandorAudacity — Кидає, якщо `audacityLevel` перевищує бюджет зухвалості мандата моделі —
той самий budget-принцип, що `trust.js`: `thresholds.audacity` (дефолт
`'low'`, той самий дефолт, що `trust.js: audacityOf`). Модель без
мандата, чи не `kind: model` — теж відхилено (кандор — акт мандата, не
будь-якого рядка тексту).
- buildCandorRecord — Будує один кандор-запис — контракт задачі M5, буквально:
`{from_model, statement, evidence_refs, created_at, audacity_level}`.
- appendCandorRecord — Дописує один кандор-запис у JSONL-лог адресата — той самий
read-append-write, що `watcher.js: appendNotifications`.
- candorId — `id` стабільний для одного кандор-запису — той самий підхід, що
`knowledge.js: makeEntryId` (композиція з полів запису, не окремий лічильник).
- aiCandor — headless-tool `ai_candor` — формує, валідує (бюджет зухвалості) і дописує
кандор-запис у лог адресата.
- parseCandorReadMarks — Розбирає локальні позначки «прочитано» (`candor_read.json`, поза git) —
той самий fail-safe парсинг, що `knowledge.js: parseKnowledgeFile`: битий
чи відсутній файл — порожній набір, не помилка.
- candorShow — Тіло `candor_show` — читає лог адресата й позначки «прочитано» ЦЬОГО
пристрою, повертає записи з доданими `id`/`read` — UI/CLI бейдж
(«N непрочитаних») рахує з `read: false`.
- markCandorRead — Тіло `candor_mark_read` — додає `id` до локальних позначок «прочитано»
ЦЬОГО пристрою (pure над уже завантаженим набором + `write` через io).
- candorLogPath — повертає шлях до файлу з логами.
- formatCandorReadMarks — перетворює позначки з candor_read.json на відформатований вигляд.

## Сценарії використання

- `delta/src/tests/candor.test.js` (candorLogPath; validateCandorAudacity — бюджет зухвалості) — .mt/candor/{handle}.jsonl — відділено від .mt/notifications; audacity_level у межах бюджету моделі — не кидає; audacity_level понад бюджет — кидає (medium-мандат не може палити high); модель без мандата — кидає; handle не kind: model (людина) — кидає; ще 7

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
