---
type: decision-request
mandate_generation: 3
computed_owner: olena
escalation_chain: [olena, vitalii]
retry_history: []
leverage_facets: { irreversible: false, blast_radius: node, divergence: low, est_cost_eur: 20 }
deadline_cost: "немає залежних задач"
recommended_by: escalation-intake-fable-5
decision_type: ops
opened_at: "2026-07-01T09:00:00.000Z"
---

## Контекст

Фікстура M5 (docs/specs/260809-delta-app.md, «Обсяг M5», п.4/5): рутинна ops-розвилка, яку `olena` систематично
відкладає (`opened_at` у минулому, старша за поріг дрейфу) — демонструє детектор дрейфу і подальше делегування
моделі `fable-5` (mandates.yaml: `scope.decision_types: [ops]`, `escalates_to: olena`).

## Варіанти

### A. Перезапустити CI job з тим самим конфігом

Наслідки: дешево, детерміновано.

### B. Ескалювати до людини для розслідування

Наслідки: довше, покриває систематичні причини.

## Рекомендація агента

Варіант A, тому що фасети низькі — рутинна дія в межах мандата `fable-5`.
