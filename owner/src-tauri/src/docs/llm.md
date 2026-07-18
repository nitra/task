---
type: Rust Module
title: llm.rs
resource: owner/src-tauri/src/llm.rs
docgen:
  crc: c4f8a08b
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл надає дві тонкі `tauri::command`-обгортки для одноразових LLM-запитів через `owner-llm`: звичайний запит і ACP-запит для вказаного агента. Це окрема частина workspace crate без залежності на `tauri`, яка працює як одна з двох незалежних точок входу `llm-cascade`. Драбину ACP → local/cloud компонує JS `owner/src/composables/use-llm-cascade.js`, де вже враховано, чи дозволена ACP-підписка на цьому вузлі (`autonomy.yml`, клас `external_comms`). Для певних помилок повертає порожнє значення замість винятку.

## Поведінка

- `llm_one_shot` — запускає одноразовий LLM-запит через `owner-llm` і повертає текстову відповідь; при помилках може повертати порожнє значення замість винятку.
- `llm_one_shot_acp` — запускає одноразовий ACP-запит через `owner-llm` для вказаного агента і повертає текстову відповідь; при помилках може повертати порожнє значення замість винятку.

## Публічний API

- llm_one_shot — тонка `tauri::command`-обгортка над `owner-llm` для разового запиту в `llm-cascade`; працює як окрема точка входу без драбини ACP → local/cloud.
- llm_one_shot_acp — тонка `tauri::command`-обгортка над `owner-llm` для другої незалежної точки входу в `llm-cascade`; рішення про дозвіл ACP-підписки живе в `owner/src/composables/use-llm-cascade.js` і спирається на `autonomy.yml` та клас `external_comms`.
- Обидві функції read-only і за певних помилок повертають порожнє значення (`null`) замість винятку.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
