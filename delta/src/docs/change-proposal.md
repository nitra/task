---
type: JS Module
title: change-proposal.js
resource: delta/src/change-proposal.js
docgen:
  crc: b72c0fd1
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min-retry
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл реалізує управління змінами мандата: від генерації пропозицій у форматі Markdown з описом змінених осей через `buildChangeProposalMarkdown` до запису пропозицій у файлову систему через `writeChangeProposal` та `readChangeProposal`. Система підтримує застосування рішень шляхом мутації через `applyMandateChangeProposal` або миттєвого звуження мандата через `applyMandateNarrow`. Процес включає визначення змінених рядків через `describeMandateDiffLines`, а також роботу з ідентифікаторами та директоріями через `changeProposalRunId` та `changeProposalDecisionsDir`.

## Поведінка

Процес ініціювання змін починається з формування шляхів до директорій через changeProposalRunId та changeProposalDecisionsDir. На основі вхідних даних формується markdown-текст запиту за допомогою buildChangeProposalMarkdown, де describeMandateDiffLines генерує перелік змінених осей. Результати обчислень записуються у файли через writeChangeProposal, що створює decision-request та супутній change.json. Дані для подальшої роботи можна отримати з цих файлів за допомогою readChangeProposal.

Застосування змін відбувається двома шляхами. applyMandateChangeProposal виконує мутацію після проходження квіз-конвеєра, перевіряючи підписаний відповідь на запит. applyMandateNarrow забезпечує миттєве звуження мандата через самопідпис без проходження квізу.

## Публічний API

- describeMandateDiffLines — Людиночитабельний перелік осей, що змінились між `oldMandate`/`newMandate`
— показується в тілі decision-request (## Контекст) для квізу й аудиту.
- buildChangeProposalMarkdown — Будує markdown-текст change-proposal decision-request — computed_owner
ЗАВЖДИ делегатор рівня вище (єдиний, чий підпис `validate_mandate_change`
прийме для розширення), варіанти A (застосувати)/B (відхилити).
- changeProposalRunId — Run-id change-proposal — ПЛОСКЕ імʼя `mandate-change-{changeId}`, не
вкладений сегмент `mandate-changes/{changeId}` (як буквально написано в
docs/specs/260809-delta-app.md, «Обсяг M3», п.4). **Задокументоване
відхилення від букви задачі:** і CLI-сканер (`bin/delta.mjs:
scanDecisionsDirs`), і Rust-команда (`src-tauri/src/lib.rs: scan_decisions`)
читають РІВНО один рівень вкладеності — `runs/{run-id}/decisions/`; зміна
сканера під двосегментний шлях зачепила б обидві поверхні заради самого
лише M3, ризикуючи паритетом CLI/GUI (M0 інваріант) без потреби —
плоский run-id несе ту саму інформацію (`mandate-change-{changeId}` так
само унікально ідентифікує чергу зміни) без розширення сканера.
- writeChangeProposal — Пише decision-request + сусідній `0001-change.json` (машинописний
`{old, new}` — див. заголовок модуля) у чергу делегатора.
- readChangeProposal — Читає `0001-change.json`, записаний {@link writeChangeProposal}.
- applyMandateChangeProposal — Застосовує change-proposal ПІСЛЯ того, як людина пройшла звичайний
M1/M2-конвеєр (`decision-flow.js: decisionApprove`) і підписала
`ApprovalResponse` на цьому decision-request. Це — МІСТ між двома
незалежними крипто-схемами цього застосунку: квіз-гейт підписує
`{request_id, approved, chosen_option, quiz_ref, ...}` (`approval.js`),
а `validate_mandate_change` (`mandate-change.js`) підписує окремий акт
`{old_generation, new_generation, new_file}` — той самий ФІЗИЧНИЙ ключ
пристрою підписує ОБИДВА (одна людська дія, два криптографічно незалежні
підтвердження: «я зрозуміла це рішення» + «я авторизую цю мутацію
мандата»). `chosen_option !== 'A'` (відхилено) — mandates.yaml НЕ
чіпається, повертається `{valid: false}` без спроби підпису.
- applyMandateNarrow — Звуження ШІ-мандата — «без квіза, самопідпис, одразу»
(docs/specs/260809-delta-app.md, «Обсяг M3», п.3 «Довіряю»: кнопка
«звузити»). На відміну від {@link applyMandateChangeProposal}, тут НЕМАЄ
decision-request/квіз-конвеєра — власник мандата вище підписує напряму
(той самий шлях, що `mandate-change.js`-тести «звуження із самопідписом»).
- changeProposalDecisionsDir — повертає шлях до директорії з рішеннями щодо пропозицій згідно з конфігурацією change.json.

## Сценарії використання

- `delta/src/tests/change-proposal.test.js` (describeMandateDiffLines; buildChangeProposalMarkdown / writeChangeProposal) — перелічує лише змінені осі; computed_owner === делегатор, decision_type: mandate-change, глибина форсується на standard; readChangeProposal на неіснуючий changeId — null; chosenOption A (застосувати) — mandates.yaml оновлюється, generation++; chosenOption B (відхилити) — mandates.yaml НЕ чіпається, навіть якщо квіз-гейт пройдено; ще 3

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
