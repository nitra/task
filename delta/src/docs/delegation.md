---
type: JS Module
title: delegation.js
resource: delta/src/delegation.js
docgen:
  crc: 9a5edf22
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min
  score: 85
  issues: anchor-miss:NNNN-approval.json,surzhik,judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл реалізує процес формування підписаних записів про делегування через інтерактивний квіз та перевірку відповідності мандатам. Він дозволяє знайти придатні моделі за допомогою `findEligibleModel`, провести опитування через `delegationQuiz` та `submitDelegationAnswer`, а також сформувати підписані файли за допомогою `buildAndSignDelegation`, `formatDelegationFile` та `delegateDecision`.

## Поведінка

Процес делегування починається з пошуку відповідної моделі через findEligibleModel, яка визначає придатність за мандатами та типом рішення. Для ініціації процесу використовується delegationQuiz, що створює мета-питання, а при спробах відповісти через submitDelegationAnswer відбувається перевірка правильності та ітерацій. Якщо відповідь правильна, buildAndSignDelegation формує підписаний запис, що включає дані про сторони та посилання на квіз. Результат обробляється через formatDelegationFile для отримання фінального вигляду, а повний цикл завершується через delegateDecision, яка координує перевірку статусу рішення, проходження квізу та запис підписаного файлу NNNN-delegation.json.

## Публічний API

- findEligibleModel — Модель з мандатом, чий scope покриває `decisionType`, серед моделей ПІД
відповідальністю `delegatorHandle` (`escalates_to === delegatorHandle`,
директорська модель — делегувати можна лише СВОЮ модель, не будь-яку
модель у карті). `scope.decision_types` містить `decisionType` буквально,
або `'*'` (той самий wildcard-підхід, що фікстура `mandates.yaml`
README: `decision_types: ["*"]` на кореневому мандаті).
- delegationQuiz — Генерує (перший виклик) або показує (повторний) активне one-tap
мета-питання делегування — `delegation_quiz` tool.
- submitDelegationAnswer — Проводить спробу one-tap мета-квізу делегування — той самий «фейл ≠
покарання» інваріант, що Q&A-квізи `quiz.js` (нова спроба того самого
питання, `iterations++`, ЖОДНОГО підпису без правильної відповіді).
- buildAndSignDelegation — Будує й підписує делегація-запис — той самий канонікалізований
payload-підхід, що `approval.js: buildAndSignApproval`/`quorum.js:
buildAndSignQuorumApproval` (`signing.js: signPayload`), контракт задачі
M5, буквально: `{delegated_to, delegated_by, signed_at, pubkey,
signature, quiz_ref}`.
- delegateDecision — Повний потік `decision_delegate`: проводить one-tap мета-квіз, і лише
коли здано правильно — підписує й пише `NNNN-delegation.json`. Кидає,
якщо рішення вже закрите (approval) чи вже делеговано (термінальні акти
того самого рангу, що `assertDecisionOpen` у `decision-flow.js`).
- formatDelegationFile — формує структуру файлу делегування на основі NNNN-delegation.json та approval.json.

## Сценарії використання

- `delta/src/tests/delegation.test.js` (findEligibleModel; delegationQuiz / submitDelegationAnswer — one-tap мета-квіз, детермінований (без LLM)) — модель з мандатом під тим самим делегатором, чий scope покриває decisionType; немає покриття (decisionType поза scope) — null; модель під ІНШИМ делегатором не повертається (директорська відповідальність — лише СВОЯ модель); перший виклик пише one-tap квіз-файл (depth: one-tap); повторний виклик показує ТЕ САМЕ питання без регенерації; ще 7

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
