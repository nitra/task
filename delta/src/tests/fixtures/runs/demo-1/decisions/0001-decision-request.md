---
type: decision-request
mandate_generation: 3
computed_owner: olena
escalation_chain: [olena, vitalii]
retry_history:
  - { agent: executor-sonnet, attempt: 1, outcome: unresolvable }
leverage_facets: { irreversible: false, blast_radius: node, divergence: low, est_cost_eur: 40 }
deadline_cost: "затримка блокує вихід design-review вузла"
recommended_by: escalation-intake-fable-5
---

## Контекст

Компонент `MandateCard.vue` дублює верстку чипів між `scope-row` і `threshold-row`. Розвилка не про
дедлайн, а про те, як саме прибрати дублікат: спільний підкомпонент чи спільний composable з рендер-функцією.

## Варіанти

### A. Виділити `MandateChipRow.vue` — спільний presentational-компонент

Наслідки: +1 файл, тести компонента лишаються прозорими; ціна — ще один рівень пропсів.

### B. Спільний composable `useChipList(items, variant)` без нового компонента

Наслідки: без нового `.vue`-файлу, але логіка форматування чипів мігрує в JS, менш очевидна для верстальника.

## Рекомендація агента

Варіант B, тому що composable лишає верстку локальною для `MandateCard.vue`, а дублювання було
в даних (мапінг chip-рядків), не в самій розмітці.
