---
session: 50470634-a163-43ce-807f-17199dd3e37b
captured: 2026-06-15T20:43:12+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/50470634-a163-43ce-807f-17199dd3e37b.jsonl
---

## ADR Три тири `model_tier` у специфікації `@7n/mt` vs шість тирів у `models.mjs`

## Context and Problem Statement

У діалозі `CreateTaskDialog.vue` відображались три варіанти `model_tier` (`MIM | AVG | MAX`) відповідно до специфікації `@7n/mt`. Користувач зазначив, що класифікація має передбачати шість варіантів. Дослідження виявило, що `npm/lib/models.mjs` у пакеті `nitra/cursor` визначає окрему, розширену класифікацію з шести тирів.

## Considered Options

- Залишити три абстрактні тири з `@7n/mt`: `MIM | AVG | MAX`
- Використати шість конкретних тирів із `npm/lib/models.mjs`: `LOCAL_MIN`, `LOCAL_AVG`, `LOCAL_MAX`, `CLOUD_MIN`, `CLOUD_AVG`, `CLOUD_MAX`

## Decision Outcome

Chosen option: "Шість конкретних тирів із `models.mjs`", because `npm/lib/models.mjs` (`nitra/cursor`) визначає глобальну класифікацію моделей із шести тирів, що налаштовуються через змінні середовища (наприклад, `N_LOCAL_MIN_MODEL`), а специфікація `@7n/mt` описує лише три абстрактні рівні (`MIM | AVG | MAX`), які є підмножиною реальної інфраструктури.

### Consequences

- Good, because класифікація `LOCAL_*/CLOUD_*` розрізняє локальне та хмарне розгортання, що відповідає реальній конфігурації середовища через змінні `N_*_MODEL`.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Специфікація трьох тирів: `/Users/vitaliytv/www/nitra/task/node_modules/@7n/mt/docs/mt.md` — `model_tier: AVG # MIM | AVG | MAX`
- Шість тирів: `/Users/vitaliytv/www/nitra/cursor/npm/lib/models.mjs` — `LOCAL_MIN`, `LOCAL_AVG`, `LOCAL_MAX`, `CLOUD_MIN`, `CLOUD_AVG`, `CLOUD_MAX`
- Документація: `/Users/vitaliytv/www/nitra/cursor/npm/lib/docs/models.md`
- Змінено `app/src/components/CreateTaskDialog.vue` (git status: `M`)
- CHANGELOG: `lib/models.mjs: global model tier classification (LOCAL_MIN/AVG/MAX, CLOUD_MIN/AVG/MAX) via N_*_MODE`
