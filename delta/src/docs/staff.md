---
type: JS Module
title: staff.js
resource: delta/src/staff.js
docgen:
  crc: 33e2de86
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Модуль реалізує логіку формування стиснутого брифу через LLM та механізм відкату до резервних варіантів. Використовуючи `defaultStaffLlmConfig` та `buildStaffBriefPrompt`, система формує запит, який виконується через `callLlmStaffBrief`. У разі помилок мережі або збоїв виконується `fallbackStaffBrief`, що забезпечує отримання результату через `decisionBrief` або повернення порожнього значення.

## Поведінка

Процес формування брифу починається з `decisionBrief`, яка координує вибір між генерацією через LLM та використанням резервного варіанту. Для отримання конфігурації ендпоінта використовується `defaultStaffLlmConfig`, що вказує на адресу http://127.0.0.1:8080.

При спробі згенерувати бриф через мережу, `callLlmStaffBrief` використовує `buildStaffBriefPrompt` для підготовки запиту на основі вхідних даних. Якщо результат `response.json` проходить перевірку на валідність, повертається стиснутий бриф. У разі мережевих помилок або недоступності ендпоінта, `callLlmStaffBrief` повертає порожнє значення, що активує `fallbackStaffBrief`. Обидва шляхи через `decisionBrief` забезпечують однакову структуру даних, де `fallbackStaffBrief` чесно маркує відсутність стиснення.

## Публічний API

- buildStaffBriefPrompt — Формує user-промпт зі всього тіла decision-request — той самий підхід,
що `quiz.js: buildQuizPrompt`, без обраного варіанта (бриф читається ДО
вибору — допомагає обрати, не перевіряє розуміння вибраного).
- callLlmStaffBrief — Викликає локальний ендпоінт для генерації брифу. Той самий контракт
помилок, що `quiz.js: callLlmQuizGenerator` — мережева/парсингова
помилка, недоступний ендпоінт, чи невалідна форма повертає `null`, не
кидає; викликач (`decisionBrief`) переходить на структурний фолбек.
- fallbackStaffBrief — Структурний фолбек-бриф без LLM (ендпоінт недоступний) — БЕЗ стискання,
чесно позначений `compressed: false` (заголовок модуля). Немає
`strongestObjection` — `null`, той самий чесний підхід, що
`quiz.js: TEACHBACK_UNAVAILABLE_MESSAGE` (не вигадуємо те, чого не можна
вивести без LLM-судження).
- decisionBrief — Повний потік `decision_brief`: спершу LLM ({@link callLlmStaffBrief}),
недоступний — структурний фолбек ({@link fallbackStaffBrief}). Обидва
шляхи повертають однакову форму плюс `compressed` (true — LLM реально
стиснув; false — фолбек, чесно позначений).
- defaultStaffLlmConfig — надає налаштування для взаємодії з мовною моделлю персоналу, що базуються на response.json та доступні за адресою http://127.0.0.1:8080

## Сценарії використання

- `delta/src/tests/staff.test.js` (defaultStaffLlmConfig; buildStaffBriefPrompt) — той самий дефолт, що quiz.js; включає контекст, варіанти, рекомендацію, ціну затримки; валідна відповідь — generatedBy: staff-brief-<model>; мережева помилка — null, не кидає; не-2xx відповідь — null; ще 5

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
