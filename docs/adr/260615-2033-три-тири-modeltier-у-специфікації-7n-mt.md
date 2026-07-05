---
session: 50470634-a163-43ce-807f-17199dd3e37b
captured: 2026-06-15T20:33:22+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/50470634-a163-43ce-807f-17199dd3e37b.jsonl
---

Поточна специфікація `@7n/mt` визначає лише 3 значення для `model_tier`: `MIM | AVG | MAX`. Що саме ви мали на увазі під "6 виборів типів агентів"?

---

**Transcript ends.**

## ADR Три тири `model_tier` у специфікації `@7n/mt`

## Context and Problem Statement

У UI (`CreateTaskDialog.vue`) відображається вибір `model_tier` для задачі. Виникло питання, скільки варіантів значень повинно бути в цьому виборі — 3 (MIM | AVG | MAX) або 6, як стверджував користувач.

## Considered Options

- Три тири `MIM | AVG | MAX` (поточне визначення в `@7n/mt`)
- Шість варіантів (гіпотетичне розширення, згадане користувачем, але не конкретизоване)

## Decision Outcome

Chosen option: "Три тири `MIM | AVG | MAX`", because специфікація `node_modules/@7n/mt/docs/mt.md` містить рядок `model_tier: AVG # MIM | AVG | MAX` — єдиний авторитетний перелік значень у пакеті.

### Consequences

- Good, because реалізація в `CreateTaskDialog.vue` відповідає чинній специфікації `@7n/mt`.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Специфікація: `node_modules/@7n/mt/docs/mt.md` (рядок `model_tier: AVG # MIM | AVG | MAX`)
- UI-компонент: `app/src/components/CreateTaskDialog.vue`
- Команда перевірки: `grep -r "model_tier" /Users/vitaliytv/www/nitra/task/node_modules/@7n/mt/docs/`
- Джерело 6 варіантів у transcript не конкретизовано та залишилося без відповіді.
