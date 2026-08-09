---
type: JS Module
title: ai-petition.js
resource: delta/src/ai-petition.js
docgen:
  crc: 079ee1b8
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль дозволяє створювати петиції: від генерації тексту на основі трек-рекорду через buildEvidenceText до формування даних через buildPetitionPayload. Система забезпечує підпис сформованого набору даних за допомогою signPetition, перевірку цілісності через verifyPetition та форматування результату через formatPetitionFile. Для інтеграції з ШІ доступна функція aiPetition.

## Поведінка

Процес формування петиції починається з генерації тексту на основі трек-рекорду моделі за допомогою buildEvidenceText. Сформований текст та дані про стан мандатів використовуються у buildPetitionPayload для створення канонічного набору даних. Далі signPetition підписує отриманий payload ключем пристрою, а результат перевіряється через verifyPetition для забезпечення цілісності. Для візуального представлення використовується formatPetitionFile. Повний автоматизований цикл aiPetition об'єднує ці кроки: вона формує, підписує та записує петицію у файл, створюючи супутні файли для decision-request у робочій директорії згідно з конфігами, на які спирається код, зокрема petition.json.

## Публічний API

- buildEvidenceText — Формує людиночитабельний evidence-текст із трек-рекорду моделі —
«ЧЕСНІСТЬ» інваріант track-record.js: буквально каже «активність і
послідовність», уникає слів «якість»/«успішність».
- buildPetitionPayload — Canonical payload петиції — підписується ЛИШЕ модельним ключем.
- signPetition — Підписує петицію модельним ключем пристрою.
- verifyPetition — Перевіряє підписану петицію проти власного `pubkey` — round-trip, той
самий шлях, що `approval.js: verifyApproval`.
- aiPetition — Headless-tool `ai_petition`: формує й підписує петицію модельним ключем,
пише її поруч із change-proposal decision-request у чергу делегатора
(`change-proposal.js: writeChangeProposal`) — САМ decision-request
лишається непідписаним, у чергу людини він потрапляє як звичайна
розвилка (`decisions.js: deriveQueue` бачить його за `computed_owner`).
- formatPetitionFile — перетворює вміст файлу на відповідний формат згідно з правилами petition.json

## Сценарії використання

- `delta/src/tests/ai-petition.test.js` (buildEvidenceText — «активність і послідовність», не success rate; aiPetition) — нуль рішень — чесний текст про відсутність evidence; є рішення — текст явно НЕ каже; пише петицію (підписану модельним ключем) і change-proposal decision-request у чергу делегатора; петиція НЕ підписує саму зміну — decision-request лишається непідписаним approval.json; pretty-print JSON з кінцевим переносом рядка

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
