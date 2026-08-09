---
type: JS Module
title: approval.js
resource: delta/src/approval.js
docgen:
  crc: cb329abc
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min
  score: 80
  issues: internal-name:signPayload,internal-name:verifyPayload,judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль реалізує життєвий цикл об'єктів схвалень: від створення ідентифікаторів через `buildRequestId` до верифікації автентичності за допомогою `verifyApproval`. Логіка включає перевірку завершеності квізу через `quizIsComplete`, валідацію передумов через `validateApprovalPreconditions`, формування підписаних документів через `buildAndSignApproval` та їх фінальне оформлення через `formatApprovalFile`.

## Поведінка

Процес формування відповіді починається з генерації ідентифікатора запиту через `buildRequestId`. Для створення підписаного об'єкта використовується `buildAndSignApproval`, яка спочатку виконує перевірку передумов через `validateApprovalPreconditions`. Ця перевірка включає перевірку завершеності квізу за допомогою `quizIsComplete` та верифікацію відповідності посилань на рішення. Після успішної валідації формується payload, що підписується для отримання фінального об'єкта. Для збереження результату у файл `NNNN-approval.json` використовується `formatApprovalFile`. Перевірка автентичності отриманого об'єкта здійснюється через `verifyApproval`.

## Публічний API

- quizIsComplete — Квіз завершений, коли зафіксовані обидва похідні поля фіналізації
(mandates.md: «схема свідомо без passed/failed» — завершеність міряється
наявністю `iterations`/`time_to_understanding_sec`, не окремим прапорцем).
- validateApprovalPreconditions — Перевіряє переднапідписні умови — кидає з поясненням, якщо approval
писати не можна (mandates.md: «до людини не доходить run failed» —
тут навпаки, без квізу до git не доходить підпис).
- buildRequestId — Складає identity decision-request-а для `request_id` — контракт mt не
фіксує окреме поле id у фронтматері decision-request (позиція визначена
шляхом `runs/{run-id}/decisions/NNNN-...`), тому `request_id` тут —
власна композиція `{runId}/{nnnn}`, стабільна й людинозчитувана
(задокументоване рішення M1, docs/specs/260809-delta-app.md, п.5).
- buildAndSignApproval — Будує й підписує `ApprovalResponse` — єдина функція, що перевіряє інваріант
«квіз завершено» ПЕРЕД підписом (mandates.md). Підписується канонікалізований
payload БЕЗ `pubkey`/`signature` (вони додаються після підпису — інакше
підпис підписував би сам себе).
- verifyApproval — Перевіряє підписаний `ApprovalResponse` проти публічного ключа —
round-trip перевірка того самого канонічного payload, що підписувався
(без `pubkey`/`signature`).
- formatApprovalFile — Серіалізує підписаний approval у канонічний JSON-текст файлу
(`NNNN-approval.json`) — читабельний pretty-print, не канонікалізований
рядок підпису (той лишається внутрішнім для `signPayload`/`verifyPayload`).

## Сценарії використання

- `delta/src/tests/approval.test.js` (quizIsComplete; buildRequestId) — iterations + timeToUnderstandingSec присутні — завершено; null/відсутні поля — не завершено; iterations: 0 — не завершено (жодного заходу ще не було); складає request_id як runId/nnnn; без quiz_ref — кидає; ще 9

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
