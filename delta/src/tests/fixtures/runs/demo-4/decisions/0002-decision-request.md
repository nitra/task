---
type: decision-request
mandate_generation: 4
computed_owner: olena
escalation_chain: [olena, vitalii]
retry_history: []
leverage_facets: { irreversible: false, blast_radius: node, divergence: low, est_cost_eur: 25 }
deadline_cost: "немає залежних задач"
recommended_by: escalation-intake-fable-5
decision_type: ops
---

## Контекст

Фікстура M3: людське рішення в тому самому run-і, що `0001` (`fable-5`), пізніше за часом
(`signed_at`) і з протилежним `chosen_option` — за спрощенням `track-record.js` це рахується
як override model-рішення `0001` цього run-у.

## Варіанти

### A. Перезапустити CI job з тим самим конфігом

Наслідки: не виправляє першопричину.

### B. Розслідувати першопричину замість перезапуску

Наслідки: довше, але зупиняє повторювані флейки.

## Рекомендація агента

Варіант A, тому що дешевше.
