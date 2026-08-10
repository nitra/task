---
type: JS Module
title: quorum.js
resource: delta/src/quorum.js
docgen:
  crc: b4d1c7cd
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min-retry
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Використовує `quorumQuiz` для ініціації перевірки та `submitQuorumAnswer` для передачі відповідей у форматі JSON. Статус кворуму визначається через `quorumApprove` та перевіряється за допомогою `loadQuorumStatus`.

## Поведінка

Процес реалізації кворуму починається з отримання підказки-промпту через quorumQuiz, що генерує індивідуальний квіз для підписанта. Користувач надає відповідь через submitQuorumAnswer, яка оцінює переказ змісту своїми словами. Після успішного проходження квізу виконується quorumApprove, що завершує процес для конкретного підписанта шляхом створення NNNN-approval.json. Кожен підписант діє незалежно, а фінальний стан рішення визначається через loadQuorumStatus, який збирає дані з усіх наявних файлів підтвердження для обчислення статусу кворуму.

## Публічний API

- quorumQuiz — Генерує (перший виклик) або показує (повторний) підказку-промпт
ВЛАСНОГО teach-back-квізу одного підписанта — `quorum_quiz`, per-signer
дзеркало `decision-flow.js: decisionQuizTeachBack` (M5).
`chosenOption`/`llmConfig`/`fetchImpl` — прийняті, але НЕ використані:
teach-back не має питання для генерації (лише підказка-промпт), той самий
контракт входу, що `quorum_approve`/`decision_quiz`, для інтерфейсної
симетрії з Q&A-глибинами.
- submitQuorumAnswer — Проводить teach-back-спробу ВЛАСНОГО квізу одного підписанта — per-signer
дзеркало `decision-flow.js: submitTeachBack` (M5); та сама ЧЕСНА відмова
(`available: false`, {@link TEACHBACK_UNAVAILABLE_MESSAGE}), коли локальна
модель недоступна — нічого не пишеться, спроба не рахується.
- quorumApprove — Повний потік `quorum_approve`: проводить квіз-відповідь власного квізу
підписанта, і лише коли ВІН здав його повністю — підписує й пише
`NNNN-approval-{handle}.json`. Не зачіпає інших approvers — кожен
підписант незалежний, кворум закривається лише коли ВСІ підписали з
ОДНАКОВИМ `chosen_option` ({@link import('./decisions.js').deriveQuorumStatus}).
- loadQuorumStatus — Точковий запит стану кворуму одного рішення — `quorum_status` tool,
читає лише approval-файли `approvers` (без повного сканування
decisions-директорії) і делегує обчислення {@link import('./decisions.js').deriveQuorumStatus}
(та сама логіка, що `deriveQueue` використовує зі сканованих даних —
єдине джерело правди для статусу «pending/closed/diverged»).

## Сценарії використання

- `delta/src/tests/quorum.test.js` (quorumQuiz; submitQuorumAnswer / quorumApprove — повний цикл одного підписанта (teach-back, M5)) — кидає для НЕ-irreversible decision-request — кворум лише для irreversible; кидає, коли signerHandle не входить до approvers; перший виклик пише ВЛАСНИЙ teach-back-квіз-файл підписанта (depth: teach-back, M5); повторний виклик показує ТУ САМУ підказку без повторної генерації; два підписанти отримують НЕЗАЛЕЖНІ teach-back-файли одного decision-request; ще 8

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
