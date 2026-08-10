---
type: decision-request
mandate_generation: 3
computed_owner: vitalii
escalation_chain: [vitalii]
retry_history: []
leverage_facets: { irreversible: false, blast_radius: subtree, divergence: medium, est_cost_eur: 150 }
deadline_cost: "блокує 1 залежну задачу — низький пріоритет"
recommended_by: escalation-intake-fable-5
decision_type: process
---

## Контекст

CLI-паритет M0 читає `mandates_dir`/`identity` із конфігу за замовчуванням лише для `mandates_show`.
Питання — чи поширювати той самий дефолт на нові M1-тули (`decisions_show` тощо), чи вимагати явний `--dir` завжди.

## Варіанти

### A. Поширити дефолт конфігу на всі нові тули

Наслідки: коротші CLI-виклики в демо, але неявна залежність від локального стану під час скриптів/CI.

### B. Вимагати явний `mandatesDir` для всіх нових тулів, дефолт лишити лише в `mandates_show`

Наслідки: довші виклики, зате скрипти детерміновані незалежно від локального конфігу машини.

## Рекомендація агента

Варіант A, тому що M1 — усе ще інтерактивне демо для ~20 людей, а не CI-скрипти; консистентність з
уже наявним `mandates_show` важливіша за строгість.
