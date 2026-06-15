# Контракт «headless-actions»: рівень паритету фронтенд ↔ LLM ↔ CLI

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

У проєкті `task` (Tauri v2) всі дії доступні лише через Quasar-фронтенд: LLM і CLI не мали способу виконати ті самі дії без відкритого UI — логіка розсіяна по компонентах. Виникла потреба зробити набір бекенд-дій досяжним з трьох точок як MVP-правило і як майбутнє правило `n-headless` пакунку `@nitra/cursor`.

## Considered Options

- Єдиний диспетч-шар (`dispatch(Command)`) — один enum у крейті / JS-модулі, з якого деривуються CLI, Tauri IPC і LLM tool-definitions
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Єдиний спільний бекенд-шар (headless-actions)", because користувач продиктував принцип: «бекенд спільний; виклик з фронтенду, CLI і LLM — три адаптери над одним шаром». Закладається як чернетка правила `n-headless` для `@nitra/cursor`.

### Consequences

- Good, because фронтенд перестає бути єдиними дверима — LLM виконує ті самі операції headless.
- Good, because одне джерело схем для CLI-help, LLM tool-definitions і фронтенду; нова дія реєструється один раз.
- Bad, because відкриті рішення (набір дій, модель LLM) лишилися непідтвердженими до кінця сесії; MVP має показати feasibility перед фіксацією.

## More Information

- Чернетка правила та MVP-план: `docs/specs/260614-n-headless-actions.md`
- Архітектура: `dispatch(Command)` у `mt-scanner`; `mt-scanner schema` — маніфест tools у форматі Anthropic tool-use; `mt-scanner exec '<json>'` — машинний режим CLI; Tauri `invoke('dispatch', {command})` — IPC для UI і LLM-bridge
- MVP: 3 дії (`scan`, `workspaces`, `create`), Action Layer у `app/src/actions/`, CLI `app/bin/task.mjs`, рефактор `TaskGraph.vue` / `CreateTaskDialog.vue` на `dispatch(name, input)`
- Виправлення `jscpd` в сесії: `**/gen/schemas/**`, `.cursor/skills/**`, `.pi/skills/**` додано до `ignore` у `.jscpd.json`; `lint-js` → exit 0

## Update 2026-06-14

### Уточнення: JS-логіка може залишатися на фронтенді

Мета headless-actions — не перенести логіку на бекенд, а організувати її як **іменовані виклики**: JS-логіка може лишатися у фронтенді, якщо вона зареєстрована у каталозі Action Layer. Handler реєструється один раз (Rust чи JS) і автоматично стає доступним з UI, CLI і LLM-тулу.

MVP Action Layer: `app/src/actions/`; CLI-бінарник: `app/bin/task.mjs`; рефактор `TaskGraph.vue` / `CreateTaskDialog.vue` — виклик `dispatch(name, input)` замість прямих `invoke()`.
