---
type: decision-request
mandate_generation: 4
computed_owner: vitalii
escalation_chain: [vitalii]
retry_history: []
leverage_facets: { irreversible: true, blast_radius: repo, divergence: high, est_cost_eur: 5000 }
deadline_cost: "постачальник чекає підтвердження до кінця тижня"
recommended_by: escalation-intake-fable-5
decision_type: architecture
approvers: [olena, vitalii]
opened_at: "2026-08-01T09:00:00.000Z"
---

## Контекст

Фікстура M4: irreversible-рішення (видалення production-бази постачальника
без бекапу) — вимагає кворуму ДВОХ approvers (`olena`, `vitalii`), кожен
власним пристроєм/ключем, кожен власним квізом.

## Варіанти

### A. Видалити базу постачальника назавжди

Наслідки: звільняє контракт, дію не можна скасувати.

### B. Лишити базу — розірвати контракт без видалення даних

Наслідки: дорожче (зберігання), але оборотно.

## Рекомендація агента

Варіант A, тому що контракт і так закінчився — але це незворотна дія,
тому потрібен кворум обох власників.
