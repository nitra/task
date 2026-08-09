---
type: decision-request
mandate_generation: 3
computed_owner: olena
escalation_chain: [olena, vitalii]
retry_history: []
leverage_facets: { irreversible: false, blast_radius: company, divergence: high, est_cost_eur: 3000 }
deadline_cost: "затримка блокує оголошення на весь колектив"
recommended_by: escalation-intake-fable-5
decision_type: process
---

## Контекст

Фікстура M5 (docs/specs/260809-delta-app.md, «Обсяг M5», п.1): рішення з широким `blast_radius: company`, але
`irreversible: false` — одноосібний шлях (`decision-flow.js`, НЕ кворум `quorum.js`, який застосовується лише
до `irreversible: true`), `depthForFacets` мапить широкий `blast_radius` на `teach-back` незалежно від
`irreversible` (mandates.md, «Крок 3»: `ask-and-wait` — «високі фасети АБО irreversible»).

## Варіанти

### A. Перейти на чотириденний робочий тиждень для всієї команди

Наслідки: вища залученість, але потрібно узгодити зі всіма клієнтськими SLA — ризик недотримання дедлайнів
на перехідний період.

### B. Лишити пʼятиденний тиждень, компенсувати гнучким графіком

Наслідки: без ризику для SLA, але не відповідає запиту команди на скорочення робочого часу.

## Рекомендація агента

Варіант A, тому що дослідження команди (лютий 2026) показало стійке падіння продуктивності п'ятниці
без відповідного падіння задач — гнучкий графік уже випробувано і не дав ефекту.
