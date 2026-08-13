# delta

Референс-реалізація фреймворку «Дельта» — спека
[`docs/specs/260809-delta-app.md`](../docs/specs/260809-delta-app.md). Одиниця інтерфейсу — **мандат**, не задача
(`app`) і не рішення в черзі (`owner`): застосунок показує межу твоїх повноважень, деривовану з `.mt/mandates.yaml`
(схема — mt: `docs/architecture/mandates.md`).

**Уся логіка гейт-ядра й tool-поверхні — Rust** (`delta/crates/delta-core`), спільна для GUI (Tauri) і CLI
(`delta-cli`, бінарник `delta`) — інваріант «GUI і CLI — одна логіка» (n-tool-surface). JS-шар лишився лише
Vue-компонентами й тонкими композаблами, що викликають `invoke`. Деталі архітектури й повний список
портованих модулів — розділ [«Rust-порт гейт-ядра та tool-поверхні»](#rust-порт-гейт-ядра-та-tool-поверхні-завершено)
нижче.

## M0 — скелет + карта мандатів read-only

Поточний мілстоун (демо-критерій: відкрити застосунок двом користувачам — кожен бачить свій зріз; `delta
mandates_show` дає те саме в CLI):

- Tauri 2 + Vue 3 + Quasar скаффолд (порт 1440, `com.nitra.delta`, акцент teal).
- Парсер/деривація `.mt/mandates.yaml` (`delta-core::mandates`) над справжнім контрактним crate `mt_mandates`
  (nitra/mt-rust) — читання, валідація, деривації: мій мандат за handle, ланцюг ескалації, ШІ-мандати
  (`kind: model`).
- Ідентичність (handle) і шлях до воркспейсу — локальний конфіг застосунку (PII поза git), той самий підхід, що
  `owner` (whoami/set_identity).
- UI «Карта мандатів»: мій мандат (підсвічений), ШІ-мандати окремою секцією, уся карта, ланцюг ескалації,
  доброзичливий empty state з поясненням формату — read-only, без редагування.
- CLI-паритет: `delta` (Rust-бінарник, `delta/crates/delta-cli`) з tools `whoami`, `set_identity`, `mandates_dir`,
  `set_mandates_dir`, `mandates_show` — той самий каталог (`src/tool/catalog.js`) і та сама Rust-деривація, що GUI.

## M1 — черга «Вирішую», квіз-гейт (one-tap), підпис Ed25519

Демо-критерій: підписати рішення; git log показує пару `decision-request` + `quiz` + підпис; без квізу підпис
неможливий. M1 реалізує лише `depth: one-tap` — `standard`/`teach-back` лишаються M2.

- **Decision-request-парсер** (`delta-core::decisions`) — файловий мок git-refs транспорту
  `refs/mt/runs/{run-id}/decisions/NNNN-decision-request.md` (mt: `docs/architecture/mandates.md`, «Артефакт
  decision-request»): скануємо `<mandatesDir>/runs/{run-id}/decisions/NNNN-decision-request.md` на диску —
  структура директорій дзеркалить контрактний git-шлях, поки git-refs транспорт не прийде з mt-rust.
- **Черга «Вирішую»** (`derive_queue`) — відкриті decision-request-и (немає сусіднього `NNNN-approval.json`), чий
  `computed_owner` == мій handle, відсортовані за leverage-фасетами (`irreversible`/ширший `blast_radius` — вище).
- **Квіз-генератор one-tap** (`delta-core::quiz`) — джерело питання: локальний OpenAI-сумісний ендпоінт (дефолт
  `http://127.0.0.1:8080`, модель `gemma-4-26b-a4b-it` — конфіг у `config.json`, не константа); ендпоінт
  недоступний → детермінований фолбек, зібраний із самих варіантів decision-request (`generated_by:
  quiz-gen-fallback`). Квіз ніколи не пропускається; `generated_by` завжди ≠ `recommended_by` decision-request.
- **Квіз-файл** `NNNN-quiz.md` (`delta-core::quiz`: `format_quiz_file`/`parse_quiz_file`) — точний контрактний
  формат: `schema_version: 1` першим полем, `depth`, `iterations`, `time_to_understanding_sec`; без полів
  `passed`/`failed` («фейл ≠ покарання» — неправильна відповідь дописує «Питання 1 (спроба N)» з мікроуроком, той
  самий номер питання).
- **Підпис Ed25519** (`delta-core::signing`) — ключ пристрою генерується `ed25519-dalek` при першому підписі,
  зберігається в `device_key.json` поряд із `config.json` (поза git; приватний ключ ніколи в репо).
  `delta-core::approval: build_and_sign_approval` перевіряє інваріант «квіз завершено» ДО підпису — без
  `iterations`/`time_to_understanding_sec` підпис кидає, не пишеться.
- **`NNNN-approval.json`** поруч із decision-request: `{ schema_version, request_id, approved, chosen_option,
  quiz_ref, signed_at, pubkey, signature }`.
- **UI «Вирішую»** (нова вкладка поряд із «Карта мандатів») — картка розвилки (`DecisionCard.vue`): контекст,
  варіанти, рекомендація агента, deadline_cost, фасети → вибір варіанта → one-tap квіз-картка → підпис.
- **CLI-паритет**: `decisions_show`, `decision_quiz`, `decision_approve`, `device_pubkey`, `llm_config`/
  `set_llm_config` — та сама Rust-деривація (`delta-core::decision_flow`), що GUI.

### Demo-послідовність

```bash
cd delta
cargo build -p delta-cli
export DELTA_BIN=../target/debug/delta
export DELTA_CONFIG_PATH=/tmp/delta-demo-m1/config.json   # ізольований конфіг для демо
mkdir -p /tmp/delta-demo-m1/runs/demo-1/decisions

# 1. Decision-request у чергу
cat > /tmp/delta-demo-m1/runs/demo-1/decisions/0001-decision-request.md <<'EOF'
---
type: decision-request
computed_owner: olena
escalation_chain: [olena, vitalii]
leverage_facets: { irreversible: false, blast_radius: node }
decision_type: architecture
---
## Контекст
Компонент дублює верстку чипів між двома рядками.
## Варіанти
### A. Спільний компонент
### B. Спільний composable
## Рекомендація агента
Варіант B — лишає верстку локальною.
EOF

# 2. Онбординг — ідентичність і шлях до воркспейсу
$DELTA_BIN set_identity '{"handle":"olena"}'
$DELTA_BIN set_mandates_dir '{"dir":"/tmp/delta-demo-m1"}'

# 3. decisions_show — відкрита розвилка «olena» у черзі
$DELTA_BIN decisions_show '{}'

# 4. decision_quiz — генерує one-tap питання (фолбек, якщо LLM-ендпоінт недоступний), пише чернетку NNNN-quiz.md
$DELTA_BIN decision_quiz '{"runId":"demo-1","nnnn":"0001","chosenOption":"B"}'

# 5. decision_approve — неправильна відповідь: мікроурок, iterations++, approval НЕ пишеться
$DELTA_BIN decision_approve '{"runId":"demo-1","nnnn":"0001","chosenOption":"B","answer":0}'

# 6. decision_approve — правильна відповідь (індекс з output.options кроку 4/5): фіналізує квіз,
#    пише підписаний NNNN-approval.json
$DELTA_BIN decision_approve '{"runId":"demo-1","nnnn":"0001","chosenOption":"B","answer":1}'

# 7. Пара decision-request + quiz + approval поруч у decisions/
ls /tmp/delta-demo-m1/runs/demo-1/decisions/
# 0001-decision-request.md  0001-quiz.md  0001-approval.json

# 8. Черга знову порожня — розвилка закрита
$DELTA_BIN decisions_show '{}'
```

## M2 — навчальний квіз: мікроуроки, навчальний режим, база знань, spaced repetition, depth: standard

Демо-критерій: фейл квізу → розгортання контексту → повторне питання → мікроурок ліг в особисту базу знань
(докладніше — `docs/specs/260809-delta-app.md`, «Обсяг M2»).

- **Мікроурок — завжди, не лише на фейлі.** `decision_quiz`/`decision_approve` повертають `microlesson` після
  БУДЬ-якої відповіді (правильної теж — M1 показувала лише після неправильної), «у момент максимальної уваги»
  (конституція п.2). Генерується LLM разом із питанням; у фолбек-режимі — детермінований з полів decision-request
  (`generated_by: quiz-gen-fallback` чесно позначає джерело).
- **Навчальний режим при фейлі («право на глибину»)** — `delta-core::decision_flow: submit_quiz_answer` повертає
  поле `explain`: розгортання decision-request шар за шаром, КУМУЛЯТИВНО з кожним наступним фейлом того самого
  питання — 1-й фейл `## Контекст`; 2-й — і контекст, і наслідки всіх варіантів; 3-й+ — і те, і те, і
  `## Рекомендація агента` з обґрунтуванням. Повторне питання після кожного шару — те саме формулювання, або
  перефразоване LLM-ом через `rephrase_question` (best-effort — options/правильна відповідь НІКОЛИ не міняються
  перефразуванням), коли ендпоінт живий.
- **Особиста база знань** (`delta-core::knowledge`) — локальне сховище ПОЗА git, файл-сусід `config.json`/
  `device_key.json` (`knowledge.json`, той самий рівень приватності, що ключ пристрою: «що про мене знає
  система» бачиш лише ти, конституція п.9). Кожен ПОВНІСТЮ завершений квіз дописує запис `{decisionRef, domain,
  question, options, correctAnswer, microlesson, iterations, timeToUnderstandingSec, completedAt, intervalDays,
  lastRepeatedAt}` — домен береться з `decision_type` фронтматера decision-request (власне розширення M2, `null`
  → `'general'`). Деривації: `domain_digest` (конспект по доменах — «що я зрозумів, підписуючи»), приватний тренд
  `time_to_understanding_trend` (метрика №3 спеки: тренд вниз = навчальна функція квізів працює; <2 записів
  домену — чесний статус `insufficient-data`, не вигаданий «flat»). UI: вкладка «Знання» (конспект + тренд
  простим списком/числами, без чартів); CLI: `knowledge_show`.
- **Spaced repetition на живих рішеннях** (п.5 конституції) — генератор квізу для НОВОЇ розвилки `depth: one-tap`
  підмішує (як друге питання, позначене «Питання 2 (повторення)» у квіз-файлі) повторення знання з бази, чий
  інтервал настав: драбинка **1 → 3 → 7 → 21 днів** від `completedAt`/`lastRepeatedAt`, домен має збігатися з
  доменом нової розвилки. Немає давнього дозрілого знання в домені — квіз лишається одним питанням (штатний, не
  винятковий шлях). Правильна відповідь на повторення просуває драбинку; неправильна скидає до 1 дня (фейл ≠
  покарання — коротший інтервал, не виключення з бази). `standard`/spaced-repetition свідомо НЕ стекуються в M2
  (задокументоване рішення обсягу — уникає комбінаторного вибуху UX у першій ітерації).
- **`depth: standard`** — другий рівень глибини за контрактом (mandates.md, «Крок 3»: decide-and-inform —
  середні leverage-фасети **і лише** reversible): 2 питання про саму розвилку (без переказу — teach-back
  лишається M5), обидва мають бути здані правильно, перш ніж підпис стане доступним. `depth_for_facets`
  (`delta-core::decisions`) доведено до контрактного мапінгу й задокументовано таблицею.
- **Квіз-файл узагальнено на кілька питань** (`delta-core::quiz`) — `## Питання N` / `## Питання N (повторення)` /
  `## Питання N (спроба K)`, byte-сумісно з M1-форматом для one-question квізів.

### Demo-послідовність (навчальний цикл: фейл → шари → мікроурок у базі)

```bash
cd delta
export DELTA_BIN=../target/debug/delta
export DELTA_CONFIG_PATH=/tmp/delta-demo-m2/config.json
mkdir -p /tmp/delta-demo-m2/runs/demo-1/decisions

cat > /tmp/delta-demo-m2/runs/demo-1/decisions/0001-decision-request.md <<'EOF'
---
type: decision-request
computed_owner: olena
escalation_chain: [olena, vitalii]
leverage_facets: { irreversible: false, blast_radius: node }
decision_type: architecture
---
## Контекст
Компонент дублює верстку чипів між двома рядками.
## Варіанти
### A. Спільний компонент
### B. Спільний composable
## Рекомендація агента
Варіант B — лишає верстку локальною.
EOF

$DELTA_BIN set_identity '{"handle":"olena"}'
$DELTA_BIN set_mandates_dir '{"dir":"/tmp/delta-demo-m2"}'

# 1. Генерує питання (fallback без живого LLM-ендпоінта — quiz-gen-fallback)
$DELTA_BIN decision_quiz '{"runId":"demo-1","nnnn":"0001","chosenOption":"B"}'

# 2. Неправильна відповідь (свідомо помилковий індекс) — мікроурок + explain: layer 1 (## Контекст)
$DELTA_BIN decision_approve '{"runId":"demo-1","nnnn":"0001","chosenOption":"B","answer":0}'
# output.explain[0] = {"layer":1,"heading":"Контекст","content":"..."}; output.microlesson присутній

# 3. Правильна відповідь (індекс із кроку 1 output.options) — фіналізує квіз, підписує, дописує базу знань
$DELTA_BIN decision_approve '{"runId":"demo-1","nnnn":"0001","chosenOption":"B","answer":1}'

# 4. Мікроурок ліг у особисту базу знань — конспект домену architecture + тренд
$DELTA_BIN knowledge_show '{}'
cat /tmp/delta-demo-m2/knowledge.json
```

### Демо spaced repetition (повторення через нову розвилку)

Інтервал (1 день) не можна прогнати в реальному часі одним CLI-викликом — підроби `completedAt` у минуле
безпосередньо у `knowledge.json` (той самий формат, що дописує `delta-core::knowledge: append_knowledge_entry`),
тоді підклади НОВИЙ decision-request того самого домену (`decision_type`) і виклич `decision_quiz` — друге
питання підмішається автоматично, файл покаже `## Питання 2 (повторення)`.

## M3 — ШІ-мандати: трек-рекорд, «Довіряю», ШІ-петиція, «остання константа» конструктивно

Демо-критерій: модель подає петицію на розширення власного мандата; єдиний шлях застосувати зміну —
людський підпис делегатора через звичайний квіз-гейт (форсовано на найвищу ДОСТУПНУ глибину — `standard`);
спроба підписати саму мутацію мандата модельним ключем відхиляється безумовно
(докладніше — `docs/specs/260809-delta-app.md`, «Обсяг M3»).

- **`validate_mandate_change` — справжній `mt_mandates::change`** (не мок): `generation` мусить зрости РІВНО на
  1; зміна одного owner-мандата класифікується по осях (`scope.refs`/`scope.decision_types`/
  `thresholds.budget_eur`/`risk`/`irreversible`/`audacity`) на `added`/`removed`/`kind-changed`/
  `escalates-to-changed`/`widened`/`narrowed`/`unchanged` — змішаний diff (одна вісь звужується, інша
  розширюється) трактується як РОЗШИРЕННЯ, видалення мандата — звуження «до нуля». Розширення/додавання вимагає
  підпису делегатора рівня вище (старого `escalates_to`); звуження/видалення — самопідпис owner; зміна
  `escalates_to` — ПОДВІЙНИЙ підпис (новий адресат + старий делегатор). **«Остання константа»:** розширення
  `kind: model` мандата (включно з `audacity` вгору) підписує ЛИШЕ людський ключ — модельний підпис на такому
  дифі відхиляється безумовно, навіть від правильного делегатора. Крипто-шар підписує domain-separated хеш
  (`mt-mandate-change-v1`) через `mt_mandates::change`, окремий крипто-шлях від `ApprovalResponse`
  (`delta-core::signing`) — задокументована різниця в `delta-core::mandate_change`.
- **`device-registry.json`** (`delta-core::device_registry`) — публічний реєстр `handle → {role, pubkeyBase64}`,
  живе В `mandatesDir` (комітиться в git, на відміну від приватного `device_key.json` поза git) — pubkey-кеш,
  проти якого `validate_mandate_change` звіряє заявлену роль підписанта. Свій pubkey реєструється при першому
  підписі мандат-зміни (той самий інваріант, що M1 `device_key.json`).
- **Трек-рекорд** (`delta-core::track_record`) — «активність і послідовність», НЕ success rate (немає ще
  audit-механіки/аналізатора ескалацій — чесно назване обмеження): кількість підписаних рішень моделі за
  `decision_type`, останні N з розгорткою, частка без override. Override — **задокументоване спрощення**:
  пізніший (за `signed_at`) людський `ApprovalResponse` у ТОМУ САМОМУ run-і з протилежним `chosen_option`
  (не обов'язково та сама розвилка — справжня семантика потребує графової прив'язки, якої мок не має).
- **«Довіряю»** (`delta-core::trust` + `TrustView.vue`/`use-trust.js`) — мої ШІ-мандати (`escalates_to === я`) з
  трек-рекордом, порогами, audacity-описом наслідків (`low`: агент питає перед відмовою постачальнику;
  `medium`: відмовляє сам у reversible; `high`: жорсткі переговори сам, обмежено інваріантом reversible —
  статичні тексти UI). Кнопки MVP-скоуп однієї осі (audacity ± один щабель, `budget_eur` фолбек на межах —
  повний багатовісний майстер делегування лишається пізнішому мілстоуну): «звузити» — самопідпис, миттєво,
  без квізу; «розширити» — ЛИШЕ через change-proposal, немає прямого шляху редагувати `kind: model` мандат.
- **Change-proposal** (`delta-core::change_proposal`) — розширення НІКОЛИ не пише `.mt/mandates.yaml` напряму:
  матеріалізується як звичайний decision-request у черзі делегатора
  (`runs/mandate-change-{changeId}/decisions/0001-decision-request.md` — плоский run-id, не вкладений
  сегмент з задачі, щоб не чіпати однорівневий сканер CLI/GUI; сусідній `0001-change.json` несе машинописний
  `{old, new}`), `leverage_facets` форсовані (`irreversible: false`, `blast_radius: subtree`) на найвищу
  глибину, яку M2 реалізує (`standard`) — `teach-back` лишається M5, форс задокументовано в module doc.
  Людина проходить ЗВИЧАЙНИЙ `decision_quiz`/`decision_approve` (варіант A застосувати / B відхилити);
  `mandate_change_apply` — міст між двома незалежними підписами цього застосунку: той самий фізичний ключ, що
  підписав `ApprovalResponse` квіз-гейта, підписує ОКРЕМИЙ акт `validate_mandate_change` (одна людська дія, два
  криптографічно незалежні підтвердження).
- **ШІ-петиція** (`delta-core::ai_petition`, tool `ai_petition`) — headless, симулює модель: формує draft-
  розширення власного мандата з evidence з трек-рекорду, підписує ЛИШЕ петицію (не зміну) модельним ключем,
  кладе ту саму change-proposal у чергу делегатора. Модель НЕ має окремого фізичного пристрою в цьому
  застосунку — застосунок локально утримує її ключ (той самий каталог, що людський `device_key.json`), окреме
  задокументоване рішення M3.

### Demo-послідовність (петиція → чергу людини → квіз найвищої глибини → підпис → відмова модельного підпису)

```bash
cd delta
export DELTA_BIN=../target/debug/delta
export DELTA_CONFIG_PATH=/tmp/delta-demo-m3/config.json
mkdir -p /tmp/delta-demo-m3/.mt

cat > /tmp/delta-demo-m3/.mt/mandates.yaml <<'EOF'
generation: 1
mandates:
  - owner: fable-5
    kind: model
    scope: { refs: ["refs/mt/tasks/routine/**"], decision_types: [ops] }
    thresholds: { budget_eur: 200, risk: low, irreversible: false, audacity: medium }
    escalates_to: olena
  - owner: olena
    scope: { refs: ["refs/mt/tasks/design/**"], decision_types: [architecture] }
    thresholds: { budget_eur: 2000, risk: medium, irreversible: false }
    escalates_to: vitalii
  - owner: vitalii
    scope: { refs: ["refs/mt/**"], decision_types: ["*"] }
    thresholds: {}
    escalates_to: null
EOF

$DELTA_BIN set_identity '{"handle":"olena"}'
$DELTA_BIN set_mandates_dir '{"dir":"/tmp/delta-demo-m3"}'

# 1. fable-5 подає петицію на розширення власного мандата (audacity medium → high)
$DELTA_BIN ai_petition '{"modelHandle":"fable-5","changeId":"demo-1"}'

# 2. Change-proposal тепер у черзі olena (decision_type: mandate-change, depth: standard — форсовано)
$DELTA_BIN decisions_show '{}'

# 3-4. olena проходить ЗВИЧАЙНИЙ квіз-гейт (2 питання, chosenOption "A" = застосувати)
$DELTA_BIN decision_quiz '{"runId":"mandate-change-demo-1","nnnn":"0001","chosenOption":"A"}'
$DELTA_BIN decision_approve '{"runId":"mandate-change-demo-1","nnnn":"0001","chosenOption":"A","answer":<індекс з кроку 3>}'
$DELTA_BIN decision_approve '{"runId":"mandate-change-demo-1","nnnn":"0001","chosenOption":"A","answer":<індекс питання 2>}'
# => approved: true, підписаний 0001-approval.json (той самий М1/M2-конвеєр, без винятків)

# 5. СПРОБА застосувати мутацію МОДЕЛЬНИМ підписом — «остання константа», безумовна відмова
$DELTA_BIN mandate_change_apply '{"changeId":"demo-1","handle":"olena","role":"model"}'
# => {"valid":false,"reason":"owner 'fable-5': розширення ШІ-мандата (kind: model) підписує лише
#     людський ключ — модельний підпис відхиляється безумовно"}

# 6. ЛЮДСЬКИЙ підпис (той самий фізичний ключ, що щойно пройшов квіз) — застосовується
$DELTA_BIN mandate_change_apply '{"changeId":"demo-1","handle":"olena","role":"human"}'
# => {"valid":true}; .mt/mandates.yaml: generation 1 → 2, fable-5.thresholds.audacity: medium → high

cat /tmp/delta-demo-m3/.mt/mandates.yaml
$DELTA_BIN trust_show '{}'                                  # оновлений трек-рекорд/audacity
$DELTA_BIN mandate_narrow '{"ownerHandle":"fable-5"}'        # звуження — самопідпис моделі, миттєво, без квізу
```

## M4 — мультиюзер: directory, кворум для irreversible, watcher, тиха година, профспілковий режим

Демо-критерій: кворум 2/2 на irreversible-рішенні з двох пристроїв; watcher пінгує виконавця раніше за
власника (докладніше — `docs/specs/260809-delta-app.md`, «Обсяг M4»; контракт — `mt: docs/architecture/mandates.md`,
«Process watcher»/«Маршрутизатор ескалацій»).

- **Directory** (`delta-core::directory`) — `<mandatesDir>/.mt/directory.json` (handle → `{name, email, lang}`),
  PII ПОЗА git (конституція п.8: «Ідентичність = handle, PII поза git»; спека 260714, п.1) — корінь репо ігнорує
  `**/.mt/directory.json`. Display-імена підставляються з фолбеком на handle на карті мандатів, у «Довіряю» й у
  черзі — UI-композабл `src/composables/use-directory.js`; адмін-секція (список handle-ів з редагованим
  display-іменем) — розкривна панель на вкладці «Карта мандатів». CLI/tools: `directory_show`, `directory_set`.
- **Мультипартійний підпис (кворум) для irreversible** (`delta-core::quorum`) — decision-request з
  `leverage_facets.irreversible: true` вимагає підписів УСІХ handle-ів фронтматер-поля `approvers: [...]`
  (відсутнє → фолбек `[computed_owner]`, `delta-core::decisions: resolve_approvers`). Кожен підписант проходить
  ВЛАСНИЙ квіз (`NNNN-quiz-{handle}.md`, глибина — той самий `depth_for_facets`, що одноосібний шлях: з M5
  кожне irreversible-рішення форсує `teach-back`) і пише СВІЙ `NNNN-approval-{handle}.json` (та сама схема
  `ApprovalResponse`, що M1, плюс поле `signer_handle`). `delta-core::decisions: derive_quorum_status` деривує
  стан із самих approval-файлів: `'closed'` — усі підписали ОДНАКОВИЙ `chosen_option`; `'diverged'` — усі
  підписали, але розійшлися (рішення лишається ВІДКРИТИМ з видимим статусом, жодної авторезолюції); `'pending'`
  — не всі підписали. Черга (`derive_queue`) показує кворумну картку УСІМ approvers, поки статус не `'closed'`
  — навіть тим, хто вже підписав (`awaitingMe: false`) — транспарентність «хто лишився». CLI/tools:
  `quorum_quiz`, `quorum_approve`, `quorum_status`.
- **Watcher** (`delta-core::watcher`, tool `watcher_scan`, headless-вхід — той самий tool `delta watcher_scan`,
  а не окремий бінарник) — сканує `runs/*/decisions/`: відкриті decision-request-и старші за `sla_hours` (дефолт
  24) → СПЕРШУ пінг виконавцю/підписанту («у тебе висить X — допомогти?», mandates.md: порядок сигналізації),
  без руху ще `grace_hours` (дефолт 24) → ескалація власнику вище по `escalation_chain`, у форматі «X застрягло,
  {handle} в курсі з {дата}», ЗАВЖДИ з прозорою копією в лозі самого виконавця. Час відкриття — власне
  розширення `opened_at` (ISO); відсутнє поле → вік невідомий, watcher свідомо НЕ пінгує (fail-safe).
  Нотифікації — файловий лог `<mandatesDir>/.mt/notifications/{handle}.jsonl` (append-only). UI: вкладка
  «Стежу» (список нотифікацій + кнопка ручного прогону), CLI: `notifications_show`.
- **Тиха година** (`quiet_hours`/`set_quiet_hours`, конфіг пристрою `{start, end}` — `"HH:MM"`, підтримує нічне
  вікно через північ) — некритичні нотифікації, згенеровані watcher-ом у тиху годину, і далі пишуться в лог
  одразу (headless-актор не чекає кінця вікна), але з `deliverAt` = момент кінця вікна й `batched: true` —
  споживач (`notifications_show`/UI) фільтрує «видимі зараз» за `deliverAt <= now`. Irreversible-рішення З
  дедлайном (`deadline_cost` заповнено) — ВИНЯТОК, `critical: true`, доставляється негайно навіть у тиху годину.
- **Профспілковий режим** (`delta-core::what_system_knows`, tool `what_system_knows`, конституція п.9) — чистий
  агрегатор БЕЗ нових зборів даних: моя база знань (записи/тренд), мої нотифікації від watcher-а (пінги мені +
  що з них пішло вгору, `escalatedFromMe`), мій pubkey/роль з `device-registry.js`. UI: секція на вкладці «Стежу».

### Demo-послідовність (реально прогнана: кворум 2/2 з двома device-key «пристроями» + watcher)

<!-- jscpd:ignore-start -->
<!-- Кожна demo-послідовність у цьому README навмисно самодостатня (copy-paste-run без
     переходів між секціями) — спільний CLI-boilerplate (mandates.yaml, decision-request
     heredoc, quorum_quiz/approve) між демо є формою, а не дублюванням логіки. -->

```bash
cd delta
cargo build -p delta-cli
export DELTA_BIN=../target/debug/delta

mkdir -p /tmp/delta-demo-m4/.mt /tmp/delta-demo-m4/runs/demo-1/decisions /tmp/delta-demo-m4/runs/demo-2/decisions

cat > /tmp/delta-demo-m4/.mt/mandates.yaml <<'EOF'
generation: 1
mandates:
  - owner: fable-5
    kind: model
    scope: { refs: ["refs/mt/tasks/routine/**"], decision_types: [ops] }
    thresholds: { budget_eur: 200, risk: low, irreversible: false, audacity: medium }
    escalates_to: olena
  - owner: olena
    scope: { refs: ["refs/mt/tasks/design/**"], decision_types: [architecture, ux] }
    thresholds: { budget_eur: 2000, risk: medium, irreversible: false }
    escalates_to: vitalii
  - owner: vitalii
    scope: { refs: ["refs/mt/**"], decision_types: ["*"] }
    thresholds: {}
    escalates_to: null
EOF

# irreversible decision — требує кворуму двох approvers
cat > /tmp/delta-demo-m4/runs/demo-1/decisions/0001-decision-request.md <<'EOF'
---
type: decision-request
computed_owner: olena
approvers: [olena, vitalii]
escalation_chain: [olena, vitalii]
leverage_facets: { irreversible: true, blast_radius: company }
decision_type: architecture
recommended_by: fable-5
opened_at: "2026-08-01T09:00:00.000Z"
deadline_cost: "блокує реліз v2 продукту"
---
## Контекст
Команда пропонує перейти на новий біллінговий провайдер X замість поточного Y — контракт з Y закінчується
через два тижні, а міграція незворотна.
## Варіанти
### A. Мігрувати на провайдера X
Нижчі комісії, але міграція вимагає 3 дні простою білінгу.
### B. Продовжити контракт з Y на рік
Без простою, але вищі комісії й потенційний lock-in.
## Рекомендація агента
Варіант A — довгострокова економія переважує короткий простій.
## Ціна затримки
Контракт з Y спливає за два тижні.
EOF

# звичайна (не irreversible) розвилка — для watcher-демо, свідомо застаріла
cat > /tmp/delta-demo-m4/runs/demo-2/decisions/0001-decision-request.md <<'EOF'
---
type: decision-request
computed_owner: olena
escalation_chain: [olena, vitalii]
leverage_facets: { irreversible: false, blast_radius: node }
decision_type: ops
opened_at: "2026-08-01T00:00:00.000Z"
---
## Контекст
Застарілий cron-скрипт очищення логів падає мовчки третій тиждень поспіль.
## Варіанти
### A. Переписати на новий watcher-модуль
### B. Залатати існуючий скрипт мінімально
## Рекомендація агента
Варіант B — швидше, ризик нижчий.
EOF

# Два "пристрої" — окремі DELTA_CONFIG_PATH, кожен з власним Ed25519-ключем.
export OLENA_CFG=/tmp/delta-demo-m4-olena/config.json
export VITALII_CFG=/tmp/delta-demo-m4-vitalii/config.json
DELTA_CONFIG_PATH=$OLENA_CFG   $DELTA_BIN set_identity '{"handle":"olena"}'
DELTA_CONFIG_PATH=$OLENA_CFG   $DELTA_BIN set_mandates_dir '{"dir":"/tmp/delta-demo-m4"}'
DELTA_CONFIG_PATH=$VITALII_CFG $DELTA_BIN set_identity '{"handle":"vitalii"}'
DELTA_CONFIG_PATH=$VITALII_CFG $DELTA_BIN set_mandates_dir '{"dir":"/tmp/delta-demo-m4"}'

# 1. Адмінка — display-імена (PII поза git, .mt/directory.json)
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN directory_set '{"handle":"olena","name":"Олена Коваль"}'
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN directory_set '{"handle":"vitalii","name":"Віталій Ткаченко"}'

# 2. decisions_show olena — картка з quorum.status: "pending", depth: "teach-back" (irreversible → M5-глибина)
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN decisions_show '{}'

# 3-4. olena проходить ВЛАСНИЙ teach-back (переказ вільним текстом, `transcript`), локальний LLM оцінює
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN quorum_quiz '{"runId":"demo-1","nnnn":"0001","signerHandle":"olena"}'
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN quorum_approve '{"runId":"demo-1","nnnn":"0001","signerHandle":"olena","chosenOption":"A","transcript":"Я підписую перехід на провайдера X замість Y. Наслідок — нижчі комісії, але 3 дні простою білінгу. Ризик — якщо міграція зірветься, клієнти тимчасово не побачать правильні рахунки."}'
# => approved: true, NNNN-approval-olena.json з полем signer_handle

# 5. quorum_status — 1/2, pending
$DELTA_BIN quorum_status '{"mandatesDir":"/tmp/delta-demo-m4","runId":"demo-1","nnnn":"0001"}'

# 6-7. vitalii — ВЛАСНИЙ teach-back (окремий фізичний ключ), ВЛАСНИЙ підпис
DELTA_CONFIG_PATH=$VITALII_CFG $DELTA_BIN quorum_quiz '{"runId":"demo-1","nnnn":"0001","signerHandle":"vitalii"}'
DELTA_CONFIG_PATH=$VITALII_CFG $DELTA_BIN quorum_approve '{"runId":"demo-1","nnnn":"0001","signerHandle":"vitalii","chosenOption":"A","transcript":"Підписую перехід біллінгу з Y на X. Наслідок — комісія падає, зате 3 дні простою під час міграції. Ризик — контракт з Y спливає за два тижні, тому зволікати не можна."}'

# 8. quorum_status — 2/2, ОДНАКОВИЙ chosen_option "A" → closed
$DELTA_BIN quorum_status '{"mandatesDir":"/tmp/delta-demo-m4","runId":"demo-1","nnnn":"0001"}'
# => {"status":"closed","pending":[],"signed":[{"handle":"olena",...},{"handle":"vitalii",...}]}

# 9. Картка зникає з черги ОБОХ (кворум 2/2 закрито)
DELTA_CONFIG_PATH=$OLENA_CFG   $DELTA_BIN decisions_show '{}'   # лише demo-2 (ops)
DELTA_CONFIG_PATH=$VITALII_CFG $DELTA_BIN decisions_show '{}'   # => []

# 10. Watcher — demo-2 старша за SLA(24h)+grace(24h)
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN watcher_scan '{}'
# => notifications: [sla-ping-executor → olena, sla-escalate-owner → vitalii, sla-escalated-notice → olena]
#    ПОРЯДОК масиву — виконавець ЗАВЖДИ раніше за власника (mandates.md, «Process watcher»)

# 11. Кожен бачить лише СВІЙ лог
DELTA_CONFIG_PATH=$OLENA_CFG   $DELTA_BIN notifications_show '{}'  # ping + escalated-notice (прозоро)
DELTA_CONFIG_PATH=$VITALII_CFG $DELTA_BIN notifications_show '{}'  # лише escalate-owner

# 12. Тиха година — некритичне батчиться, повторний скан
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN set_quiet_hours '{"start":"00:00","end":"23:59"}'
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN watcher_scan '{}'
# => notifications[].batched: true, deliverAt — кінець вікна (не зараз)

# 13. Профспілковий режим — усе, що система знає про olena, одним агрегатом
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN what_system_knows '{}'

# Headless-вхід (крон/вручну) — той самий tool, окремого бінарника більше немає:
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN watcher_scan '{}'
```
<!-- jscpd:ignore-end -->

**Реальний прогін цієї послідовності** (цим агентом, проти живого локального LLM на `127.0.0.1:8080`) підтвердив
точно цей вивід: обидва teach-back-перекази оцінені локальною моделлю як `understood: true` (`"Власник чітко
виокремив суть, обраний варіант, наслідок та ризик"`), кожен підписаний ОКРЕМИМ Ed25519-ключем
(`LM4qnaGz.../pubkey`, `TyxfmjFi.../pubkey` — два різні `DELTA_CONFIG_PATH`), `quorum_status` пройшов
`1/2 pending → 2/2 closed`, закрита картка зникла з черги ОБОХ підписантів (`decisions_show` олени лишила лише
непов'язану `demo-2`, віталія — порожній масив), `watcher_scan` без тихої години дав `delivered: 3, batched: 0`
з порядком виконавець-спершу-потім-власник (`sla-ping-executor → olena`, `sla-escalate-owner → vitalii`,
`sla-escalated-notice → olena`), кожен `notifications_show` показав лише свій зріз логу, а після
`set_quiet_hours` той самий скан дав `batched: true` з `deliverAt` на кінець вікна.

**Виправлення, знайдене цим реальним прогоном:** локальний LLM-ендпоінт (`gemma-4-26b-a4b-it`) обгортає
JSON-відповідь у markdown code fence (` ```json ... ``` `) попри пряму інструкцію промпту «СТРОГО JSON без
пояснень поза ним» — `serde_json::from_str` на сирому вмісті падав, і перший прогін teach-back некоректно впав
на чесну відмову (`available: false`) там, де LLM насправді відповів валідно. Додано `delta-core::quiz::
strip_json_code_fence` (знімає fence перед парсингом, використовується усіма чотирма LLM-парсинг-сайтами —
one-tap/standard/teach-back-квізами й `staff::call_llm_staff_brief`) — 3 нові Rust-тести, увесь `delta-core` і
далі зелений.

## M5 — Штаб і зухвалість: teach-back, бриф, кандор, дрейф, делегування

Демо-критерій: дрейф-картка приходить лише власнику; делегування відкладеної дії агенту одним квізом;
teach-back оцінено локально (докладніше — `docs/specs/260809-delta-app.md`, «Обсяг M5»).

- **`depth: teach-back`** (`delta-core::quiz` + `decision_flow` + `quorum`) — найвища глибина квіз-гейта, доводить
  `depth_for_facets` до контракту (mandates.md: «irreversible + широкий blast_radius → teach-back: власник
  переказує рішення і наслідки своїми словами, агент оцінює переказ»). Механіка ПРИНЦИПОВО інша за Q&A-квізи
  M1/M2: немає варіантів відповіді — власник пише ВІЛЬНИЙ ТЕКСТ (`transcript`, CLI-аргумент `decision_approve`/
  `quorum_approve`, UI: textarea з підказкою), локальна модель оцінює ПОКРИТТЯ чотирьох аспектів (суть розвилки,
  обраний варіант, головний наслідок, головний ризик) — `{understood, missingAspects, feedback}`. У квіз-файл —
  точний контракт задачі: «## Переказ (teach-back)» із транскриптом + «### Оцінка локальної моделі» з вердиктом.
  Не зрозумів (`understood: false`) → навчальний режим M2 (`layered_explain`, шари контексту) і новий переказ,
  `iterations++` — той самий інваріант «фейл ≠ покарання». **LLM недоступний → ЧЕСНА відмова**
  (`TEACHBACK_UNAVAILABLE_MESSAGE`, `available: false`) — СВІДОМО без фолбека на нижчу глибину: незворотне
  рішення без доведеного розуміння не підписується (задокументоване рішення M5, відмінне від one-tap/standard,
  де детермінований фолбек є). Кворум (`quorum.rs`) БІЛЬШЕ НЕ форсує `standard` — кожен підписант проходить
  ВЛАСНИЙ teach-back (`NNNN-quiz-{handle}.md`), незалежну оцінку, той самий `available: false`-контракт відмови
  (реально прогнано в M4-демо вище, включно з виправленням markdown-fence).
- **Штаб — бриф перед рішенням** (`delta-core::staff`, tool `decision_brief`, ідея з owner-спеки 260711, «Штаб»)
  — ЛІНИВИЙ виклик (не автогенерується при відкритті картки): LLM стискає decision-request у
  `{contextSummary (3 речення), options (ціна одним рядком кожен), recommendationSummary,
  strongestObjection (анти-rubber-stamping — найсильніше заперечення ПРОТИ рекомендації), delaySummary}`.
  LLM недоступний → структурний фолбек (`fallback_staff_brief`): заголовки/поля decision-request як є, БЕЗ
  стискання, `compressed: false`, `strongestObjection: null` — чесно позначено.
- **Панель «незручна правда»** (`delta-core::candor`, tool `ai_candor` — headless, симулює модель, той самий
  патерн, що `ai_petition`) — окремий інбокс `.mt/candor/{handle}.jsonl`, ВІДДІЛЕНИЙ від черги рішень
  (конституція п.6). Запис `{from_model, statement, evidence_refs, audacity_level, created_at}`; **бюджет
  зухвалості**: `audacity_level` запису ≤ `thresholds.audacity` мандата моделі — той самий бюджет, що
  «жорсткі переговори сам» у «Довіряю», СПОЖИВАЄ той самий ресурс, не окремий канал; модель без мандата, чи
  понад бюджет — відхилено. Позначка «прочитано» — ЛОКАЛЬНО поза git (`candor_read.json`, файл-сусід
  `config.json`), не синхронізується між пристроями. CLI/tools: `ai_candor`, `candor_show`, `candor_mark_read`.
- **Детектор соціального дрейфу — приватне дзеркало** (`delta-core::drift`, tool `drift_scan`, mandates.md:
  «Детектор соціального дрейфу») — сканує МОЇ відкриті одноосібні decision-request-и (кворумні `irreversible`
  виключено — власна механіка прогресу), групує за `decision_type`, два сигнали систематичного відкладання:
  **застаріле** (`opened_at` старше `staleDays`, дефолт 7) і **повторні ітерації без підпису** (квіз-файл з
  `iterations ≥ iterationsThreshold`, дефолт 3, рішення й досі відкрите). Картки зберігаються **ЛОКАЛЬНО поза
  git** (`drift.json`, файл-сусід `knowledge.json`) — **НЕ** в `.mt/notifications`, кожен скан ПЕРЕЗАПИСУЄ файл
  свіжим результатом. CLI/tools: `drift_scan`, `drift_show`.
- **Черга відкладених дій + делегування одним квізом** (`delta-core::delegation`, tools `delegation_quiz` +
  `decision_delegate`) — деривація з дрейф-карток: `find_eligible_model` обирає модель СВОГО делегатора
  (`escalates_to === я`), чий `scope.decision_types` покриває клас; ОДИН **детермінований** (без LLM) one-tap
  квіз «що саме делегуєш і що модель зробить»; правильна відповідь підписує й пише `NNNN-delegation.json`
  `{delegated_to, delegated_by, signed_at, pubkey, signature, quiz_ref}`. **`computed_owner` decision-request НЕ
  переписується** — деривація: `derive_queue` бачить сусідній `NNNN-delegation.json` і переносить розвилку з
  черги делегатора В чергу моделі (`delegatedTo`/`delegatedBy` на картці), сам decision-request лишається
  незмінним назавжди (audit-trail рекомендації не втрачається).

### Demo-послідовність (штаб-бриф, кандор, дрейф → делегування)

<!-- jscpd:ignore-start -->
<!-- Кожна demo-послідовність у цьому README навмисно самодостатня (copy-paste-run без
     переходів між секціями) — спільний CLI-boilerplate (mandates.yaml, decision-request
     heredoc, quorum_quiz/approve) між демо є формою, а не дублюванням логіки. -->

```bash
cd delta
export DELTA_BIN=../target/debug/delta
export DELTA_CONFIG_PATH=/tmp/delta-demo-m5/config.json
mkdir -p /tmp/delta-demo-m5/.mt /tmp/delta-demo-m5/runs/demo-1/decisions

cat > /tmp/delta-demo-m5/.mt/mandates.yaml <<'EOF'
generation: 1
mandates:
  - owner: fable-5
    kind: model
    scope: { refs: ["refs/mt/tasks/routine/**"], decision_types: [ops] }
    thresholds: { budget_eur: 200, risk: low, irreversible: false, audacity: medium }
    escalates_to: olena
  - owner: olena
    scope: { refs: ["refs/mt/tasks/design/**"], decision_types: [architecture] }
    thresholds: { budget_eur: 2000, risk: medium, irreversible: false }
    escalates_to: vitalii
  - owner: vitalii
    scope: { refs: ["refs/mt/**"], decision_types: ["*"] }
    thresholds: {}
    escalates_to: null
EOF

# 0003 — одноосібна, але ШИРОКИЙ blast_radius → depth: teach-back (без кворуму, irreversible: false)
cat > /tmp/delta-demo-m5/runs/demo-1/decisions/0003-decision-request.md <<'EOF'
---
type: decision-request
computed_owner: olena
leverage_facets: { irreversible: false, blast_radius: company }
decision_type: architecture
---
## Контекст
Перехід команди на чотириденний робочий тиждень.
## Варіанти
### A. Перейти
Вища залученість, ризик — SLA з клієнтами на перехідний період.
### B. Лишити пʼятиденку
## Рекомендація агента
A.
EOF

# 0004 — рутинна ops-розвилка olena систематично відкладає (для дрейфу/делегування)
cat > /tmp/delta-demo-m5/runs/demo-1/decisions/0004-decision-request.md <<'EOF'
---
type: decision-request
computed_owner: olena
decision_type: ops
leverage_facets: { irreversible: false, blast_radius: node }
opened_at: "2026-07-01T09:00:00.000Z"
---
## Контекст
Рутинний CI job валиться третій тиждень поспіль.
## Варіанти
### A. Перезапустити з тим самим конфігом
### B. Ескалювати до людини
## Рекомендація агента
A — рутинна дія в межах мандата fable-5.
EOF

$DELTA_BIN set_identity '{"handle":"olena"}'
$DELTA_BIN set_mandates_dir '{"dir":"/tmp/delta-demo-m5"}'

# 1. Штаб — бриф (LLM недоступний → чесний структурний фолбек; живий ендпоінт дає compressed:true)
$DELTA_BIN decision_brief '{"runId":"demo-1","nnnn":"0003"}'

# 2. teach-back — prompt (0003: blast_radius company, irreversible: false — одноосібний шлях, НЕ кворум)
$DELTA_BIN decision_quiz '{"runId":"demo-1","nnnn":"0003","chosenOption":"A"}'
# => {"depth":"teach-back","prompt":"Перекажи своїми словами...", "iterations":0}

# 3. Переказ — з живим локальним LLM повертає understood:true/false; без нього — чесна відмова available:false
$DELTA_BIN decision_approve '{"runId":"demo-1","nnnn":"0003","chosenOption":"A","transcript":"Обираю варіант A — перехід на чотириденний тиждень. Головний наслідок: вища залученість команди. Головний ризик: SLA з клієнтами може постраждати на перехідний період."}'

# 4. Кандор — fable-5 каже незручну правду olena (окремий інбокс, medium у межах бюджету)
$DELTA_BIN ai_candor '{"toHandle":"olena","fromModelHandle":"fable-5","statement":"Ти три тижні відкладаєш ops-розвилку 0004...","audacityLevel":"medium"}'
$DELTA_BIN ai_candor '{"toHandle":"olena","fromModelHandle":"fable-5","statement":"x","audacityLevel":"high"}'
# => {"ok":false,"error":{"message":"...перевищує бюджет зухвалості мандата 'fable-5' ('medium')..."}}
$DELTA_BIN candor_show '{}'
# => [{"from_model":"fable-5","audacity_level":"medium","read":false,...}] — ВІДДІЛЕНО від decisions_show

# 5. Дрейф — 0004 (ops, opened_at 2026-07-01) застаріле для olena, картка ЛИШЕ локально (drift.json)
$DELTA_BIN drift_scan '{}'
# => [{"decisionType":"ops","count":1,"items":[{"nnnn":"0004","signal":"stale",...}],...}]

# 6. Делегування одним квізом — модель fable-5 (scope: ops, escalates_to: olena)
$DELTA_BIN delegation_quiz '{"runId":"demo-1","nnnn":"0004","modelHandle":"fable-5"}'
$DELTA_BIN decision_delegate '{"runId":"demo-1","nnnn":"0004","modelHandle":"fable-5","delegatedByHandle":"olena","answer":<індекс правильної відповіді з кроку 6>}'
# => {"delegated":true,"delegation":{"delegated_to":"fable-5","delegated_by":"olena",...}}

# 7. Деривація черги — 0004 зникло в olena, зʼявилось у fable-5 (computed_owner у файлі НЕ змінився)
$DELTA_BIN decisions_show '{}'                          # лише 0003 (teach-back)
$DELTA_BIN decisions_show '{"handle":"fable-5"}'         # 0004, delegatedTo: fable-5
```
<!-- jscpd:ignore-end -->

## M6 — Пілот-механіка: дельта-звіт, kill-switch, тижневе рев'ю

Демо-критерій: перше дельта-рев'ю організації на реальних даних — звіт згенеровано, ≥1 мандат
розширено/звужено підписом (докладніше — `docs/specs/260809-delta-app.md`, «Обсяг M6»).

- **UI-догон M5** — вкладка «Незручна правда» (`CandorView.vue`/`use-candor.js`: список `candor_show`, бейдж
  непрочитаних, mark-read), секція «Дрейф» на вкладці «Стежу» (`WatcherView.vue`/`use-drift.js`: картки
  `drift_show`/`drift_scan`, кнопка «делегувати ШІ» → inline one-tap квіз `delegation_quiz`/`decision_delegate`,
  той самий M5-flow) — чиста Vue-обв'язка над наявними tools, без нової логіки в JS.
- **Org-конфіг** (`delta-core::org`) — новий файл `<mandatesDir>/.mt/org.json` (**комітиться в git**, не PII —
  той самий рівень публічності, що `device-registry.json`): `{ "hourly_rate_eur": 60 }` (дефолт 60 €/год,
  редагується вручну — жодного tool для запису поки що).
- **Дельта-звіт** (`delta-core::report`, tool `delta_report {mandatesDir, periodDays}`) — детермінований
  markdown, БЕЗ LLM: (а) **рух межі** — застосовані mandate-change за період, зі знайденого маркера
  `runs/mandate-change-{id}/decisions/0001-applied.json` (пише `change_proposal::apply_mandate_change_proposal`
  ПІСЛЯ Valid-вердикту, окремо від самої мутації `.mt/mandates.yaml`); (б) **рішення за період** — закриті
  decision-request-и, класифіковані людський/модельний/кворумний за ефективним власником (`delegated_to`, якщо
  є, інакше `computed_owner`, звірений проти `kind` мандата); (в) **ціна гейта** — Σ `time_to_understanding_sec`
  людських/кворумних підписів × `hourly_rate_eur` + кількість (не сума грошей) відкритих розвилок з непорожнім
  `deadline_cost`; (г) **глибина делегування** — кількість `decision_types` із model-власником у мандатах +
  кількість делегувань, підписаних за період; (д) **агреговано без приватного** — кількість доставлених
  кандор-заяв і активацій kill-switch (лише count, БЕЗ вмісту дрейф-карток/бази знань). Пише
  `.mt/reports/YYYY-MM-DD-delta.md`; UI-вкладка «Звіт» (`ReportView.vue`/`use-report.js`).
- **Kill-switch** (`delta-core::kill_switch`, tools `kill_switch_on`/`kill_switch_off`/`kill_switch_status`) —
  **SUSPENSION-шар, НЕ мутація мандата**: `.mt/mandates.yaml` НІКОЛИ не торкається (реверсивність). Активний
  kill-switch змінює ЛИШЕ деривацію: `decisions::derive_queue` (третій аргумент — карта перенаправлення з
  `kill_switch::build_kill_switch_redirect`) перенаправляє розвилки, делеговані МОЇМ ШІ-мандатам
  (`escalates_to === я`), і нові розвилки їхніх scope-ів — у МОЮ чергу; `watcher::run_watcher_scan`
  (`kill_switch_suppressed`) перестає пінгувати/ескалювати по них. UI-кнопка в шапці (`App.vue`) — **БЕЗ квізу,
  БЕЗ підтвердження**, миттєва. Активний маркер — підписаний `.mt/kill-switch/{handle}.json`; `off` спорожнює
  його НОВИМ підписом. Обидві дії дописуються у спільний append-only лог `.mt/kill-switch/log.jsonl`, який
  рахує `report.rs` (лише кількість активацій, не «хто»).
- **Тижневе дельта-рев'ю** (`delta-core::review`, tool `review_agenda {mandatesDir, periodDays}`) —
  детермінований порядок денний, БЕЗ LLM: (а) **draft-пропозиції розширення** — модель мала 5+ рішень БЕЗ
  override за період і її делегатор НЕ має активного kill-switch → рев'ю САМЕ матеріалізує change-proposal
  ОДНИМ викликом `ai_petition` (той самий headless-actor патерн, що ШІ-петиція M3) — підписує ЛЮДИНА звичайним
  `decision_quiz`/`decision_approve` + `mandate_change_apply` (M3), рев'ю нічого не підписує само; (б)
  **кандидати на звуження** — override-и за період або активний kill-switch делегатора (інформаційний список);
  (в) **відкриті розбіжності кворумів** (`status: diverged`) і **застарілі розвилки** — по УСІХ
  decision-request-ах воркспейсу (на відміну від приватного дзеркала `drift.rs`, рев'ю — організаційна
  прозорість). Пише `.mt/reviews/YYYY-MM-DD-agenda.md`.

### Ритуал дельта-рев'ю

30 хвилин, раз на тиждень, єдина синхронна церемонія організації (конституція п.4). Порядок: (1)
`delta_report` — що сталось за тиждень (рух межі, ціна гейта, глибина делегування); (2) `review_agenda`
— порядок денний із уже готовими чернетками розширень (draft-пропозиції матеріалізуються автоматично,
не вигадуються на льоту); (3) організація вголос дивиться кандидатів на звуження й відкриті розбіжності;
(4) КОЖНЕ розширення з (2) підписує його делегатор — звичайний `decision_quiz`/`decision_approve` +
`mandate_change_apply`, той самий M3-конвеєр, немає обхідного шляху; (5) повторний `delta_report`
наступного тижня показує рух межі як факт, не як намір.

### Demo-послідовність (реально прогнана: тиждень активності → звіт → рев'ю → підпис розширення → рух межі → kill-switch)

Модель у цьому застосунку досі не має живого tool-шляху підписати ЗВИЧАЙНЕ рішення власним ключем (задокументований
борг, розділ «Статус» нижче) — 5 model-signed ops-рішень тижня матеріалізовані як реальні Ed25519-підписані
фікстури (справжній `delta-core::approval::build_and_sign_approval` + свіжозгенерований ключ, лише не через
CLI-команду), той самий підхід, що використовував автор оригінального M6-демо. Решта кроків — звичайні
CLI-виклики `delta`.

<!-- jscpd:ignore-start -->
<!-- Кожна demo-послідовність у цьому README навмисно самодостатня (copy-paste-run без
     переходів між секціями) — спільний CLI-boilerplate (mandates.yaml, decision-request
     heredoc, quorum_quiz/approve) між демо є формою, а не дублюванням логіки. -->

```bash
cd delta
cargo build -p delta-cli
export DELTA_BIN=../target/debug/delta

mkdir -p /tmp/delta-demo-m6/.mt
cat > /tmp/delta-demo-m6/.mt/mandates.yaml <<'EOF'
generation: 1
mandates:
  - owner: fable-5
    kind: model
    scope: { refs: ["refs/mt/tasks/routine/**"], decision_types: [ops] }
    thresholds: { budget_eur: 200, risk: low, irreversible: false, audacity: medium }
    escalates_to: olena
  - owner: olena
    scope: { refs: ["refs/mt/tasks/design/**"], decision_types: [architecture, ux] }
    thresholds: { budget_eur: 2000, risk: medium, irreversible: false }
    escalates_to: vitalii
  - owner: vitalii
    scope: { refs: ["refs/mt/**"], decision_types: ["*"] }
    thresholds: {}
    escalates_to: null
EOF
echo '{"hourly_rate_eur": 75}' > /tmp/delta-demo-m6/.mt/org.json

export OLENA_CFG=/tmp/delta-demo-m6-olena/config.json
export VITALII_CFG=/tmp/delta-demo-m6-vitalii/config.json
DELTA_CONFIG_PATH=$OLENA_CFG   $DELTA_BIN set_identity '{"handle":"olena"}'
DELTA_CONFIG_PATH=$OLENA_CFG   $DELTA_BIN set_mandates_dir '{"dir":"/tmp/delta-demo-m6"}'
DELTA_CONFIG_PATH=$VITALII_CFG $DELTA_BIN set_identity '{"handle":"vitalii"}'
DELTA_CONFIG_PATH=$VITALII_CFG $DELTA_BIN set_mandates_dir '{"dir":"/tmp/delta-demo-m6"}'

# ... 5 model-signed ops-рішень тижня (runs/week1/decisions/0001..0005) + device-registry.json
#     з fable-5 pubkey (матеріалізовано напряму через delta-core::approval — див. вище).

# Людське architecture-рішення з реальним квіз-часом
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN decision_quiz '{"runId":"week1","nnnn":"0006","chosenOption":"A"}'
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN decision_approve '{"runId":"week1","nnnn":"0006","chosenOption":"A","answer":<індекс з кроку вище>}'

# Застаріла ВІДКРИТА розвилка з deadline_cost (0007) — лишається непідписаною.

# Diverged-кворум (0008, irreversible) — olena і vitalii підписують teach-back РІЗНИМИ варіантами
DELTA_CONFIG_PATH=$OLENA_CFG   $DELTA_BIN quorum_quiz '{"runId":"week1","nnnn":"0008","signerHandle":"olena"}'
DELTA_CONFIG_PATH=$OLENA_CFG   $DELTA_BIN quorum_approve '{"runId":"week1","nnnn":"0008","signerHandle":"olena","chosenOption":"A","transcript":"..."}'
DELTA_CONFIG_PATH=$VITALII_CFG $DELTA_BIN quorum_quiz '{"runId":"week1","nnnn":"0008","signerHandle":"vitalii"}'
DELTA_CONFIG_PATH=$VITALII_CFG $DELTA_BIN quorum_approve '{"runId":"week1","nnnn":"0008","signerHandle":"vitalii","chosenOption":"B","transcript":"..."}'

# Кандор — fable-5 каже незручну правду olena
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN ai_candor '{"toHandle":"olena","fromModelHandle":"fable-5","statement":"...","audacityLevel":"medium"}'

# 1. Звіт ДО рев'ю — 6 закритих рішень (5 модельних ops, 1 людське), рух межі порожній
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN delta_report '{"periodDays":14}'

# 2. Рев'ю — fable-5 набрав поріг (5/5 без override), делегатор olena БЕЗ kill-switch →
#    change-proposal МАТЕРІАЛІЗУЄТЬСЯ автоматично (runId mandate-change-review-1-fable-5);
#    diverged 0008 і stale 0007 видно в тому самому виклику
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN review_agenda '{"periodDays":14}'

# 3-4. olena проходить ЗВИЧАЙНИЙ квіз-гейт (depth: standard, 2 питання) на chosenOption A
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN decision_quiz '{"runId":"mandate-change-review-1-fable-5","nnnn":"0001","chosenOption":"A"}'
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN decision_approve '{"runId":"mandate-change-review-1-fable-5","nnnn":"0001","chosenOption":"A","answer":<індекс Q1>}'
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN decision_approve '{"runId":"mandate-change-review-1-fable-5","nnnn":"0001","chosenOption":"A","answer":<індекс Q2>}'

# 5. Застосування — .mt/mandates.yaml: generation 1 → 2, fable-5.audacity: medium → high
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN mandate_change_apply '{"changeId":"review-1-fable-5","handle":"olena","role":"human"}'

# 6. Звіт ПІСЛЯ — «Рух межі» тепер несе fable-5: widened, thresholds.audacity: medium → high
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN delta_report '{"periodDays":14}'

# 7. Kill-switch — olena забирає все собі: черга fable-5 порожніє, нова ops-розвилка
#    fable-5 деривується в чергу olena, watcher НЕ ескалює по ній
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN kill_switch_on '{"handle":"olena"}'
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN decisions_show '{"handle":"fable-5"}'   # => []
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN decisions_show '{"handle":"olena"}'      # нова розвилка тут, killSwitchRedirected: true
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN watcher_scan '{}'                        # без ескалації по ній
DELTA_CONFIG_PATH=$OLENA_CFG $DELTA_BIN kill_switch_off '{"handle":"olena"}'     # реверсивність — черга fable-5 відновлюється
```
<!-- jscpd:ignore-end -->

**Реальний прогін цієї послідовності** (цим агентом, проти живого локального LLM) підтвердив точно цей вивід:

- `delta_report` ДО рев'ю: `decisions.total: 6` (`human: 1, model: 5, quorum: 0` — diverged-кворум `0008`
  свідомо НЕ рахується, «закритий» ≠ «розібраний»), `blockedWithDeadlineCost: 1` (0007), `candorDelivered: 1`,
  `boundaryMoves: []`, `gateCostEur: 0.54` (реальний `time_to_understanding_sec` з живого LLM-квізу × 75 €/год).
- `review_agenda`: `widenCandidates: [{"modelHandle":"fable-5","delegatorHandle":"olena","decisionsInPeriod":5,
  "overrideFreeInPeriod":5}]`, `materialized: [{"changeId":"review-1-fable-5",...}]` — change-proposal
  матеріалізовано АВТОМАТИЧНО, без ручного `ai_petition`; `disputes.diverged` несе `week1/0008 (olena→A,
  vitalii→B)`, `disputes.stale` несе `week1/0007 (10 дн.)`.
  Markdown-рядок: «**fable-5** → делегатор `olena`: 5/5 без override за період — чернетка готова:
  `review-1-fable-5`».
- Звичайний `decision_quiz`/`decision_approve` (depth: standard, 2 питання, fallback-генератор) підписав
  change-proposal; `mandate_change_apply` застосував — `generation: 1 → 2`,
  `fable-5.thresholds.audacity: medium → high`.
- `delta_report` ПІСЛЯ: `decisions.total: 7` (+1 `mandate-change`), `boundaryMoves` тепер несе рядок
  «**fable-5** — розширено (підписав делегатор `olena`, ...)» з diff-рядком
  `thresholds.audacity: medium → high` — точно той критерій демо M6, що вимагала задача.
- Kill-switch: до активації `decisions_show('{"handle":"fable-5"}')` показував нову ops-розвилку `week2/0001`;
  одразу після `kill_switch_on` вона зникла з черги fable-5 (`[]`) і зʼявилась у черзі olena з
  `killSwitchRedirected: true`; `watcher_scan` тим часом не згенерував ЖОДНОЇ нотифікації по ній (лише по
  непов'язаній застарілій `week1/0007`); `kill_switch_off` відновив чергу fable-5 (`week2/0001` знову там);
  фінальний `delta_report` показав `killSwitchActivations: 1`.

## Конституція: реалізовані пункти

Мілстоуни `M0`–`M6` покривали каркас застосунку; окремий реєстр
[`docs/open-questions.md`](../docs/open-questions.md) (розділ 3) тримав пункти конституції спеки
(`docs/specs/260809-delta-app.md`), які лишались без коду поза мілстоунами. Стан після цього проходу:

- **п.11 «Референс = виконуваний підручник».** Кожен екран (Карта/Вирішую/Довіряю/Знання/Незручна
  правда/Звіт), картка рішення, квіз-гейт, кворум і kill-switch мають розгортний блок «чому так»
  (`WhyThisWorks.vue`, іконка ⓘ) — 2-4 речення суті механіки українською + точне посилання на нормативне
  джерело (vision.md «Дельта», mandates.md, ADR 20260809, спека). Тексти — статичний контент
  `delta/src/content/why.js` (11 записів — 10 обов'язкових + бонусна вкладка «Стежу»), звірений з
  документами, не логіка.
- **п.3 «Спрощення квізів з довірою».** `delta-core::knowledge::trust_simplified_for_domain` — 5 поспіль
  чистих квізів (`iterations: 1`) того самого домену/тієї самої `mandate_generation`, останній ≤14 днів
  тому → наступний `standard`-квіз стискається до одного питання, позначка `trust_simplified: true` видима
  в самому квіз-файлі. Перерва >14 днів, будь-який фейл у стріку чи зміна генерації мандатів повертають
  повну глибину миттєво; teach-back/irreversible НІКОЛИ не спрощується (гілка коду фізично не виконується
  для цієї глибини). Ін'єктований годинник, тести на всі переходи (`knowledge.rs`, `decision_flow.rs`).
- **п.10 «Онбординг = перший мандат».** `delta-core::onboarding` — handle відсутній у `mandates.yaml` →
  шаблон мінімального мандата (`minimal_mandate_template`, консервативні пороги) → change-proposal ТИМ
  САМИМ `ChangeKind::Added`-шляхом `mt_mandates::validate_mandate_change`, що розширення ШІ-мандата →
  делегатор підписує ЗВИЧАЙНИМ M1/M2 квіз-конвеєром (жодного нового шляху підпису) → новоприбулий проходить
  ВЛАСНИЙ детермінований entry-quiz (три питання про пороги/`escalates_to`/`decision_types` щойно
  отриманого мандата, без LLM) у `runs/onboarding-{handle}/` — лише після цього онбординг завершено. Tools:
  `mandate_request_propose`/`onboarding_status`/`entry_quiz_start`/`entry_quiz_submit`. UI:
  `OnboardingDialog.vue` — п'ятикроковий майстер (identity → request-mandate → awaiting-delegator →
  entry-quiz → done). Наскрізний тест (`full_onboarding_flow_delegator_signs_then_entrant_passes_entry_quiz`)
  проганяє всі чотири кроки одним прогоном.
- **п.12 (частина) «Симуляція перед підписом».** `delta-core::simulation::simulate_scope` — детермінований,
  без LLM: скан `runs/*/decisions` за період (типово 90 днів) → «N рішень потрапило б у scope (розбивка за
  `decision_type`), з них M — irreversible»; `exclude` віднімає розвилки, що вже покривались попереднім
  scope (рахує лише новозахоплене). Tool `simulate_mandate_scope`; UI — картка запиту мандата в
  `OnboardingDialog.vue` (прогноз на введений `decisionTypes` до відправки) і кнопка «прогноз» на кожній
  ШІ-мандат-картці в «Довіряю» (`TrustView.vue`). **Свідома межа обсягу:** матчить лише вісь
  `decision_types` — файловий мок `decision-request.md` не несе поля, еквівалентного `scope.refs` (немає
  «звідки в дереві задач» ця розвилка), тому `refs`-вимір симуляції не реалізований (задокументовано в
  module doc `simulation.rs` і `docs/open-questions.md`).
- **п.2(г) «growth_edge».** Мок профілю `.mt/profiles/{handle}.yaml`, ЛИШЕ секція `growth_edge` (mandates.md:
  «ЄДИНА секція, яку пише сама людина») — `delta-core::profiles`, tools `profile_show`/
  `profile_set_growth_edge`, редактор у «Стежу» (профспілковий екран, поруч із «Що про мене знає
  система»). `decision_quiz` (CLI/Tauri-обгортка, не сам `decision_flow`) читає `growth_edge` власника
  розвилки — домен у зоні росту → ОКРЕМЕ, негейтуюче поле відповіді `growthEdge` (детерміноване питання
  «на виріст» ширшого контексту), яке ніколи не входить у квіз-файл/`questions[]` — фізично не може
  підняти вимоги до підпису. Показ — інформаційна картка в `DecisionCard.vue`, без власної кнопки
  підтвердження.

**Свідомо зрізано (NICE, чесно, не мовчки):**

- **п.5 «Ефемерні мандати пунктиром».** НЕ реалізовано — `ephemeral_mandate` (mandates.md) потребує
  run-графа з `expires_with`, якого файловий мок цього репо не тримає (немає представлення «батьківський
  вузол закрився» на диску). Карта мандатів лишається без пунктирних вузлів.
- **п.12 (решта) «Прецеденти».** НЕ реалізовано — «схожі вирішені рішення» (той самий `decision_type` +
  перетин scope, до 3, з `chosen_option`) на картці нової розвилки; те саме сканування `runs/*/decisions`,
  що `simulation.rs`, могло б це живити, але явного tool-а/UI немає. Позначка `precedent: true` в approval
  теж не реалізована.
- **п.8 «Крос-мовність»** — свідомо поза обсягом із самого спекового документа (залежить від i18n-шару mt,
  якого немає).

## Розробка

```bash
bun install
bun run --cwd=delta dev              # vite dev-сервер (без Tauri-вікна)
bun run tauri dev --config src-tauri/tauri.conf.dev.json   # у delta/: повне Tauri-вікно
bun run --cwd=delta test             # vitest (лишився лише онбординг — уся інша логіка в Rust)
cd delta && npm run test:rust        # cargo test по delta-core/delta-cli/delta (280+ тестів)
```

## Дистрибуція

Реліз-конвеєр — той самий патерн, що `app`/`owner` (канон `.cursor/rules/n-tauri.mdc`, розділ «Реліз-flow»):
change-файли → `changelog-release.yml` → тег `delta@X.Y.Z` → `release-delta.yml` → підписаний DMG +
updater-артефакти на GitHub Releases.

### Потік релізу

1. Кожна PR-задача, що чіпає код `delta/`, несе власний change-файл (`delta/.changes/<ts>.md`,
   `npx @7n/n ch --path delta --bump <major|minor|patch> --section <Added|Changed|Fixed|Removed>`).
2. Мердж у `main` з непорожнім `delta/.changes/` тригерить `.github/workflows/changelog-release.yml` —
   `npx @7n/rules release` бампає `delta/package.json` і `delta/CHANGELOG.md`, комітить
   `release: …, delta@X.Y.Z`, тегує `delta@X.Y.Z` і диспатчить `release-delta.yml --ref delta@X.Y.Z`.
3. `release-delta.yml` (macOS-раннер): синхронізує версію з тегу в `delta/src-tauri/tauri.conf.json`,
   збирає `universal-apple-darwin` через `tauri-apps/tauri-action`, підписує Apple-сертифікатом і
   updater-ключем (обидва — з Infisical через OIDC, той самий проєкт/identity, що `app`/`owner`), публікує
   GitHub Release `delta delta@X.Y.Z` з DMG + `latest.json` + `.sig`, і пересуває службовий тег
   `delta-latest` на свіжий `latest.json`.

### Автооновлення (`useUpdater()`)

`src/App.vue` викликає спільний хук `useUpdater()` з `@7n/tauri-components/vue` (без аргументів, без
локальної логіки — той самий код, що `owner`) — перевірка через 3с після старту, далі щогодини; знаходить
оновлення → діалог → завантаження з прогресом → пропозиція `relaunch()`. No-op у dev-збірці
(`import.meta.env.DEV`), тому `tauri.conf.dev.json` окремого вимкнення не потребує.

`src-tauri/tauri.conf.json`:

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "…",
      "endpoints": [
        "https://github.com/nitra/task/releases/download/delta-latest/latest.json",
        "https://github.com/nitra/task/releases/latest/download/latest.json"
      ]
    }
  }
}
```

`src-tauri/src/lib.rs` реєструє `tauri_plugin_updater` (лише `#[cfg(desktop)]`) і `tauri_plugin_process`
(без cfg-guard, потрібен для `relaunch()` на будь-якій платформі) — дзеркалить `owner/src-tauri/src/lib.rs`.
Capability — `capabilities/updater.json` (`updater:default`, `platforms: [macOS, windows, linux]`) +
`capabilities/default.json` (`process:allow-restart`).

**Ключ підпису updater-артефактів — СПІЛЬНИЙ з `app`/`owner`.** `plugins.updater.pubkey` у
`delta/src-tauri/tauri.conf.json` — той самий публічний ключ (не секрет, живе в git), що в
`app/src-tauri/tauri.conf.json` і `owner/src-tauri/tauri.conf.json`; приватна половина — той самий
Infisical-секрет `TAURI_SIGNING_PRIVATE_KEY` (`secret-path: /updater`, проєкт `vitaliytv-kfse`,
`identity-id: 53691c96-17d9-4389-b078-0f77073809ab`), який `release.yml`/`release-owner.yml` вже тягнуть
для своїх продуктів. Рішення свідоме, не за замовчуванням канону (`n-tauri.mdc` описує один ключ на
застосунок): усі три Tauri-продукти цього репозиторію вже фактично діляли один keypair до появи delta —
переприв'язка на новий ключ для delta зламала б цей наявний факт без користі (три ключі в Infisical замість
одного не додають ізоляції, поки всі три продукти випускає та сама команда з того самого репо) і вимагала б
ручного кроку від людини (додати секрет), якого конвеєр `app`/`owner` не потребує. Якщо delta колись
відокремиться в інший репозиторій чи іншу команду випуску — тоді й ротація на власний ключ (`bunx tauri
signer generate`), не раніше.

### Іконки

`src-tauri/icons/icon.svg` — власний дизайн (не плейсхолдер `owner`): грецька літера Δ білим на teal-
градієнті (`#14b8a6` → `#0d9488`, той самий акцент, що бренд-крапка в шапці), закруглений квадрат
macOS-стилю (`rx: 224` на canvas 1024). Повний набір (`icns`/`ico`/PNG-розміри, Windows Square-логотипи)
згенеровано з нього:

```bash
rsvg-convert -w 1024 -h 1024 -o /tmp/delta-icon-1024.png delta/src-tauri/icons/icon.svg
cd delta && bunx tauri icon /tmp/delta-icon-1024.png --output src-tauri/icons
```

(команда також генерує `icons/android/` і `icons/ios/` — видалені: delta ще не має ініціалізованих
мобільних Tauri-таргетів, той самий набір файлів, що `owner`.)

### Що потрібно від людини перед першим релізом

**Нічого нового.** Delta перевикористовує наявні Infisical-секрети (`/apple`, `/updater`) і OIDC-identity,
якими вже користуються `release.yml`/`release-owner.yml` — жодного нового секрету GitHub/Infisical додавати
не треба. Перший `delta@X.Y.Z`-реліз піде автоматично з наявних `delta/.changes/*.md` при наступному мерджі
в `main`.

## CLI

```bash
cd delta
cargo build -p delta-cli
export DELTA_BIN=../target/debug/delta

$DELTA_BIN list                                                   # каталог усіх 40 tools (фаза A + фаза B)
$DELTA_BIN whoami
$DELTA_BIN set_identity '{"handle":"olena"}'
$DELTA_BIN set_mandates_dir '{"dir":"/абсолютний/шлях/до/воркспейсу"}'
$DELTA_BIN mandates_show '{"mandatesDir":"/абсолютний/шлях","handle":"olena"}'
```

`mandates_show` (і решта tools, що приймають `mandatesDir`/`handle`) без явних значень бере їх з локального
конфігу (той самий, що читає GUI) — зручно для інтерактивного використання після `set_identity`/
`set_mandates_dir`.

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

## Формат `.mt/org.json` (M6)

Org-level конфіг для метрики «ціна гейта» — **комітиться в git** (не PII, той самий рівень публічності,
що `device-registry.json`). Єдине поле — `hourly_rate_eur` (ставка вартості людської години, EUR);
відсутній файл — дефолт **60**. Редагується вручну, без окремого tool:

```json
{
  "hourly_rate_eur": 60
}
```

## Rust-порт гейт-ядра та tool-поверхні (завершено)

Рішення користувача: CLI Delta App — Rust-бінарник, не JS; щоб зберегти інваріант «GUI і CLI — одна
логіка» (n-tool-surface), уся логіка застосунку (не лише «гейт-ядро» фази A, а й уся фаза B —
knowledge/drift/candor/delegation/watcher/staff/report/review/kill-switch/directory/org) переїхала у
спільний Rust-crate `delta-core`, який лінкують і Tauri-бекенд, і CLI. JS-мок мандатної семантики
поступився місцем справжньому crate `mt-mandates` (nitra/mt-rust) — контракт-перший порядок (рішення Ж
специфікації) дав плід. Увесь `delta/src/*.js` JS-шар бізнес-логіки видалено; лишились Vue-компоненти,
тонкі композабли (лише `invoke`), `tool/index.js` як чистий invoke-диспетчер, і `onboarding.js` (браузерний
localStorage UI-стан, поза n-tool-surface — не backend tool).

### Архітектура

- **`delta/crates/delta-core`** (lib) — уся логіка, 26 модулів: `mandates`/`decisions`/`signing`/`approval`/
  `knowledge`/`quiz`/`decision_flow`/`quorum`/`device_registry`/`track_record`/`trust`/`mandate_change`/
  `change_proposal`/`ai_petition` (фаза A) + `org`/`directory`/`kill_switch`/`watcher`/`drift`/`delegation`/
  `candor`/`staff`/`what_system_knows`/`report`/`review` (фаза B). Лінкує `mt-mandates` git-залежністю
  (`ssh://git@github.com/nitra/mt-rust.git`, той самий патерн, що `owner/src-tauri` → `mt-core`). **280+
  Rust-тестів, усі зелені**; `cargo fmt`/`cargo clippy --all-targets -- -D warnings` чисті по всіх трьох крейтах.
- **`delta/crates/delta-cli`** (bin `delta`, `clap`) — Rust CLI для ВСІХ 40 tools (19 фаза A + 21 фаза B):
  `delta <tool> '<json>'`, той самий envelope (`{ok, output|error}`), той самий config.json/
  DELTA_CONFIG_PATH/шляхи ключів, що мав `bin/delta.mjs` — тепер видалений, `delta-cli` єдина точка входу CLI.
- **`delta/src-tauri/src/phase_a.rs`** (12 команд) + **`phase_b.rs`** (21 команда) — Tauri-команди, що лінкують
  `delta-core` напряму (той самий crate, що CLI). `tool/index.js` спрощено до чистого
  `createDispatch(TOOLS, tauriTransport)` — ВСІ 40 tools падають на generic `tauriTransport`, що викликає
  відповідну Rust-команду напряму, без орудування JS-модулями.
- **camelCase-межа** для GUI/CLI проведена НА виході Rust (командний шар) — `Serialize`-структури з
  `#[serde(rename = "...")]` (`report::DeltaReportOutput`, `review::ReviewAgendaOutput`,
  `staff::StaffBrief`, `decisions::SignedApproval` тощо) чи явні `*_to_json`-конвертери
  (`mandates::mandate_to_camel_json`, `decisions::queue_item_to_json`) — Vue-компоненти й далі читають той
  самий camelCase контракт, що JS-шар віддавав.

### Ключові інваріанти, перенесені 1:1

- Квіз ніколи не пропускається; LLM недоступний → детермінований фолбек (one-tap/standard); teach-back
  — ЧЕСНА відмова без фолбека (оцінка вільного тексту принципово потребує LLM).
- «Фейл ≠ покарання» — навчальний режим (`explain`, кумулятивно 3 шари), мікроурок після БУДЬ-якої
  відповіді, spaced-repetition скидає інтервал до 1 дня на неправильній відповіді, не виключає з бази.
- Підпис `ApprovalResponse` неможливий без завершеного квізу (`iterations`/`time_to_understanding_sec`).
- «Остання константа» — розширення `kind: model` мандата підписує ЛИШЕ людський ключ, безумовно, через
  СПРАВЖНІЙ `mt_mandates::validate_mandate_change` (не мок), включно з подвійним підписом на зміну
  `escalates_to`.
- Мультипартійний підпис (кворум): кожен `approvers`-handle — власний квіз-файл і власний підписаний
  approval; `pending`/`closed`/`diverged` — без авторезолюції розбіжності; з M5 форсує `teach-back`, не
  `standard`.
- Kill-switch — suspension-шар, `.mt/mandates.yaml` НІКОЛИ не мутує; лише деривація черги/watcher-а.
- Дрейф/кандор/база знань — ЛОКАЛЬНІ поза git (профспілковий принцип); звіт/рев'ю бачать лише count.

### Крос-мовна перевірка криптографії

Тест `signing::tests::cross_language_fixture_from_web_crypto_verifies_in_rust` підтверджує байт-у-байт
сумісність: JWK/підпис, згенеровані старим JS Web Crypto шаром (до видалення), верифікуються Rust-стороною, і
Rust, підписуючи той самий canonical payload тим самим ключем, відтворює ІДЕНТИЧНИЙ підпис (Ed25519
детермінований, RFC 8032) — існуючі `device_key.json`/approval-фікстури лишаються верифіковними без
перегенерації.

`mandate-change` (M3) — окрема крипто-схема: підписи мутації `.mt/mandates.yaml` йдуть через `mt_mandates::
change` (domain-separated хеш `mt-mandate-change-v1`) — **старі демо-підписи mandate-change, зроблені ДО
переходу на справжній crate, криптографічно невалідні проти нового домену; це очікувано, не регресія**
(задокументовано в module doc `mandate_change.rs`). `ApprovalResponse` decision-request-гейта не зачеплений
цією зміною.

### Знайдене й виправлене під час реального прогону M4/M6-демо

Локальний OpenAI-сумісний ендпоінт (`gemma-4-26b-a4b-it`) інколи обгортає JSON-відповідь у markdown code fence
(` ```json ... ``` `) попри пряму інструкцію системного промпту «СТРОГО JSON без пояснень поза ним». Усі чотири
LLM-парсинг-сайти (`quiz::call_llm_quiz_generator`/`call_llm_standard_quiz_generator`/
`call_llm_teach_back_evaluator`, `staff::call_llm_staff_brief`) тепер знімають fence перед `serde_json::
from_str` через спільний `quiz::strip_json_code_fence` — без цього виправлення M4-демо (кворум з двома
teach-back-переказами) падала на чесну відмову там, де LLM насправді відповів валідно. 3 нові тести
(`quiz::tests::strip_json_code_fence_*`).

## Статус: M0–M6 реалізовано, борги

Усі шість мілстоунів (`M0`–`M6`) реалізовано в Rust (`delta-core`/`delta-cli`/Tauri-командний шар), 328+
Rust-тестів + 1 vitest (онбординг — єдине, що лишилось у JS) зелені (328 включає модулі поза мілстоунами —
розділ [«Конституція: реалізовані пункти»](#конституція-реалізовані-пункти) нижче). Чесний список того, що
лишається боргом — без прикрашання:

- **Doc-files беклог** — `delta/src/main.js`/`onboarding.js` досі без файлової доки `src/docs/<stem>.md`
  (доку веде окремий таймбоксований прогін `/n-doc-files`, не кожна задача); аналогічний беклог існує й на
  Rust-стороні (жоден `delta-core`/`delta-cli` модуль не має окремого doc-файлу — інша тулінг-конвенція).
- **Голосовий ввід teach-back** — не реалізовано; macOS-диктовка друкує в ту саму textarea сама,
  окремого механізму намірено не додавали (задокументовано в M5).
- **Relay для живих нотифікацій** — досі файловий полінг (`delta watcher_scan`, той самий tool що й GUI —
  окремий `bin/delta-watcher.mjs` видалено, headless-вхід тепер просто повторний виклик tool-у), не push.
  Деградація «полінг замість пушу» задокументована з M4.
- **Майстер делегування — досі MVP-скоуп однієї осі (конституція п.12).** «Довіряю» лишається однією
  віссю audacity ±1 щабель (`budget_eur`-фолбек), не повним багатовісним редактором мандата (scope.refs/
  decision_types редагування). Симуляція на історії (частина п.12) — РЕАЛІЗОВАНА
  (`delta-core::simulation`, розділ [«Конституція: реалізовані пункти»](#конституція-реалізовані-пункти)),
  але матчить лише вісь `decision_types` — `refs`-вимір лишається боргом (файловий мок decision-request
  не несе поля, еквівалентного `scope.refs`).
- **Немає живого tool-шляху, яким модель сама підписує decision-request** — `track_record.rs`/
  `review.rs: draft_widen_candidates` рахують «модельні» рішення за атрибуцією pubkey в
  `device-registry.json`, але жоден CLI/GUI tool не дає моделі підписати ЗВИЧАЙНЕ рішення власним ключем
  (лише петиція/кандор/звуження мандата підписуються модельним ключем напряму) — у M6-демо вище (як і в
  оригінальному JS-демо до нього) модельні рішення матеріалізовані напряму через `delta_core::approval`
  (реальний ключ, реальний підпис), не через живий CLI-виклик. Кандидат для наступного мілстоуна:
  `decision_delegate` дає моделі чергу, але не дає їй інструмента `decision_approve` власним ключем.
- **Kill-switch off — «видалення» через порожній запис, не Rust-команда delete** — задокументоване
  рішення M6 (module doc `kill_switch.rs`): `write_file("")` замість окремого «видалити файл».
- **`review_agenda` ідемпотентний лише в межах одного `generation`** — повторний прогін у той самий
  тиждень освіжає ту саму чернетку (`changeId: review-{generation}-{model}`), але не запобігає
  «спаму» чернеток, якщо генерація файлу зміниться між прогонами того самого тижня (рідкісний
  edge-case, не покритий тестом).
- **napi-стикування з `mt-mandates` — уже неактуальне як окремий борг**: `delta-core` лінкує crate напряму
  як Rust git-залежність (не через napi/Node) — сам борг був сформульований для JS-світу, який тепер видалено.
