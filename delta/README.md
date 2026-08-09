# delta

Референс-реалізація фреймворку «Дельта» — спека
[`docs/specs/260809-delta-app.md`](../docs/specs/260809-delta-app.md). Одиниця інтерфейсу — **мандат**, не задача
(`app`) і не рішення в черзі (`owner`): застосунок показує межу твоїх повноважень, деривовану з `.mt/mandates.yaml`
(схема — mt: `docs/architecture/mandates.md`).

## M0 — скелет + карта мандатів read-only

Поточний мілстоун (демо-критерій: відкрити застосунок двом користувачам — кожен бачить свій зріз; `delta
mandates_show` дає те саме в CLI):

- Tauri 2 + Vue 3 + Quasar скаффолд (порт 1440, `com.nitra.delta`, акцент teal).
- Мок-парсер `.mt/mandates.yaml` (`src/mandates.js`) за контрактом mt — читання, нормалізація, деривації: мій
  мандат за handle, ланцюг ескалації, ШІ-мандати (`kind: model`). Буде замінений napi-викликами mandate-crate з
  mt-rust, коли контракт (M6 фаза 0) зафіксується в специфікації `@7n/mt`.
- Ідентичність (handle) і шлях до воркспейсу — локальний конфіг застосунку (PII поза git), той самий підхід, що
  `owner` (whoami/set_identity).
- UI «Карта мандатів»: мій мандат (підсвічений), ШІ-мандати окремою секцією, уся карта, ланцюг ескалації,
  доброзичливий empty state з поясненням формату — read-only, без редагування.
- CLI-паритет: `bin/delta.mjs` з tools `whoami`, `set_identity`, `mandates_dir`, `set_mandates_dir`,
  `mandates_show` — той самий каталог (`src/tool/catalog.js`) і той самий мок-парсер, що GUI.

## M1 — черга «Вирішую», квіз-гейт (one-tap), підпис Ed25519

Демо-критерій: підписати рішення; git log показує пару `decision-request` + `quiz` + підпис; без квізу підпис
неможливий. M1 реалізує лише `depth: one-tap` — `standard`/`teach-back` лишаються M2.

- **Decision-request-парсер** (`src/decisions.js`) — файловий мок git-refs транспорту
  `refs/mt/runs/{run-id}/decisions/NNNN-decision-request.md` (mt: `docs/architecture/mandates.md`, «Артефакт
  decision-request»): скануємо `<mandatesDir>/runs/{run-id}/decisions/NNNN-decision-request.md` на диску —
  структура директорій дзеркалить контрактний git-шлях, поки git-refs транспорт не прийде з mt-rust.
- **Черга «Вирішую»** (`deriveQueue`) — відкриті decision-request-и (немає сусіднього `NNNN-approval.json`), чий
  `computed_owner` == мій handle, відсортовані за leverage-фасетами (`irreversible`/ширший `blast_radius` — вище).
- **Квіз-генератор one-tap** (`src/quiz.js`) — джерело питання: локальний OpenAI-сумісний ендпоінт (дефолт
  `http://127.0.0.1:8080`, модель `gemma-4-26b-a4b-it` — конфіг у `config.json`, не константа); ендпоінт
  недоступний → детермінований фолбек, зібраний із самих варіантів decision-request (`generated_by:
  quiz-gen-fallback`). Квіз ніколи не пропускається; `generated_by` завжди ≠ `recommended_by` decision-request.
- **Квіз-файл** `NNNN-quiz.md` (`src/quiz.js`: `formatQuizFile`/`parseQuizFile`) — точний контрактний формат:
  `schema_version: 1` першим полем, `depth`, `iterations`, `time_to_understanding_sec`; без полів `passed`/`failed`
  («фейл ≠ покарання» — неправильна відповідь дописує «Питання 1 (спроба N)» з мікроуроком, той самий номер
  питання).
- **Підпис Ed25519** (`src/signing.js`) — ключ пристрою генерується Web Crypto (`crypto.subtle`, `'Ed25519'`) при
  першому підписі, зберігається в `device_key.json` поряд із `config.json` (поза git; приватний ключ ніколи в
  репо). `src/approval.js: buildAndSignApproval` перевіряє інваріант «квіз завершено» ДО підпису — без
  `iterations`/`time_to_understanding_sec` підпис кидає, не пишеться.
- **`NNNN-approval.json`** поруч із decision-request: `{ schema_version, request_id, approved, chosen_option,
  quiz_ref, signed_at, pubkey, signature }`.
- **UI «Вирішую»** (нова вкладка поряд із «Карта мандатів») — картка розвилки (`DecisionCard.vue`): контекст,
  варіанти, рекомендація агента, deadline_cost, фасети → вибір варіанта → one-tap квіз-картка → підпис.
- **CLI-паритет**: `decisions_show`, `decision_quiz`, `decision_approve`, `device_pubkey`, `llm_config`/
  `set_llm_config` — той самий `src/decision-flow.js`, що GUI.

### Demo-послідовність

```bash
cd delta
export DELTA_CONFIG_PATH=/tmp/delta-demo/config.json   # ізольований конфіг для демо

# 1. Створити runs/demo-1/decisions/0001-decision-request.md з фікстури
mkdir -p /tmp/delta-demo/runs/demo-1/decisions
cp src/tests/fixtures/runs/demo-1/decisions/0001-decision-request.md /tmp/delta-demo/runs/demo-1/decisions/

# 2. Онбординг — ідентичність і шлях до воркспейсу
bun bin/delta.mjs set_identity '{"handle":"olena"}'
bun bin/delta.mjs set_mandates_dir '{"dir":"/tmp/delta-demo"}'

# 3. decisions_show — відкрита розвилка «olena» у черзі
bun bin/delta.mjs decisions_show '{}'

# 4. decision_quiz — генерує one-tap питання (фолбек, якщо LLM-ендпоінт недоступний), пише чернетку NNNN-quiz.md
bun bin/delta.mjs decision_quiz '{"runId":"demo-1","nnnn":"0001","chosenOption":"B"}'

# 5. decision_approve — неправильна відповідь: мікроурок, iterations++, approval НЕ пишеться
bun bin/delta.mjs decision_approve '{"runId":"demo-1","nnnn":"0001","chosenOption":"B","answer":0}'

# 6. decision_approve — правильна відповідь: фіналізує квіз, пише підписаний NNNN-approval.json
bun bin/delta.mjs decision_approve '{"runId":"demo-1","nnnn":"0001","chosenOption":"B","answer":1}'

# 7. git-log-подібна пара — decision-request + quiz + approval поруч у decisions/
ls /tmp/delta-demo/runs/demo-1/decisions/
# 0001-decision-request.md  0001-quiz.md  0001-approval.json

# 8. Черга знову порожня — розвилка закрита
bun bin/delta.mjs decisions_show '{}'
```

## M2 — навчальний квіз: мікроуроки, навчальний режим, база знань, spaced repetition, depth: standard

Демо-критерій: фейл квізу → розгортання контексту → повторне питання → мікроурок ліг в особисту базу знань
(докладніше — `docs/specs/260809-delta-app.md`, «Обсяг M2»).

- **Мікроурок — завжди, не лише на фейлі.** `decision_quiz`/`decision_approve` повертають `microlesson` після
  БУДЬ-якої відповіді (правильної теж — M1 показувала лише після неправильної), «у момент максимальної уваги»
  (конституція п.2). Генерується LLM разом із питанням; у фолбек-режимі — детермінований з полів decision-request
  (`generated_by: quiz-gen-fallback` чесно позначає джерело).
- **Навчальний режим при фейлі («право на глибину»)** — `src/decision-flow.js: submitQuizAnswer` повертає поле
  `explain`: розгортання decision-request шар за шаром, КУМУЛЯТИВНО з кожним наступним фейлом того самого
  питання — 1-й фейл `## Контекст`; 2-й — і контекст, і наслідки всіх варіантів; 3-й+ — і те, і те, і
  `## Рекомендація агента` з обґрунтуванням. Повторне питання після кожного шару — те саме формулювання, або
  перефразоване LLM-ом через `rephraseQuestion` (best-effort — options/правильна відповідь НІКОЛИ не міняються
  перефразуванням), коли ендпоінт живий.
- **Особиста база знань** (`src/knowledge.js`) — локальне сховище ПОЗА git, файл-сусід `config.json`/
  `device_key.json` (`knowledge.json`, той самий рівень приватності, що ключ пристрою: «що про мене знає
  система» бачиш лише ти, конституція п.9). Кожен ПОВНІСТЮ завершений квіз дописує запис `{decisionRef, domain,
  question, options, correctAnswer, microlesson, iterations, timeToUnderstandingSec, completedAt, intervalDays,
  lastRepeatedAt}` — домен береться з `decision_type` фронтматера decision-request (власне розширення M2, `null`
  → `'general'`). Деривації: `domainDigest` (конспект по доменах — «що я зрозумів, підписуючи»), приватний тренд
  `timeToUnderstandingTrend` (метрика №3 спеки: тренд вниз = навчальна функція квізів працює; <2 записів домену —
  чесний статус `insufficient-data`, не вигаданий «flat»). UI: вкладка «Знання» (конспект + тренд простим списком/
  числами, без чартів); CLI: `knowledge_show`.
- **Spaced repetition на живих рішеннях** (п.5 конституції) — генератор квізу для НОВОЇ розвилки `depth: one-tap`
  підмішує (як друге питання, позначене «Питання 2 (повторення)» у квіз-файлі) повторення знання з бази, чий
  інтервал настав: драбинка **1 → 3 → 7 → 21 днів** від `completedAt`/`lastRepeatedAt`, домен має збігатися з
  доменом нової розвилки. Немає давнього дозрілого знання в домені — квіз лишається одним питанням (штатний, не
  винятковий шлях). Правильна відповідь на повторення просуває драбинку; неправильна скидає до 1 дня (фейл ≠
  покарання — коротший інтервал, не виключення з бази). `standard`/spaced-repetition свідомо НЕ стекуються в M2
  (задокументоване рішення обсягу — уникає комбінаторного вибуху UX у першій ітерації).
- **`depth: standard`** — другий рівень глибини за контрактом (mandates.md, «Крок 3»: decide-and-inform —
  середні leverage-фасети **і лише** reversible): 2 питання про саму розвилку (без переказу — teach-back
  лишається M5), обидва мають бути здані правильно, перш ніж підпис стане доступним. `depthForFacets`
  (`src/decisions.js`) доведено до контрактного мапінгу й задокументовано таблицею; фікстура
  `0002-decision-request.md` (`blast_radius: subtree`) демонструє `standard` у тестах.
- **Квіз-файл узагальнено на кілька питань** (`src/quiz.js`) — `## Питання N` / `## Питання N (повторення)` /
  `## Питання N (спроба K)`, byte-сумісно з M1-форматом для one-question квізів.

### Demo-послідовність (навчальний цикл: фейл → шари → мікроурок у базі)

```bash
cd delta
export DELTA_CONFIG_PATH=/tmp/delta-demo-m2/config.json

mkdir -p /tmp/delta-demo-m2/runs/demo-1/decisions
cp src/tests/fixtures/runs/demo-1/decisions/0001-decision-request.md /tmp/delta-demo-m2/runs/demo-1/decisions/
bun bin/delta.mjs set_identity '{"handle":"olena"}'
bun bin/delta.mjs set_mandates_dir '{"dir":"/tmp/delta-demo-m2"}'

# 1. Генерує питання (fallback без живого LLM-ендпоінта — quiz-gen-fallback)
bun bin/delta.mjs decision_quiz '{"runId":"demo-1","nnnn":"0001","chosenOption":"B"}'

# 2. Неправильна відповідь (свідомо помилковий індекс) — мікроурок + explain: layer 1 (## Контекст)
bun bin/delta.mjs decision_approve '{"runId":"demo-1","nnnn":"0001","chosenOption":"B","answer":0}'
# output.explain[0] = {"layer":1,"heading":"Контекст","content":"..."}; output.microlesson присутній

# 3. Правильна відповідь (індекс із кроку 1 output.options) — фіналізує квіз, підписує, дописує базу знань
bun bin/delta.mjs decision_approve '{"runId":"demo-1","nnnn":"0001","chosenOption":"B","answer":1}'

# 4. Мікроурок ліг у особисту базу знань — конспект домену architecture + тренд
bun bin/delta.mjs knowledge_show '{}'
cat /tmp/delta-demo-m2/knowledge.json
```

### Демо spaced repetition (повторення через нову розвилку)

Інтервал (1 день) не можна прогнати в реальному часі одним CLI-викликом — підроби `completedAt` у минуле
безпосередньо у `knowledge.json` (той самий формат, що дописує `appendKnowledgeEntry`), тоді підклади НОВИЙ
decision-request того самого домену (`decision_type`) і виклич `decision_quiz` — друге питання підмішається
автоматично, файл покаже `## Питання 2 (повторення)`.

## Розробка

```bash
bun install
bun run --cwd=delta dev              # vite dev-сервер (без Tauri-вікна)
bun run tauri dev --config src-tauri/tauri.conf.dev.json   # у delta/: повне Tauri-вікно
bun run --cwd=delta test             # vitest (мок-парсер, онбординг)
cargo test --manifest-path delta/src-tauri/Cargo.toml       # Rust-бекенд
```

## CLI

```bash
cd delta
bun bin/delta.mjs list                                            # каталог tools
bun bin/delta.mjs whoami
bun bin/delta.mjs set_identity '{"handle":"olena"}'
bun bin/delta.mjs set_mandates_dir '{"dir":"/абсолютний/шлях/до/воркспейсу"}'
bun bin/delta.mjs mandates_show '{"mandatesDir":"/абсолютний/шлях","handle":"olena"}'
```

`mandates_show` без явних `mandatesDir`/`handle` бере їх з локального конфігу (той самий, що читає GUI) —
зручно для інтерактивного використання після `set_identity`/`set_mandates_dir`.

## Формат `.mt/mandates.yaml`

```yaml
mandates:
  - owner: olena
    scope:
      refs: ["refs/mt/tasks/design/**"]
      decision_types: [architecture, ux]
    thresholds: { budget_eur: 2000, risk: medium, irreversible: false }
    escalates_to: vitalii
  - owner: fable-5 # модель — першокласний власник мандата
    kind: model
    scope:
      refs: ["refs/mt/tasks/routine/**"]
      decision_types: [ops]
    thresholds: { budget_eur: 200, risk: low, irreversible: false, audacity: medium }
    escalates_to: olena
  - owner: vitalii
    scope: { refs: ["refs/mt/**"], decision_types: ["*"] }
    thresholds: {} # порожньо = кореневий мандат
    escalates_to: null
```

Тестова фікстура з двома людьми й однією моделлю — `src/tests/fixtures/mandates.yaml`.
