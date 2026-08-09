---
type: decision-request
mandate_generation: 4
computed_owner: fable-5
escalation_chain: [fable-5, olena, vitalii]
retry_history: []
leverage_facets: { irreversible: false, blast_radius: node, divergence: low, est_cost_eur: 15 }
deadline_cost: "немає залежних задач"
recommended_by: escalation-intake-fable-5
decision_type: ops
---

## Контекст

Фікстура M3 (docs/specs/260809-delta-app.md, «Обсяг M3», п.2): розвилка в межах мандата
`fable-5` (`kind: model`, scope `ops`) — трек-рекорд деривації БЕЗ override (єдина пара
цього run-у, немає пізнішої людської відповіді).

## Варіанти

### A. Перезапустити CI job з тим самим конфігом

Наслідки: дешево, детерміновано; не виправляє першопричину, якщо вона систематична.

### B. Ескалювати до людини для розслідування

Наслідки: довше, але покриває систематичні причини.

## Рекомендація агента

Варіант A, тому що фасети низькі (est_cost_eur 15, node) — у межах мандата `fable-5`.
