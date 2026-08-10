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

## M3 — ШІ-мандати: трек-рекорд, «Довіряю», ШІ-петиція, «остання константа» конструктивно

Демо-критерій: модель подає петицію на розширення власного мандата; єдиний шлях застосувати зміну —
людський підпис делегатора через звичайний квіз-гейт (форсовано на найвищу ДОСТУПНУ глибину — `standard`);
спроба підписати саму мутацію мандата модельним ключем відхиляється безумовно
(докладніше — `docs/specs/260809-delta-app.md`, «Обсяг M3»).

- **`validate_mandate_change` — мок за `mt-rust/crates/mt-mandates/src/change.rs`** (`src/mandate-change.js`):
  `generation` мусить зрости РІВНО на 1; зміна одного owner-мандата класифікується по осях
  (`scope.refs`/`scope.decision_types`/`thresholds.budget_eur`/`risk`/`irreversible`/`audacity`) на
  `added`/`removed`/`kind-changed`/`escalates-to-changed`/`widened`/`narrowed`/`unchanged` — змішаний diff
  (одна вісь звужується, інша розширюється) трактується як РОЗШИРЕННЯ, видалення мандата — звуження «до
  нуля». Розширення/додавання вимагає підпису делегатора рівня вище (старого `escalates_to`); звуження/
  видалення — самопідпис owner; зміна `escalates_to` — ПОДВІЙНИЙ підпис (новий адресат + старий делегатор).
  **«Остання константа»:** розширення `kind: model` мандата (включно з `audacity` вгору) підписує ЛИШЕ
  людський ключ — модельний підпис на такому дифі відхиляється безумовно, навіть від правильного делегатора.
  Крипто-шар — власний вибір, не порт байт-у-байт crate (підписує ПОВНИЙ канонікалізований payload через
  `signing.js`, той самий шлях, що `ApprovalResponse`, замість domain-separated хешу change.rs) —
  задокументована різниця в заголовку модуля.
- **`device-registry.json`** (`src/device-registry.js`) — публічний реєстр `handle → {role, pubkeyBase64}`,
  живе В `mandatesDir` (комітиться в git, на відміну від приватного `device_key.json` поза git) — мок
  «pubkey-кешу», проти якого `validate_mandate_change` звіряє заявлену роль підписанта. Свій pubkey
  реєструється при першому підписі мандат-зміни (той самий інваріант, що M1 `device_key.json`).
- **Трек-рекорд** (`src/track-record.js`) — «активність і послідовність», НЕ success rate (немає ще
  audit-механіки/аналізатора ескалацій — чесно назване обмеження): кількість підписаних рішень моделі за
  `decision_type`, останні N з розгорткою, частка без override. Override — **задокументоване спрощення**:
  пізніший (за `signed_at`) людський `ApprovalResponse` у ТОМУ САМОМУ run-і з протилежним `chosen_option`
  (не обов'язково та сама розвилка — справжня семантика потребує графової прив'язки, якої мок не має).
- **«Довіряю»** (`src/trust.js` + `TrustView.vue`/`use-trust.js`) — мої ШІ-мандати (`escalates_to === я`) з
  трек-рекордом, порогами, audacity-описом наслідків (`low`: агент питає перед відмовою постачальнику;
  `medium`: відмовляє сам у reversible; `high`: жорсткі переговори сам, обмежено інваріантом reversible —
  статичні тексти UI). Кнопки MVP-скоуп однієї осі (audacity ± один щабель, `budget_eur` фолбек на межах —
  повний багатовісний майстер делегування лишається пізнішому мілстоуну): «звузити» — самопідпис, миттєво,
  без квізу; «розширити» — ЛИШЕ через change-proposal, немає прямого шляху редагувати `kind: model` мандат.
- **Change-proposal** (`src/change-proposal.js`) — розширення НІКОЛИ не пише `.mt/mandates.yaml` напряму:
  матеріалізується як звичайний decision-request у черзі делегатора
  (`runs/mandate-change-{changeId}/decisions/0001-decision-request.md` — плоский run-id, не вкладений
  сегмент з задачі, щоб не чіпати однорівневий `scan_decisions`-сканер CLI/GUI; сусідній `0001-change.json`
  несе машинописний `{old, new}`), `leverage_facets` форсовані (`irreversible: false`, `blast_radius:
  subtree`) на найвищу глибину, яку M2 реалізує (`standard`) — `teach-back` лишається M5, форс
  задокументовано в заголовку модуля. Людина проходить ЗВИЧАЙНИЙ `decision_quiz`/`decision_approve`
  (варіант A застосувати / B відхилити); `mandate_change_apply` — міст між двома незалежними підписами
  цього застосунку: той самий фізичний ключ, що підписав `ApprovalResponse` квіз-гейта, підписує ОКРЕМИЙ
  акт `validate_mandate_change` (одна людська дія, два криптографічно незалежні підтвердження).
- **ШІ-петиція** (`src/ai-petition.js`, tool `ai_petition`) — headless, симулює модель: формує draft-
  розширення власного мандата з evidence з трек-рекорду, підписує ЛИШЕ петицію (не зміну) модельним ключем,
  кладе ту саму change-proposal у чергу делегатора. Модель НЕ має окремого фізичного пристрою в цьому
  моку — застосунок локально утримує її ключ (той самий каталог, що людський `device_key.json`), окреме
  задокументоване рішення M3.

### Demo-послідовність (петиція → чергу людини → квіз найвищої глибини → підпис → відмова модельного підпису)

```bash
cd delta
export DELTA_CONFIG_PATH=/tmp/delta-demo-m3/config.json
mkdir -p /tmp/delta-demo-m3/.mt
cp src/tests/fixtures/mandates.yaml /tmp/delta-demo-m3/.mt/mandates.yaml   # generation відсутнє → дефолт 1

bun bin/delta.mjs set_identity '{"handle":"olena"}'
bun bin/delta.mjs set_mandates_dir '{"dir":"/tmp/delta-demo-m3"}'

# 1. fable-5 подає петицію на розширення власного мандата (audacity medium → high)
bun bin/delta.mjs ai_petition '{"modelHandle":"fable-5","changeId":"demo-1"}'

# 2. Change-proposal тепер у черзі olena (decision_type: mandate-change, depth: standard — форсовано)
bun bin/delta.mjs decisions_show '{}'

# 3-4. olena проходить ЗВИЧАЙНИЙ квіз-гейт (2 питання, chosenOption "A" = застосувати)
bun bin/delta.mjs decision_quiz '{"runId":"mandate-change-demo-1","nnnn":"0001","chosenOption":"A"}'
bun bin/delta.mjs decision_approve '{"runId":"mandate-change-demo-1","nnnn":"0001","chosenOption":"A","answer":<індекс з кроку 3>}'
bun bin/delta.mjs decision_approve '{"runId":"mandate-change-demo-1","nnnn":"0001","chosenOption":"A","answer":<індекс питання 2>}'
# => approved: true, підписаний 0001-approval.json (той самий М1/M2-конвеєр, без винятків)

# 5. СПРОБА застосувати мутацію МОДЕЛЬНИМ підписом — «остання константа», безумовна відмова
bun bin/delta.mjs mandate_change_apply '{"changeId":"demo-1","handle":"olena","role":"model"}'
# => {"valid":false,"reason":"owner 'fable-5': розширення ШІ-мандата (kind: model) підписує лише
#     людський ключ — модельний підпис відхиляється безумовно"}

# 6. ЛЮДСЬКИЙ підпис (той самий фізичний ключ, що щойно пройшов квіз) — застосовується
bun bin/delta.mjs mandate_change_apply '{"changeId":"demo-1","handle":"olena","role":"human"}'
# => {"valid":true}; .mt/mandates.yaml: generation 1 → 2, fable-5.thresholds.audacity: medium → high

cat /tmp/delta-demo-m3/.mt/mandates.yaml
bun bin/delta.mjs trust_show '{}'                                  # оновлений трек-рекорд/audacity
bun bin/delta.mjs mandate_narrow '{"ownerHandle":"fable-5"}'       # звуження — самопідпис моделі, миттєво, без квізу
```

Реальний прогін цієї послідовності (агентом, що писав M3) підтвердив точно цей вивід — включно з
відмовою на кроці 5 і успіхом на кроці 6.

## M4 — мультиюзер: directory, кворум для irreversible, watcher, тиха година, профспілковий режим

Демо-критерій: кворум 2/2 на irreversible-рішенні з двох пристроїв; watcher пінгує виконавця раніше за
власника (докладніше — `docs/specs/260809-delta-app.md`, «Обсяг M4»; контракт — `mt: docs/architecture/mandates.md`,
«Process watcher»/«Маршрутизатор ескалацій»).

- **Directory** (`src/directory.js`) — `<mandatesDir>/.mt/directory.json` (handle → `{name, email, lang}`), PII ПОЗА
  git (конституція п.8: «Ідентичність = handle, PII поза git»; спека 260714, п.1) — корінь репо ігнорує
  `**/.mt/directory.json`; приклад формату — `src/tests/fixtures/directory.example.json`, не сам файл. Display-імена
  підставляються з фолбеком на handle (`displayName`) на карті мандатів, у «Довіряю» й у черзі — UI-композабл
  `src/composables/use-directory.js`; адмін-секція (список handle-ів з редагованим display-імʼям) — розкривна панель
  на вкладці «Карта мандатів». CLI/tools: `directory_show`, `directory_set`.
- **Мультипартійний підпис (кворум) для irreversible** (`src/quorum.js`) — decision-request з
  `leverage_facets.irreversible: true` вимагає підписів УСІХ handle-ів фронтматер-поля `approvers: [...]` (нове поле —
  розширення мока; відсутнє → фолбек `[computed_owner]`, `decisions.js: resolveApprovers`). Кожен підписант проходить
  ВЛАСНИЙ квіз (`NNNN-quiz-{handle}.md`, депа форсована на `standard` — найвищу зараз доступну, `teach-back` лишається
  M5, задокументовано в заголовку `quorum.js`) і пише СВІЙ `NNNN-approval-{handle}.json` (та сама схема
  `ApprovalResponse`, що M1, плюс поле `signer_handle`). `decisions.js: deriveQuorumStatus` деривує стан із самих
  approval-файлів: `'closed'` — усі підписали ОДНАКОВИЙ `chosen_option`; `'diverged'` — усі підписали, але
  розійшлися (рішення лишається ВІДКРИТИМ з видимим статусом, жодної авторезолюції); `'pending'` — не всі підписали.
  Черга (`deriveQueue`) показує кворумну картку УСІМ approvers, поки статус не `'closed'` — навіть тим, хто вже
  підписав (`awaitingMe: false`) — транспарентність «хто лишився». Одноосібні (`irreversible: false`) рішення йдуть
  через `decision-flow.js` БЕЗ ЖОДНОЇ зміни (M1/M2-формат `NNNN-approval.json` незмінний, зворотна сумісність —
  `depthForFacets` мапить `irreversible: true` на `teach-back`, який `decision-flow.js` не підтримує, тож обидва
  шляхи взаємовиключні за конструкцією). CLI/tools: `quorum_quiz`, `quorum_approve`, `quorum_status`.
- **Watcher** (`src/watcher.js` + tool `watcher_scan`, headless-вхід `bin/delta-watcher.mjs`) — сканує
  `runs/*/decisions/`: відкриті decision-request-и старші за `sla_hours` (дефолт 24) → СПЕРШУ пінг
  виконавцю/підписанту («у тебе висить X — допомогти?», mandates.md: порядок сигналізації), без руху ще
  `grace_hours` (дефолт 24) → ескалація власнику вище по `escalation_chain`, у форматі «X застрягло, {handle} в
  курсі з {дата}», ЗАВЖДИ з прозорою копією в лозі самого виконавця. Час відкриття — власне розширення `opened_at`
  (ISO, той самий дефакто-підхід, що `decision_type`); відсутнє поле → вік невідомий, watcher свідомо НЕ пінгує
  (fail-safe). Нотифікації — файловий лог `<mandatesDir>/.mt/notifications/{handle}.jsonl` (append-only, read-append-
  write через ГЕНЕРИЧНИЙ `read_text_file`/`write_text_file` — жодних нових Tauri-команд; relay для живого пушу
  прийде пізніше — задокументована деградація «полінг файлів замість пушу»). UI: вкладка «Стежу» (список
  нотифікацій + кнопка ручного прогону), CLI: `notifications_show`.
- **Тиха година** (`quiet_hours`/`set_quiet_hours`, конфіг пристрою `{start, end}` — `"HH:MM"`, підтримує нічне
  вікно через північ) — некритичні нотифікації, згенеровані watcher-ом у тиху годину, і далі пишуться в лог одразу
  (headless-актор не чекає кінця вікна), але з `deliverAt` = момент кінця вікна й `batched: true` — споживач
  (`notifications_show`/UI) фільтрує «видимі зараз» за `deliverAt <= now`. Irreversible-рішення З дедлайном
  (`deadline_cost` заповнено) — ВИНЯТОК, `critical: true`, доставляється негайно навіть у тиху годину. Годинник
  ін'єктований (`now`) — той самий підхід, що M2.
- **Профспілковий режим** (`src/what-system-knows.js`, tool `what_system_knows`, конституція п.9) — чистий
  агрегатор БЕЗ нових зборів даних: моя база знань (`knowledge.js` — записи/тренд), мої нотифікації від watcher-а
  (пінги мені + що з них пішло вгору, `escalatedFromMe`), мій pubkey/роль з `device-registry.js`. UI: секція на
  вкладці «Стежу».

### Demo-послідовність (реально прогнана: кворум 2/2 з двох конфігів-«пристроїв» + watcher-послідовність)

```bash
cd delta
mkdir -p /tmp/delta-demo-m4/.mt /tmp/delta-demo-m4/runs/demo-1/decisions
cp src/tests/fixtures/mandates.yaml /tmp/delta-demo-m4/.mt/mandates.yaml
cp src/tests/fixtures/runs/demo-5/decisions/0001-decision-request.md /tmp/delta-demo-m4/runs/demo-1/decisions/
# irreversible, approvers: [olena, vitalii], opened_at у минулому — фікстура M4

# Два "пристрої" — окремі DELTA_CONFIG_PATH, кожен зі своїм Ed25519-ключем.
export OLENA_CFG=/tmp/delta-demo-m4-olena/config.json
export VITALII_CFG=/tmp/delta-demo-m4-vitalii/config.json
DELTA_CONFIG_PATH=$OLENA_CFG   bun bin/delta.mjs set_identity '{"handle":"olena"}'
DELTA_CONFIG_PATH=$OLENA_CFG   bun bin/delta.mjs set_mandates_dir '{"dir":"/tmp/delta-demo-m4"}'
DELTA_CONFIG_PATH=$VITALII_CFG bun bin/delta.mjs set_identity '{"handle":"vitalii"}'
DELTA_CONFIG_PATH=$VITALII_CFG bun bin/delta.mjs set_mandates_dir '{"dir":"/tmp/delta-demo-m4"}'

# 1. Адмінка — display-імена (PII поза git, .mt/directory.json)
DELTA_CONFIG_PATH=$OLENA_CFG bun bin/delta.mjs directory_set '{"handle":"olena","name":"Олена Коваль"}'
DELTA_CONFIG_PATH=$OLENA_CFG bun bin/delta.mjs directory_set '{"handle":"vitalii","name":"Віталій Ткаченко"}'

# 2. decisions_show olena — картка з quorum.status: "pending", awaitingMe: true
DELTA_CONFIG_PATH=$OLENA_CFG bun bin/delta.mjs decisions_show '{}'

# 3-4. olena проходить ВЛАСНИЙ квіз (2 питання standard, форсовано) і підписує
DELTA_CONFIG_PATH=$OLENA_CFG bun bin/delta.mjs quorum_quiz '{"runId":"demo-1","nnnn":"0001","signerHandle":"olena","chosenOption":"A"}'
DELTA_CONFIG_PATH=$OLENA_CFG bun bin/delta.mjs quorum_approve '{"runId":"demo-1","nnnn":"0001","signerHandle":"olena","chosenOption":"A","answer":<індекс Q1>}'
DELTA_CONFIG_PATH=$OLENA_CFG bun bin/delta.mjs quorum_approve '{"runId":"demo-1","nnnn":"0001","signerHandle":"olena","chosenOption":"A","answer":<індекс Q2>}'
# => approved: true, NNNN-approval-olena.json з полем signer_handle

# 5. quorum_status — 1/2, pending
DELTA_CONFIG_PATH=$VITALII_CFG bun bin/delta.mjs quorum_status '{"runId":"demo-1","nnnn":"0001"}'

# 6-7. vitalii — ВЛАСНИЙ квіз (окремий фізичний ключ), ВЛАСНИЙ підпис
DELTA_CONFIG_PATH=$VITALII_CFG bun bin/delta.mjs quorum_quiz '{"runId":"demo-1","nnnn":"0001","signerHandle":"vitalii","chosenOption":"A"}'
DELTA_CONFIG_PATH=$VITALII_CFG bun bin/delta.mjs quorum_approve '{"runId":"demo-1","nnnn":"0001","signerHandle":"vitalii","chosenOption":"A","answer":<...>}'
DELTA_CONFIG_PATH=$VITALII_CFG bun bin/delta.mjs quorum_approve '{"runId":"demo-1","nnnn":"0001","signerHandle":"vitalii","chosenOption":"A","answer":<...>}'

# 8. quorum_status — 2/2, ОДНАКОВИЙ chosen_option "A" → closed
DELTA_CONFIG_PATH=$OLENA_CFG bun bin/delta.mjs quorum_status '{"runId":"demo-1","nnnn":"0001"}'
# => {"status":"closed","pending":[],"signed":[{"handle":"olena",...},{"handle":"vitalii",...}]}

# 9. Картка зникає з черги ОБОХ (кворум 2/2 закрито)
DELTA_CONFIG_PATH=$OLENA_CFG   bun bin/delta.mjs decisions_show '{}'   # => []
DELTA_CONFIG_PATH=$VITALII_CFG bun bin/delta.mjs decisions_show '{}'   # => []

# 10. Watcher — окрема застаріла (не-irreversible) розвилка demo-2, computed_owner: olena,
#     escalation_chain: [olena, vitalii], opened_at понад SLA(24h)+grace(24h) тому
mkdir -p /tmp/delta-demo-m4/runs/demo-2/decisions
# ...(скопіювати/написати decision-request з opened_at у минулому)...
DELTA_CONFIG_PATH=$OLENA_CFG bun bin/delta.mjs watcher_scan '{}'
# => notifications: [sla-ping-executor → olena, sla-escalate-owner → vitalii, sla-escalated-notice → olena]
#    ПОРЯДОК масиву — виконавець ЗАВЖДИ раніше за власника (mandates.md, «Process watcher»)

# 11. Кожен бачить лише СВІЙ лог
DELTA_CONFIG_PATH=$OLENA_CFG   bun bin/delta.mjs notifications_show '{}'  # ping + escalated-notice (прозоро)
DELTA_CONFIG_PATH=$VITALII_CFG bun bin/delta.mjs notifications_show '{}'  # лише escalate-owner

# 12. Тиха година — некритичне батчиться, повторний скан
DELTA_CONFIG_PATH=$OLENA_CFG bun bin/delta.mjs set_quiet_hours '{"start":"00:00","end":"23:59"}'
DELTA_CONFIG_PATH=$OLENA_CFG bun bin/delta.mjs watcher_scan '{}'
# => notifications[].batched: true, deliverAt — кінець вікна (не зараз)

# 13. Профспілковий режим — усе, що система знає про olena, одним агрегатом
DELTA_CONFIG_PATH=$OLENA_CFG bun bin/delta.mjs what_system_knows '{}'

# Headless-вхід (крон/вручну), без tool-каталогу:
bun bin/delta-watcher.mjs /tmp/delta-demo-m4
```

Реальний прогін цієї послідовності (агентом, що писав M4) підтвердив точно цей вивід: кворум `1/2 → 2/2` з
двома НЕЗАЛЕЖНИМИ Ed25519-ключами (два `DELTA_CONFIG_PATH`), закрита картка зникає з черги обох підписантів,
watcher-нотифікації в порядку виконавець-спершу-потім-власник, і тиха година, що батчить некритичне (`batched:
true`) та пропускає критичне (irreversible+дедлайн) без затримки.

## M5 — Штаб і зухвалість: teach-back, бриф, кандор, дрейф, делегування

Демо-критерій: дрейф-картка приходить лише власнику; делегування відкладеної дії агенту одним квізом;
teach-back оцінено локально (докладніше — `docs/specs/260809-delta-app.md`, «Обсяг M5»).

- **`depth: teach-back`** (`src/quiz.js` + `src/decision-flow.js` + `src/quorum.js`) — найвища глибина
  квіз-гейта, доводить `depthForFacets` до контракту (mandates.md: «irreversible + широкий blast_radius →
  teach-back: власник переказує рішення і наслідки своїми словами, агент оцінює переказ»). Механіка
  ПРИНЦИПОВО інша за Q&A-квізи M1/M2: немає варіантів відповіді — власник пише ВІЛЬНИЙ ТЕКСТ (`transcript`,
  CLI-аргумент `decision_approve`/`quorum_approve`, UI: textarea з підказкою), локальна модель оцінює
  ПОКРИТТЯ чотирьох аспектів (суть розвилки, обраний варіант, головний наслідок, головний ризик) —
  `{understood, missingAspects, feedback}`. У квіз-файл — точний контракт задачі: «## Переказ (teach-back)»
  із транскриптом + «### Оцінка локальної моделі» з вердиктом (`formatTeachBackFile`/`parseTeachBackFile`,
  той самий frontmatter, що Q&A-квізи). Не зрозумів (`understood: false`) → навчальний режим M2
  (`layeredExplain`, шари контексту) і новий переказ, `iterations++` — той самий інваріант «фейл ≠
  покарання». **LLM недоступний → ЧЕСНА відмова** (`TEACHBACK_UNAVAILABLE_MESSAGE`, `available: false`) —
  СВІДОМО без фолбека на нижчу глибину: незворотне рішення без доведеного розуміння не підписується
  (задокументоване рішення M5, відмінне від one-tap/standard, де детермінований фолбек є). Голосовий ввід —
  НЕ реалізовано: macOS-диктовка друкує текст у ту саму textarea сама, окремого механізму не потрібно.
  Кворум (`quorum.js`) БІЛЬШЕ НЕ форсує `standard` — кожен підписант проходить ВЛАСНИЙ teach-back
  (`NNNN-quiz-{handle}.md`), незалежну оцінку, той самий `available: false`-контракт відмови.
- **Штаб — бриф перед рішенням** (`src/staff.js`, tool `decision_brief`, ідея з owner-спеки 260711, «Штаб») —
  ЛІНИВИЙ виклик (не автогенерується при відкритті картки): LLM стискає decision-request у
  `{contextSummary (3 речення), options (ціна одним рядком кожен), recommendationSummary,
  strongestObjection (анти-rubber-stamping — найсильніше заперечення ПРОТИ рекомендації), delaySummary}`.
  LLM недоступний → структурний фолбек (`fallbackStaffBrief`): заголовки/поля decision-request як є, БЕЗ
  стискання, `compressed: false`, `strongestObjection: null` — чесно позначено (генерація контраргументу
  принципово потребує LLM-судження, той самий підхід, що teach-back).
- **Панель «незручна правда»** (`src/candor.js`, tool `ai_candor` — headless, симулює модель, той самий
  патерн, що `ai_petition`) — окремий інбокс `.mt/candor/{handle}.jsonl`, ВІДДІЛЕНИЙ від черги рішень
  (конституція п.6). Запис `{from_model, statement, evidence_refs, audacity_level, created_at}`; **бюджет
  зухвалості**: `audacity_level` запису ≤ `thresholds.audacity` мандата моделі (`mandates.js`) — той самий
  бюджет, що «жорсткі переговори сам» у «Довіряю» (`trust.js`), СПОЖИВАЄ той самий ресурс, не окремий
  канал; модель без мандата, чи понад бюджет — відхилено. Позначка «прочитано» — ЛОКАЛЬНО поза git
  (`candor_read.json`, файл-сусід `config.json`), не синхронізується між пристроями (профспілковий режим:
  моя приватність). CLI/tools: `ai_candor`, `candor_show`, `candor_mark_read`.
- **Детектор соціального дрейфу — приватне дзеркало** (`src/drift.js`, tool `drift_scan`, mandates.md:
  «Детектор соціального дрейфу») — сканує МОЇ відкриті одноосібні decision-request-и (кворумні
  `irreversible` виключено — власна механіка прогресу), групує за `decision_type`, два сигнали
  систематичного відкладання: **застаріле** (`opened_at` старше `staleDays`, дефолт 7) і **повторні
  ітерації без підпису** (квіз-файл з `iterations ≥ iterationsThreshold`, дефолт 3, рішення й досі
  відкрите). «Reject-и з поверненням того самого класу» (третій сигнал з задачі) — СВІДОМО не реалізовано:
  потребує графової прив'язки причин-наслідків, якої файловий мок не матеріалізує (задокументований ліміт,
  той самий чесний підхід, що `track-record.js: override`). Картки зберігаються **ЛОКАЛЬНО поза git**
  (`drift.json`, файл-сусід `knowledge.json`) — **НЕ** в `.mt/notifications` (буквально з задачі: «приходить
  лише самому власнику»), кожен скан ПЕРЕЗАПИСУЄ файл свіжим результатом (не append — застарілі картки не
  накопичуються). Кожна картка несе `deadlineCostSample` — дельта «мета vs комфорт» (що блокується
  затримкою). CLI/tools: `drift_scan`, `drift_show`.
- **Черга відкладених дій + делегування одним квізом** (`src/delegation.js`, tools `delegation_quiz` +
  `decision_delegate`) — деривація з дрейф-карток: `findEligibleModel` обирає модель СВОГО делегатора
  (`escalates_to === я`), чий `scope.decision_types` покриває клас; ОДИН **детермінований** (без LLM,
  задокументоване рішення — мета-питання завжди тієї самої структури) one-tap квіз «що саме делегуєш і що
  модель зробить»; правильна відповідь підписує й пише `NNNN-delegation.json`
  `{delegated_to, delegated_by, signed_at, pubkey, signature, quiz_ref}` (та сама канонікалізація
  `signing.js`, що approval/quorum/петиція). **`computed_owner` decision-request НЕ переписується** —
  деривація: `deriveQueue` (`decisions.js`) бачить сусідній `NNNN-delegation.json` і переносить розвилку з
  черги делегатора В чергу моделі (`delegatedTo`/`delegatedBy` на картці), сам decision-request лишається
  незмінним назавжди (audit-trail рекомендації не втрачається).

### Demo-послідовність (реально прогнана: teach-back честа відмова живого LLM, кандор, дрейф → делегування)

```bash
cd delta
export DELTA_CONFIG_PATH=/tmp/delta-demo-m5/config.json
mkdir -p /tmp/delta-demo-m5/.mt /tmp/delta-demo-m5/runs/demo-1/decisions
cp src/tests/fixtures/mandates.yaml /tmp/delta-demo-m5/.mt/mandates.yaml
cp src/tests/fixtures/runs/demo-1/decisions/0003-decision-request.md /tmp/delta-demo-m5/runs/demo-1/decisions/
cp src/tests/fixtures/runs/demo-1/decisions/0004-decision-request.md /tmp/delta-demo-m5/runs/demo-1/decisions/
bun bin/delta.mjs set_identity '{"handle":"olena"}'
bun bin/delta.mjs set_mandates_dir '{"dir":"/tmp/delta-demo-m5"}'

# 1. Штаб — бриф (LLM недоступний/повільний у цьому середовищі → чесний структурний фолбек)
bun bin/delta.mjs decision_brief '{"runId":"demo-1","nnnn":"0003"}'
# => {"compressed":false,"generatedBy":"staff-brief-fallback","strongestObjection":null,...}

# 2. teach-back — prompt (0003: blast_radius company, irreversible: false — одноосібний шлях, НЕ кворум)
bun bin/delta.mjs decision_quiz '{"runId":"demo-1","nnnn":"0003","chosenOption":"A"}'
# => {"depth":"teach-back","prompt":"Перекажи своїми словами...", "iterations":0}

# 3. Переказ — локальна модель недоступна/не відповідає контрактом → ЧЕСНА відмова, рішення лишається відкритим
bun bin/delta.mjs decision_approve '{"runId":"demo-1","nnnn":"0003","chosenOption":"A","transcript":"Обираю варіант A — перехід на чотириденний тиждень. Головний наслідок: вища залученість команди. Головний ризик: SLA з клієнтами може постраждати на перехідний період."}'
# => {"approved":false,"available":false,"message":"teach-back недоступний без локальної моделі..."}
# (з живою моделлю, яка відповідає контрактом SYSTEM_PROMPT — той самий виклик повертає understood:true/false)

# 4. Кандор — fable-5 каже незручну правду olena (окремий інбокс, medium у межах бюджету)
bun bin/delta.mjs ai_candor '{"toHandle":"olena","fromModelHandle":"fable-5","statement":"Ти три тижні відкладаєш ops-розвилку 0004...","audacityLevel":"medium"}'
bun bin/delta.mjs ai_candor '{"toHandle":"olena","fromModelHandle":"fable-5","statement":"x","audacityLevel":"high"}'
# => {"ok":false,"error":{"message":"...перевищує бюджет зухвалості мандата 'fable-5' ('medium')..."}}
bun bin/delta.mjs candor_show '{}'
# => [{"from_model":"fable-5","audacity_level":"medium","read":false,...}] — ВІДДІЛЕНО від decisions_show

# 5. Дрейф — 0004 (ops, opened_at 2026-07-01) застаріле для olena, картка ЛИШЕ локально (drift.json)
bun bin/delta.mjs drift_scan '{}'
# => [{"decisionType":"ops","count":1,"items":[{"nnnn":"0004","ageDays":40,"signal":"stale"}],...}]

# 6. Делегування одним квізом — модель fable-5 (scope: ops, escalates_to: olena)
bun bin/delta.mjs delegation_quiz '{"runId":"demo-1","nnnn":"0004","modelHandle":"fable-5"}'
bun bin/delta.mjs decision_delegate '{"runId":"demo-1","nnnn":"0004","modelHandle":"fable-5","delegatedByHandle":"olena","answer":<індекс правильної відповіді з кроку 6>}'
# => {"delegated":true,"delegation":{"delegated_to":"fable-5","delegated_by":"olena",...}}

# 7. Деривація черги — 0004 зникло в olena, зʼявилось у fable-5 (computed_owner у файлі НЕ змінився)
bun bin/delta.mjs decisions_show '{}'                          # лише 0003 (teach-back)
bun bin/delta.mjs decisions_show '{"handle":"fable-5"}'         # 0004, delegatedTo: fable-5
```

Реальний прогін цієї послідовності (агентом, що писав M5) підтвердив точно цей вивід — включно з живим
локальним LLM-ендпоінтом на `127.0.0.1:8080` (наявним у середовищі розробки), який на цей запит не
відповів контрактом `SYSTEM_PROMPT` вчасно — `callLlmTeachBackEvaluator` коректно повернув `null`,
`decisionApprove` коректно повернув ЧЕСНУ відмову (`available: false`) БЕЗ фолбека на нижчу глибину, рішення
лишилось відкритим — саме той інваріант, який задокументовано вище як свідомий вибір M5.

## M6 — Пілот-механіка: дельта-звіт, kill-switch, тижневе рев'ю

Демо-критерій: перше дельта-рев'ю організації на реальних даних — звіт згенеровано, ≥1 мандат
розширено/звужено підписом (докладніше — `docs/specs/260809-delta-app.md`, «Обсяг M6»).

- **UI-догон M5** — вкладка «Незручна правда» (`CandorView.vue`/`use-candor.js`: список
  `candor_show`, бейдж непрочитаних, mark-read), секція «Дрейф» на вкладці «Стежу»
  (`WatcherView.vue`/`use-drift.js`: картки `drift_show`/`drift_scan`, кнопка «делегувати ШІ» → inline
  one-tap квіз `delegation_quiz`/`decision_delegate`, той самий M5-flow), делегування з UI — чиста Vue-
  обв'язка над наявними M5 tools, без нової логіки в `src/*.js`.
- **Org-конфіг** (`src/org.js`) — новий файл `<mandatesDir>/.mt/org.json` (**комітиться в git**, не PII —
  той самий рівень публічності, що `device-registry.json`): `{ "hourly_rate_eur": 60 }` (дефолт 60 €/год,
  редагується вручну — жодного tool для запису поки що).
- **Дельта-звіт** (`src/report.js`, tool `delta_report {mandatesDir, periodDays}`) — детермінований
  markdown, БЕЗ LLM: (а) **рух межі** — застосовані mandate-change за період, зі знайденого маркера
  `runs/mandate-change-{id}/decisions/0001-applied.json` (новий — `change-proposal.js:
  applyMandateChangeProposal` пише його ПІСЛЯ Valid-вердикту `validate_mandate_change`, окремо від самої
  мутації `.mt/mandates.yaml`, бо мутація сама не несе часової мітки застосування); (б) **рішення за
  період** — закриті decision-request-и, класифіковані людський/модельний/кворумний за ефективним
  власником (`delegated_to`, якщо є, інакше `computed_owner`, звірений проти `kind` мандата); (в) **ціна
  гейта** — Σ `time_to_understanding_sec` людських/кворумних підписів × `hourly_rate_eur` + кількість
  (не сума грошей) відкритих розвилок з непорожнім `deadline_cost`; (г) **глибина делегування** —
  кількість `decision_types` із model-власником у мандатах + кількість делегувань, підписаних за період;
  (д) **агреговано без приватного** — кількість доставлених кандор-заяв і активацій kill-switch (лише
  count, БЕЗ вмісту дрейф-карток/бази знань). Пише `.mt/reports/YYYY-MM-DD-delta.md`; UI-вкладка «Звіт»
  (`ReportView.vue`/`use-report.js`) — рендер простим списком/числами/таблицею, без чартів.
- **Kill-switch** (`src/kill-switch.js`, tools `kill_switch_on`/`kill_switch_off`/`kill_switch_status`) —
  **SUSPENSION-шар, НЕ мутація мандата**: `.mt/mandates.yaml` НІКОЛИ не торкається (реверсивність).
  Активний kill-switch змінює ЛИШЕ деривацію: `decisions.js: deriveQueue` (третій аргумент
  `{killSwitchRedirect}`) перенаправляє розвилки, делеговані МОЇМ ШІ-мандатам (`escalates_to === я`), і
  нові розвилки їхніх scope-ів — у МОЮ чергу; `watcher.js: scanForNotifications`
  (`killSwitchSuppressed`) перестає пінгувати/ескалювати по них. UI-кнопка в шапці (`App.vue`) — **БЕЗ
  квізу, БЕЗ підтвердження**, миттєва (задокументоване рішення задачі: панічна кнопка не для роздумів
  над формулюванням квізу). Активний маркер — підписаний `.mt/kill-switch/{handle}.json`; `off`
  спорожнює його НОВИМ підписом (жодної Rust-команди видалення файлу — той самий інваріант, що
  `read_text_file`/`write_text_file` в решті застосунку). Обидві дії дописуються у спільний append-only
  лог `.mt/kill-switch/log.jsonl`, який рахує `report.js` (лише кількість активацій, не «хто»).
- **Тижневе дельта-рев'ю** (`src/review.js`, tool `review_agenda {mandatesDir, periodDays}`) —
  детермінований порядок денний, БЕЗ LLM: (а) **draft-пропозиції розширення** — модель мала 5+ рішень БЕЗ
  override за період і її делегатор НЕ має активного kill-switch → рев'ю САМЕ матеріалізує
  change-proposal ОДНИМ викликом `ai-petition.js: aiPetition` (той самий headless-actor патерн, що
  ШІ-петиція M3, `initiatedBy: review-agenda`) — підписує ЛЮДИНА звичайним `decision_quiz`/
  `decision_approve` + `mandate_change_apply` (M3), рев'ю нічого не підписує само; (б) **кандидати на
  звуження** — override-и за період або активний kill-switch делегатора (інформаційний список); (в)
  **відкриті розбіжності кворумів** (`status: diverged`) і **застарілі розвилки** — по УСІХ
  decision-request-ах воркспейсу (на відміну від приватного дзеркала `drift.js`, рев'ю — організаційна
  прозорість). Пише `.mt/reviews/YYYY-MM-DD-agenda.md`.

### Ритуал дельта-рев'ю

30 хвилин, раз на тиждень, єдина синхронна церемонія організації (конституція п.4). Порядок: (1)
`delta_report` — що сталось за тиждень (рух межі, ціна гейта, глибина делегування); (2) `review_agenda`
— порядок денний із уже готовими чернетками розширень (draft-пропозиції матеріалізуються автоматично,
не вигадуються на льоту); (3) організація вголос дивиться кандидатів на звуження й відкриті розбіжності;
(4) КОЖНЕ розширення з (2) підписує його делегатор — звичайний `decision_quiz`/`decision_approve` +
`mandate_change_apply`, той самий M3-конвеєр, немає обхідного шляху; (5) повторний `delta_report`
наступного тижня показує рух межі як факт, не як намір.

### Demo-послідовність (реально прогнана: тиждень фікстур → звіт → рев'ю → підпис розширення → рух межі → kill-switch)

```bash
cd delta
mkdir -p /tmp/delta-demo-m6/.mt /tmp/delta-demo-m6/runs/week1/decisions
cp src/tests/fixtures/mandates.yaml /tmp/delta-demo-m6/.mt/mandates.yaml
echo '{"hourly_rate_eur": 75}' > /tmp/delta-demo-m6/.mt/org.json
export DELTA_CONFIG_PATH=/tmp/delta-demo-m6-config/config.json
bun bin/delta.mjs set_identity '{"handle":"olena"}'
bun bin/delta.mjs set_mandates_dir '{"dir":"/tmp/delta-demo-m6"}'

# ... наповнити runs/week1/decisions/ фікстурами тижня активності: 5 model-signed
# ops-рішень fable-5 (без override — набирає поріг widen-кандидата), одне людське
# architecture-рішення з квіз-часом, одну застарілу відкриту розвилку з deadline_cost,
# один diverged-кворум, один candor-запис .mt/candor/olena.jsonl, device-registry.json
# з pubkey fable-5 (role: model) — той самий підхід, що фікстури M0-M5 (`cp .../fixtures/...`).

# 1. Звіт ДО рев'ю — 6 закритих рішень (5 модельних ops, 1 людське), рух межі порожній
bun bin/delta.mjs delta_report '{"periodDays":14}'

# 2. Рев'ю — fable-5 набрав поріг (5/5 без override), делегатор olena БЕЗ kill-switch →
#    change-proposal МАТЕРІАЛІЗУЄТЬСЯ автоматично (runId mandate-change-review-1-fable-5)
bun bin/delta.mjs review_agenda '{"periodDays":14}'
# => widenCandidates: [{modelHandle: "fable-5", delegatorHandle: "olena", ...}]
#    materialized: [{changeId: "review-1-fable-5", decisionRequestPath: "..."}]

# 3-4. olena проходить ЗВИЧАЙНИЙ квіз-гейт (depth: standard, 2 питання) на chosenOption A
bun bin/delta.mjs decision_quiz '{"runId":"mandate-change-review-1-fable-5","nnnn":"0001","chosenOption":"A"}'
bun bin/delta.mjs decision_approve '{"runId":"mandate-change-review-1-fable-5","nnnn":"0001","chosenOption":"A","answer":<індекс Q1>}'
bun bin/delta.mjs decision_approve '{"runId":"mandate-change-review-1-fable-5","nnnn":"0001","chosenOption":"A","answer":<індекс Q2>}'

# 5. Застосування — .mt/mandates.yaml: generation 1 → 2, fable-5.audacity: medium → high
bun bin/delta.mjs mandate_change_apply '{"changeId":"review-1-fable-5","handle":"olena","role":"human"}'
# => {"valid":true}; сусідній 0001-applied.json несе {appliedAt, handle: "olena", role: "human"}

# 6. Звіт ПІСЛЯ — «Рух межі» тепер несе fable-5: widened, thresholds.audacity: medium → high
bun bin/delta.mjs delta_report '{"periodDays":14}'

# 7. Kill-switch — olena забирає все собі: черга fable-5 порожніє, нова ops-розвилка
#    fable-5 деривується в чергу olena, watcher НЕ ескалює по ній
bun bin/delta.mjs kill_switch_on '{}'
bun bin/delta.mjs decisions_show '{"handle":"fable-5"}'   # => []
bun bin/delta.mjs decisions_show '{}'                       # => розвилка fable-5 тут, killSwitchRedirected: true
bun bin/delta.mjs watcher_scan '{}'                          # => без нотифікацій по цій розвилці
bun bin/delta.mjs kill_switch_off '{}'                       # реверсивність — черга fable-5 відновлюється
```

Реальний прогін цієї послідовності (агентом, що писав M6) підтвердив точно цей вивід: звіт до рев'ю
показав 6 закритих рішень (5 модельних/1 людське) і порожній рух межі; `review_agenda` знайшов fable-5
кандидатом (5/5 без override) і сам матеріалізував change-proposal `review-1-fable-5` у черзі olena;
звичайний `decision_quiz`/`decision_approve` (depth: standard, 2 питання, fallback-генератор) підписав
його; `mandate_change_apply` застосував — generation файлу зріс з 1 до 2, поріг зухвалості fable-5
піднявся з medium до high, сусідній `0001-applied.json` записав `appliedAt`/`handle`/`role`; повторний
звіт показав рух межі як рядок з owner `fable-5`, дією «розширено», делегатором `olena` і diff-рядком
`thresholds.audacity: medium → high` — точно той критерій демо M6, що вимагала задача. Kill-switch:
після `kill_switch_on` нова ops-розвилка fable-5 зникла з його черги й з'явилась у черзі olena
(`killSwitchRedirected: true`), `watcher_scan` не згенерував по ній жодної нотифікації (лише по
непов'язаній застарілій розвилці), `kill_switch_off` відновив чергу fable-5.

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

## Формат `.mt/org.json` (M6)

Org-level конфіг для метрики «ціна гейта» — **комітиться в git** (не PII, той самий рівень публічності,
що `device-registry.json`). Єдине поле — `hourly_rate_eur` (ставка вартості людської години, EUR);
відсутній файл — дефолт **60**. Редагується вручну, без окремого tool:

```json
{
  "hourly_rate_eur": 60
}
```

## Фаза A Rust-порту гейт-ядра (у процесі)

Рішення користувача: CLI Delta App має бути Rust-бінарником, не JS; щоб зберегти інваріант «GUI і CLI —
одна логіка» (n-tool-surface), уся логіка гейт-ядра переїжджає у спільний Rust-crate, який лінкують і
Tauri-бекенд, і CLI. JS-мок мандатної семантики поступається місцем справжньому crate `mt-mandates`
(nitra/mt-rust) — контракт-перший порядок (рішення Ж специфікації) нарешті дає плід.

**Зроблено (цей інкремент):**

- `delta/crates/delta-core` — новий lib-crate, зареєстрований у кореневому workspace
  (`Cargo.toml: members`). Лінкує `mt-mandates` git-залежністю (`ssh://git@github.com/nitra/mt-rust.git`,
  той самий патерн, що `owner/src-tauri` лінкує `mt-core`).
  - `mandates.rs` — view-деривації (`mandatesForOwner`/`escalationChain`/`modelMandates`/
    `rootMandates`/`deriveMandatesView`) поверх типів `mt_mandates::Mandate`. Сам парсинг/валідація
    `.mt/mandates.yaml` тепер через `mt_mandates::parse_mandates_str` — **семантика змінилась**: файл
    валідується структурно ЦІЛИМ (один невалідний запис/відсутнє поле `generation` валить увесь файл),
    на відміну від толерантного JS-мока, що відкидав побиті записи мовчки. Задокументована різниця
    контракту, не регресія.
  - `decisions.rs` — `parseDecisionRequest`/`depthForFacets`/`deriveQueue`/`requiresQuorum`/
    `resolveApprovers`/`deriveQuorumStatus`, 1:1 порт `src/decisions.js`. Kill-switch/delegation
    читаються лише як дані (сусідні файли) — власна логіка цих шарів лишається в JS до фази B.
  - `signing.rs` — Ed25519-підпис пристрою на `ed25519-dalek` (заміна Web Crypto): та сама
    канонікалізація (рекурсивне сортування ключів об'єктів, компактний JSON), сумісне читання
    існуючого `device_key.json` (JWK `d` — сирий 32-байтний seed, той самий формат, що `ed25519-dalek`
    приймає напряму) з fail-safe регенерацією + міграційною позначкою при несумісності. **Крос-мовний
    тест** (`cross_language_fixture_from_web_crypto_verifies_in_rust`) підтверджує байт-у-байт
    сумісність: підпис, згенерований `bun` + `src/signing.js`, верифікується Rust-стороною, і Rust,
    підписуючи той самий payload тим самим ключем, відтворює ІДЕНТИЧНИЙ підпис (Ed25519 —
    детермінований, RFC 8032) — існуючі `device_key.json`/approval-фікстури лишаються верифіковними,
    перегенерація фікстур не знадобилась.
  - `approval.rs` — інваріант «підпис без завершеного квізу неможливий»
    (`quizIsComplete`/`validateApprovalPreconditions`/`buildAndSignApproval` перевіряють ДО підпису),
    `verifyApproval`, `formatApprovalFile`.
  - **76 Rust-тестів, усі зелені** — усі кейси `mandates.test.js`/`decisions.test.js`/
    `signing.test.js`/`approval.test.js` портовано 1:1 (не вибірково), плюс крос-мовний тест вище.
    `cargo fmt`/`cargo clippy -p delta-core --all-targets -- -D warnings` чисті.
    `cargo check --workspace` не ламає жоден із наявних crate (`app/src-tauri`, `owner/src-tauri`,
    `owner-llm`, `delta/src-tauri`).

**НЕ зроблено (залишок обсягу фази A — наступний інкремент):**

- **`quiz.rs`** — генерація one-tap/standard/teach-back (HTTP до LLM-ендпоінта + детермінований
  фолбек), мікроуроки, `explain`-шари, spaced repetition, запис у `knowledge.json` — НЕ портовано.
  Найбільший і найскладніший модуль (`src/quiz.js`, 825 рядків), лишається в JS.
- **`quorum.rs`** — мультипартійний підпис для irreversible-рішень (`src/quorum.js`) залежить від
  `quiz.rs` (teach-back-оцінювач) — НЕ портовано, лишається в JS.
- **`delta/crates/delta-cli`** — окремий bin-crate з `clap` для CLI-паритету — НЕ створено.
  `bin/delta.mjs` лишається ЄДИНИМ CLI (усі tools, не лише фаза B).
- **Tauri-команди для нових tools** і перемикання `src/tool/index.js: HANDLERS_GUI` з JS-модулів на
  `invoke` — НЕ зроблено. GUI й далі використовує JS-логіку для мандатів/рішень/квізу/підпису/кворуму.
- **JS-модулі НЕ видалені** — `mandates.js`/`decisions.js`/`quiz.js`/`signing.js`/`approval.js`/
  `decision-flow.js`/`quorum.js` і їхні vitest лишаються на місці й ПРАЦЮЮТЬ (445 vitest, як і
  раніше) — видалення заміненого JS відбудеться разом із повним CLI/GUI-перемиканням наступного
  інкремента, не раніше (щоб застосунок жодного моменту не лишався непрацездатним).
- Демо-прогони M1/M3 через новий Rust CLI, наскрізна перевірка `vite build`/`cargo check src-tauri` з
  новими Tauri-командами — залежать від пунктів вище, НЕ виконані.

Причина розбиття: повний обсяг фази A (гейт-ядро + CLI + Tauri-перемикання + видалення JS + два
демо-прогони) — це надто великий та ризикований єдиний крок, щоб пропустити верифікацію нашвидкуруч
(«не тримай мертвий код» — але й «не лишай застосунок непрацездатним» важливіше). Цей інкремент —
самодостатня, повністю протестована бібліотечна основа (криптографія й парсери — найризикованіші
частини, з крос-мовною перевіркою байт-сумісності), яку `delta-cli`/Tauri-шар наступного інкремента
підключить, не переписуючи.

## Статус: M0–M6 реалізовано, борги

Усі шість мілстоунів (`M0`–`M6`) реалізовано в цьому workspace (`delta/`), 445 vitest + 7 Rust зелені.
Чесний список того, що лишається боргом — без прикрашання:

- **napi-стикування з `mt-mandates` crate ще не сталось** — `src/mandates.js`/`src/mandate-change.js`
  лишаються мок-парсерами за буквою контракту (`mt: docs/architecture/mandates.md`), не napi-викликами
  crate mt-rust. Заміна прийде, коли crate стабілізується (M6 фаза 0 роадмапу mt) — контракт-перший
  порядок (рішення Ж спеки) досі в силі.
- **Doc-files беклог** — частина модулів (`decision-flow.js`, `delegation.js`, `directory.js`,
  `drift.js`, `knowledge.js`, `mandates.js`, `onboarding.js`, `quiz.js`, `quorum.js`, `signing.js`,
  `staff.js`, `watcher.js`, `what-system-knows.js`, і нові M6-модулі `report.js`/`review.js`/
  `kill-switch.js`/`org.js`) досі без файлової доки `src/docs/<stem>.md` — той самий стан, що успадкований
  від M1-M5 (доку веде окремий таймбоксований прогін `/n-doc-files`, не кожна задача).
- **Іконки застосунку** — відсутні (той самий дефолт Tauri-скаффолда, що з M0).
- **Голосовий ввід teach-back** — не реалізовано; macOS-диктовка друкує в ту саму textarea сама,
  окремого механізму намірено не додавали (задокументовано в M5).
- **Relay для живих нотифікацій** — досі файловий полінг (`watcher_scan`/headless-крон
  `bin/delta-watcher.mjs`), не push. Деградація «полінг замість пушу» задокументована з M4.
- **UI майстра делегування з симуляцією (конституція п.12)** — «Довіряю» лишається MVP-скоупом однієї
  осі (audacity ±1 щабель, `budget_eur`-фолбек), не повним багатовісним редактором мандата з прогнозом
  «за минулий місяць це були б N рішень» на історії. Той самий свідомо звужений обсяг M3, перенесений
  без змін.
- **Немає живого tool-шляху, яким модель сама підписує decision-request** — `track-record.js`/
  `review.js: draftWidenCandidates` рахують «модельні» рішення за атрибуцією pubkey в
  `device-registry.json`, але жоден CLI/GUI tool не дає моделі підписати ЗВИЧАЙНЕ рішення власним ключем
  (лише петиція/кандор/звуження мандата підписуються модельним ключем напряму) — у демо M6 і тестах
  модельні рішення матеріалізовані як фікстури (той самий підхід, що `track-record.test.js`), не через
  живий виклик. Кандидат для наступного мілстоуна: `decision_delegate` дає моделі чергу, але не дає їй
  інструмента `decision_approve` власним ключем.
- **Kill-switch off — «видалення» через порожній запис, не Rust-команда delete** — задокументоване
  рішення M6 (заголовок `kill-switch.js`): жодних нових Tauri-команд, `write_text_file('')` над
  generic-шаром замість окремого `remove_file`.
- **`review_agenda` ідемпотентний лише в межах одного `generation`** — повторний прогін у той самий
  тиждень освіжає ту саму чернетку (`changeId: review-{generation}-{model}`), але не запобігає
  «спаму» чернеток, якщо генерація файлу зміниться між прогонами того самого тижня (рідкісний
  edge-case, не покритий тестом).
