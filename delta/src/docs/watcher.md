---
type: JS Module
title: watcher.js
resource: delta/src/watcher.js
docgen:
  crc: b4adbbaf
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min-retry
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Система здійснює збір сповіщень через `scanForNotifications` на основі файлів у директоріях рішень, використовуючи `defaultWatcherConfig`. Вона визначає час доставки з урахуванням нічного режиму через `isQuietHours` та `applyQuietHours`. Запис історії відбувається у файл за шляхом `notificationsLogPath` з використанням `appendNotifications`, а зчитування та обробка історії виконуються через `parseNotificationsLog`. Логіка містить fail-safe гілки для обробки помилок під час `runWatcherScan`.

## Поведінка

Процес починається з повного циклу сканування через `runWatcherScan`, який збирає дані з усіх вказаних директорій рішень. На основі вмісту файлів, зокрема `NNNN-approval.json` та `approval.json`, функція `scanForNotifications` визначає необхідні сповіщення, враховуючи SLA та grace-періоди. Для кожної виявленої розвилки `applyQuietHours` розраховує час доставки: некритичні повідомлення відкладаються на кінець вікна тихої години, тоді як термінальні або критичні сповіщення отримують миттєвий час доставки.

Після формування списку сповіщень `runWatcherScan` використовує `notificationsLogPath` для визначення шляхів до логів кожного адресата. Результати записуються через `appendNotifications`, що забезпечує атомарне дописування в JSONL-файли. Для роботи з історією або відновлення стану застосунок використовує `parseNotificationsLog`, який ігнорує пошкоджені рядки, зберігаючи цілісність усього логу. Налаштування за замовчуванням для процесів контролю часу надаються через `defaultWatcherConfig`, а логіка перевірки нічних вікон базується на `isQuietHours`.

## Публічний API

- scanForNotifications — Сканує усі decisions-директорії й будує список нотифікацій за SLA/grace —
pure-функція (не пише лог сама, `now`/`config` завжди явно ін'єктовані —
тестовність, той самий підхід, що весь застосунок з M2).
- isQuietHours — Чи `now` потрапляє у вікно тихої години `{start, end}` (`"HH:MM"`,
пристрій-конфіг застосунку) — підтримує нічне вікно, що перетинає
північ (`start > end`, напр. `20:00–09:00`).
- applyQuietHours — Проставляє `deliverAt` на кожну нотифікацію за правилом тихої години
(M4, докладніше — заголовок модуля): некритична нотифікація, згенерована
в тиху годину, відкладається до кінця вікна; критична (irreversible З
дедлайном) чи згенерована поза тихою годиною — доставляється негайно
(`deliverAt === now`).
- parseNotificationsLog — Розбирає JSONL-лог нотифікацій — порожні/биті рядки мовчки пропускаються
(той самий fail-safe інваріант, що `device-registry.js`/`knowledge.js`
парсери: один битий рядок не має валити весь лог).
- appendNotifications — Дописує нотифікації в JSONL-лог `handle` — read-append-write через
генеричний `{readFile, writeFile}`-io (той самий транспорт, що
decision-flow.js/quorum.js; жодних нових Tauri-команд, GUI має
`read_text_file`/`write_text_file` вже з M1).
- runWatcherScan — Повний прогін watcher-а — скан → тиха година → дописування в лог
КОЖНОГО адресата (`to`-handle нотифікації, не обовʼязково той самий, хто
викликав скан: `runWatcherScan` — headless-актор, пише в чужі логи, той
самий інваріант, що mandates.md: «watcher — актор процесу»). Єдина
точка входу, спільна для `watcher_scan` tool (CLI/GUI) і headless
`bin/delta-watcher.mjs`.
- defaultWatcherConfig — повертає налаштування для відстеження змін у файлах, що базуються на NNNN-approval.json та approval.json
- notificationsLogPath — визначає шлях до файлу з журналом сповіщень

## Сценарії використання

- `delta/src/tests/watcher.test.js` (scanForNotifications — solo-рішення; scanForNotifications — кворумні (irreversible) рішення) — відкрите рішення молодше за SLA — жодної нотифікації; старше за SLA (24h), молодше за SLA+grace (48h) — пінг лише виконавцю; старше за SLA+grace (48h) — ескалація власнику + прозора копія виконавцю, ОБИДВІ ПІСЛЯ пінгу; вже закрите рішення (сусідній approval.json) — жодної нотифікації; немає opened_at — вік невідомий, watcher свідомо НЕ пінгує (fail-safe); ще 19

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
