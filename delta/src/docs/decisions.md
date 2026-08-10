---
type: JS Module
title: decisions.js
resource: delta/src/decisions.js
docgen:
  crc: eb54c09b
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 50
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

/**
 * Парсер `decisions/NNNN-decision-request.md` за контрактом mt:
 * mt/docs/architecture/mandates.md, секція «Артефакт decision-request», і
 * «Нормативний контракт (M6 фаза 0)» (частина PR #67, злита в origin/main mt
 * після написання specs/260809-delta-app.md — delta мокає за контрактом,
 * mt-rust реалізує mandate-crate паралельно, рішення Ж).
 *
 * M1 — файловий мок git-refs транспорту: замість читання
 * `refs/mt/runs/{run-id}/decisions/NNNN-decision-request.md` напряму з git
 * (це прийде з mt-rust/napi), скануємо ту саму структуру директорій на
 * диску — `<mandatesDir>/runs/{run-id}/decisions/NNNN-decision-request.md`.
 * Дерево директорій навмисно дзеркалить контрактний git-шлях (той самий
 * сегмент `decisions/NNNN-*`), щоб заміна на napi-виклик мандат-крейта
 * пізніше не міняла форму виходу цього мод

## Публічний API

- splitFrontmatter — Розбиває markdown-файл на YAML-фронтматер (обʼєкт) і тіло (рядок).
Файл без валідного фронтматера — фронтматер `{}`, усе тіло як є (не кидає).
- parseDecisionRequest — Розбирає текст одного `NNNN-decision-request.md` у нормалізований обʼєкт.
- requiresQuorum — Чи рішення вимагає мультипартійного підпису (кворуму) — M4, docs/specs/
260809-delta-app.md, «Обсяг M4», п.2: КОЖНЕ irreversible-рішення (не лише
широкий blast_radius) підписують УСІ `approvers`, кожен ВЛАСНИМ квізом
(`quorum.js`), а не єдиний computed_owner звичайним M1/M2-конвеєром.
- resolveApprovers — Список handle-ів, чиї підписи потрібні для закриття irreversible-рішення
— фронтматер `approvers: [...]`, або фолбек `[computedOwner]` (мок без
явного поля — одноосібний підписант, той самий владник, що обчислив
маршрутизатор ескалацій).
- deriveQuorumStatus — Деривує стан кворуму irreversible-рішення зі скановних файлів сусідньої
decisions-директорії (`NNNN-approval-{handle}.json` на кожного
підписанта) — pure-функція, не читає диск сама (той самий підхід, що
`isOpen` нижче): викликач (`deriveQueue`/`quorum.js: loadQuorumStatus`)
дає вже скановану карту імʼя→вміст.

Статуси: `'pending'` — не всі підписали (звичайний прогрес, штатний
стан); `'closed'` — усі підписали З ОДНАКОВИМ `chosen_option` (рішення
закрите); `'diverged'` — усі підписали, але `chosen_option` розійшовся —
«розбіжність кворуму» (mandates.md: чесний стан, без автоматичної
авторезолюції — рішення лишається відкритим).
- depthForFacets — Мапить leverage-фасети на глибину квіз-гейта — контрактне вирівнювання з
таблицею режимів маршрутизатора ескалацій (mandates.md, «Крок 3, режим»):

| Режим (mandates.md)      | Умова                                  | Глибина квіз-гейта |
| ------------------------ | --------------------------------------- | ------------------- |
| ask-and-wait              | `irreversible` АБО широкий blast_radius | `teach-back` (M5)   |
| decide-and-inform         | середні фасети **і лише** reversible    | `standard` (M2)     |
| local/agent                | низькі фасети                          | `one-tap` (M1)      |

«Середні фасети» — робоче визначення M2 (задокументоване тут, не
підписана політика `mandates.yaml`, якої ще не існує — M3+ переносить цю
таблицю в мандат-крейт mt-rust): blast_radius `subtree`, АБО divergence
`medium`/`high`, АБО `est_cost_eur` ≥ {@link NOTABLE_COST_EUR_THRESHOLD}.
Будь-який один із трьох фасетів достатній — вони декларативно незалежні
(mandates.md: «схлопнутий score неможливо оскаржити по частинах»).
- deriveQueue — Деривує чергу «Вирішую» одного власника: відкриті decision-request-и, чий
`computed_owner` == `handle` (одноосібний M1/M2-шлях), або, для
irreversible-рішень, чий `handle` входить до `approvers` і кворум ще не
закритий одноголосно (M4 — {@link quorumQueueItem}) — відсортовані за
leverage-фасетами (спека docs/specs/260809-delta-app.md, п.2 «Обсяг M1»,
п.2 «Обсяг M4»).
  скановані `decisions/`-директорії (кожна — один run), як повертає
  Tauri-команда `scan_decisions`/CLI-скан файлової системи
  перенаправлення (`kill-switch.js: buildKillSwitchRedirect().redirect`) — опційно, відсутність
  зберігає точну поведінку до M6 (жодного перенаправлення)

## Сценарії використання

- `delta/src/tests/decisions.test.js` (splitFrontmatter; parseDecisionRequest) — розбиває markdown на фронтматер-обʼєкт і тіло; файл без фронтматера — порожній обʼєкт, усе тіло як є; невалідний YAML у фронтматері кидає зрозумілу помилку; розбирає фронтматер фікстури 0001 у нормалізовану camelCase-форму; нормалізує leverage_facets із дефолтами для відсутніх полів; ще 35

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
