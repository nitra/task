---
type: decision-request
mandate_generation: 2
computed_owner: olena
escalation_chain: [olena, vitalii]
retry_history: []
leverage_facets: { irreversible: false, blast_radius: node, divergence: low, est_cost_eur: 10 }
deadline_cost: "немає залежних задач"
recommended_by: escalation-intake-fable-5
---

## Контекст

Уже вирішена розвилка минулого run-а — фікстура демонструє, що закрита decision (з сусіднім
`0001-approval.json`) не потрапляє в чергу «Вирішую», навіть якщо `computed_owner` збігається.

## Варіанти

### A. Залишити старий текст EmptyState

Наслідки: коротше, але приклад формату застаріє при зміні схеми.

### B. Оновити приклад формату в EmptyState разом зі схемою

Наслідки: трохи більше правок при кожній зміні контракту, зате приклад завжди відповідає реальності.

## Рекомендація агента

Варіант B, тому що приклад формату — єдине джерело правди для нового користувача під час онбордингу.
