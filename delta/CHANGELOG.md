# Changelog

## [0.2.0] - 2026-08-13

### Added

- M0 delta-застосунку (спека docs/specs/260809-delta-app.md): новий Tauri-воркспейс delta/ поряд із app/owner (порт 1440, com.nitra.delta, акцент teal). Мок-парсер .mt/mandates.yaml (src/mandates.js) за контрактом mt — нормалізація, зріз «мій мандат» за handle, ланцюг ескалації, ШІ-мандати (kind: model); заміниться napi-викликами mandate-crate з mt-rust. UI «Карта мандатів» read-only: мій мандат підсвічений, ШІ-мандати окремою секцією, ланцюг ескалації, доброзичливий empty state. Ідентичність — локальний конфіг (whoami/set_identity, PII поза git). CLI-паритет bin/delta.mjs (whoami/set_identity/mandates_dir/set_mandates_dir/mandates_show) — той самий tool-каталог і мок-парсер, що GUI.
- M1 delta-застосунку (спека docs/specs/260809-delta-app.md): черга «Вирішую» (src/decisions.js — decision-request-парсер за контрактом mt mandates.md, файловий мок runs/{run-id}/decisions/, deriveQueue за computed_owner + сортування за leverage-фасетами); квіз-гейт one-tap (src/quiz.js — LLM-генератор з детермінованим фолбеком, generated_by != recommended_by, формат NNNN-quiz.md за нормативним контрактом M6 фаза 0); Ed25519-підпис пристрою через Web Crypto (src/signing.js, канонікалізація JSON перед підписом) і ApprovalResponse (src/approval.js — інваріант «без завершеного квізу підпис неможливий», NNNN-approval.json); оркестрація generate/answer/sign у src/decision-flow.js, спільна для CLI і GUI. UI «Вирішую» (DecisionsQueue.vue/DecisionCard.vue) поряд із картою мандатів. CLI-паритет: decisions_show/decision_quiz/decision_approve/device_pubkey/llm_config/set_llm_config. Фікстури 3 decision-request (reversible, різні computed_owner, один закритий approval.json) + 77 нових vitest-тестів.
- M2 квіз-двигун — множинні питання в одному квіз-файлі (`src/quiz.js`: `formatQuizFile`/`parseQuizFile`
узагальнено з одного `attempts[]` на `questions[]`, кожне зі своїм прапорцем `repetition` й окремим ланцюжком
спроб — `## Питання N`/`## Питання N (повторення)`/`## Питання N (спроба K)`, byte-сумісно з M1-форматом для
one-question квізів). `depth: standard` (2 питання про саму розвилку — `generateStandardQuiz`/
`fallbackStandardQuiz`/`callLlmStandardQuizGenerator`); `rephraseQuestion` — перефразування формулювання на
ретраї через LLM (best-effort, options/correctAnswer незмінні). `decisions.js`: `decisionType` (`decision_type`
фронтматера decision-request, власне розширення поза контрактом mt) — домен для бази знань; `depthForFacets`
доведено до контрактного мапінгу mandates.md «Крок 3» (ask-and-wait/decide-and-inform/local → teach-back/
standard/one-tap), задокументовано таблицею й порогом `NOTABLE_COST_EUR_THRESHOLD`. Фікстура 0002 отримала
`decision_type` і тепер демонструє `depth: standard` (blast_radius: subtree). `signing.js`: base64-фолбек
дороблено до `globalThis.Buffer`/`globalThis.Buffer !== undefined` (лінт-чистота).
- Особиста база знань `src/knowledge.js` (M2, конституція п.2/9 — «що я зрозумів, підписуючи»; «профспілковий
режим»: приватне сховище, видиме лише власнику). Зберігання — поза git, файл-сусід `config.json`/
`device_key.json` (`knowledge.json`). Запис на кожен завершений квіз: `{decisionRef, domain, question, options,
correctAnswer, microlesson, iterations, timeToUnderstandingSec, completedAt, intervalDays, lastRepeatedAt}` —
`options`/`correctAnswer` понад буквальний перелік полів специфікації, потрібні, щоб пізніше матеріалізувати
питання-повторення без LLM/decision-request. Деривації: `domainDigest` (конспект по доменах), `timeToUnderstandingTrend`
(приватна метрика №3 спеки, `insufficient-data` при <2 записах, не вигаданий «flat»). Spaced repetition: драбинка
інтервалів 1→3→7→21 днів (`dueRepetition`/`recordRepetitionAnswer` — правильна відповідь просуває драбинку,
неправильна скидає до 1 дня). Усі функції з годинником — pure, приймають `Date` ін'єкцією (тести підробляють час).
- Оркестрація навчального циклу M2 (`src/decision-flow.js`). Мікроурок повертається ПІСЛЯ будь-якої відповіді
(правильної теж — раніше лише після неправильної). Навчальний режим при фейлі («право на глибину»):
`submitQuizAnswer` розгортає decision-request шар за шаром кумулятивно з кожним наступним фейлом того самого
питання — 1-й фейл `## Контекст`, 2-й +наслідки всіх варіантів, 3-й+ +рекомендація агента з обґрунтуванням;
повторне питання (те саме, або перефразоване LLM-ом через `rephraseQuestion`, коли ендпоінт живий).
Spaced repetition на живих рішеннях: `depth: one-tap` підмішує друге питання з бази знань, коли інтервал
домену настав (`dueRepetition`) — позначене «Питання 2 (повторення)», відповідь оновлює інтервал
(`recordRepetitionAnswer`); немає дозрілого знання — квіз лишається одним питанням. `depth: standard` гейтить
2 питання про саму розвилку — підпис доступний лише коли ВСІ питання квізу здано (`done: true`). Кожен
завершений квіз дописує запис у базу знань (домен — `decisionType`). Standard/spaced-repetition свідомо не
стекуються в M2 (задокументоване рішення обсягу).
- CLI/GUI паритет і UI для M2. `bin/delta.mjs`: `knowledge_show` tool + `knowledgeIoCli` (файл-сусід
`config.json`/`device_key.json`, поза git); `decision_quiz`/`decision_approve` тепер передають `knowledgeIo` і
`llmConfig` (spaced repetition + перефразування на ретраї). `src-tauri`: `read_knowledge`/`write_knowledge`
Rust-команди (той самий патерн, що `read_device_key`/`write_device_key`) + Rust-тест на round-trip. GUI-транспорт
(`src/tool/index.js`) дзеркалить те саме через Tauri `invoke`. `DecisionCard.vue`: мікроурок після будь-якої
відповіді, розгортна секція навчального режиму (`explain`), прогрес «Питання N/M» з позначкою «повторення»,
перехід на наступне питання без фіналізації (`done: false`). Нова вкладка «Знання» (`KnowledgeView.vue` +
`use-knowledge.js`) — конспект по доменах і приватний тренд «час до розуміння» простим списком, без чартів.
README: розділ M2 з demo-послідовністю (фейл → шари → мікроурок у базі → `knowledge_show`) і нотатками про
демонстрацію spaced repetition.
- M3 — мок `validate_mandate_change` за crate `mt-rust/crates/mt-mandates/src/change.rs` (`src/mandate-change.js`):
`generation` мусить зрости РІВНО на 1; класифікація зміни одного owner-мандата по осях
(`scope.refs`/`decision_types`, `thresholds.budget_eur`/`risk`/`irreversible`/`audacity`) на
added/removed/kind-changed/escalates-to-changed/widened/narrowed/unchanged — змішаний diff трактується як
РОЗШИРЕННЯ, видалення — звуження «до нуля». Розширення/додавання вимагає підпису делегатора рівня вище;
звуження/видалення — самопідпис owner; зміна `escalates_to` — ПОДВІЙНИЙ підпис (новий адресат + старий
делегатор); «остання константа» — розширення `kind: model` мандата (включно з `audacity` вгору) підписує
ЛИШЕ людський ключ, модельний підпис відхиляється безумовно навіть від правильного делегатора. Повна
структурна валідація (`validateMandatesFileStructure`) — 1:1 мок `parse.rs::validate` (рівно один корінь,
досяжність без циклів/висячих handle, непорожній scope, `audacity` лише для `kind: model`). Крипто-шар —
підписує ПОВНИЙ канонікалізований payload через існуючий `signing.js` (той самий шлях, що `ApprovalResponse`),
не domain-separated хеш change.rs — задокументована різниця. `src/device-registry.js` — публічний реєстр
`handle → {role, pubkeyBase64}` у `mandatesDir` (комітиться в git, на відміну від приватного `device_key.json`),
мок «pubkey-кешу» crate. 52+29 нових vitest-тестів звірено з тест-кейсами `change.rs`/`parse.rs` (генерація +1,
розширення без підпису делегатора, модельний підпис на «останній константі», подвійний `escalates_to`, змішаний
diff, видалення, структурна валідність).
- M3 — трек-рекорд ШІ-мандата (`src/track-record.js`, `docs/specs/260809-delta-app.md` «Обсяг M3» п.2):
дериваційний зріз `decisions/`-історії для одного `handle` моделі — кількість підписаних рішень за
`decision_type`, останні N з розгорткою (`recent`, з посиланням на файл), частка без override. Атрибуція
підписанта — виключно через `device-registry.js` (`pubkey` → `{handle, role}`), не `computed_owner`
decision-request. ЧЕСНІСТЬ (задокументовано за прямою вимогою задачі): числа названі «активність і
послідовність», НЕ success rate — немає ще audit-механіки/аналізатора ескалацій, яка оцінювала б якість
рішень. Override — задокументоване спрощення: пізніший (за `signed_at`) людський `ApprovalResponse` У ТОМУ
САМОМУ run-і з протилежним `chosen_option` (не обов'язково та сама розвилка — справжня семантика потребує
графової прив'язки, якої мок не має). Нові фікстури `runs/demo-3`/`runs/demo-4` (model-рішення без override
і з override) + `fixtures/device-registry.json`; 8 нових vitest-тестів.
- M3 — екран «Довіряю» (`src/trust.js`, `TrustView.vue`, `use-trust.js`): третя площина конституції — мої
ШІ-мандати (`escalates_to === я`) з трек-рекордом, порогами, audacity-описом наслідків кожного рівня (low:
агент питає перед відмовою постачальнику; medium: відмовляє сам у reversible; high: жорсткі переговори сам,
обмежено інваріантом reversible — статичні тексти UI). Кнопки MVP-скоуп однієї осі (задокументоване звуження
обсягу — повний багатовісний майстер делегування лишається пізнішому мілстоуну): audacity ± один щабель,
`budget_eur` фолбек на межах драбинки. «Звузити» — самопідпис, миттєво, без квізу; «розширити» — веде ЛИШЕ до
change-proposal (M3, наступний коміт), немає прямого шляху редагувати `kind: model` мандат. CLI-паритет:
`trust_show`/`mandate_narrow` (`bin/delta.mjs`, `src/tool/catalog.js`). Нова вкладка «Довіряю» в `App.vue`.
15 нових vitest-тестів.
- M3 — change-proposal flow (`src/change-proposal.js`) і ШІ-петиція (`src/ai-petition.js`, tool `ai_petition`):
розширення ШІ-мандата НІКОЛИ не пише `.mt/mandates.yaml` напряму — матеріалізується як звичайний
decision-request у черзі делегатора (`runs/mandate-change-{changeId}/decisions/0001-decision-request.md` —
плоский run-id замість вкладеного сегмента з тексту задачі, щоб не чіпати однорівневий `scan_decisions`-сканер
CLI/GUI, задокументоване відхилення), `leverage_facets` форсовані на найвищу глибину, яку M2 реалізує
(`standard` — `irreversible: false` + `blast_radius: subtree`, `teach-back` лишається M5, форс і причина
задокументовані в заголовку модуля). Людина проходить ЗВИЧАЙНИЙ `decision_quiz`/`decision_approve`;
`applyMandateChangeProposal`/`mandate_change_apply` — міст між квіз-гейтом і `validate_mandate_change`: той
самий фізичний ключ, що підписав `ApprovalResponse`, підписує ОКРЕМИЙ акт мутації мандата. ШІ-петиція —
headless tool: модель формує draft-розширення власного мандата з evidence з трек-рекорду, підписує ЛИШЕ
петицію (не саму зміну) модельним ключем, кладе ту саму change-proposal у чергу делегатора. Модель не має
окремого фізичного пристрою в цьому моку — застосунок локально утримує її ключ (`model_keys/{handle}.json`,
той самий каталог, що людський `device_key.json`), задокументоване рішення M3. CLI-паритет:
`mandate_widen_propose`/`ai_petition`/`mandate_change_apply` (`bin/delta.mjs`) + дзеркало в GUI-транспорті
(`src/tool/index.js`, генеричні Tauri `read_text_file`/`write_text_file` + `@tauri-apps/api/path`, без нових
Rust-команд). Рефактор `validateMandateChange`/`validateMandatesFileStructure`
(диспетчер `verdictForOwnerChange` + винесені `collectOwnersAndShapes`/`checkEscalationReachability`) і
диспетчерів CLI/GUI (`handle*Cli`/`handle*Gui`) — знижує cognitive complexity, лінт (`oxlint`/`eslint`) чистий.
21 новий vitest-тест (change-proposal + ai-petition); README: розділ M3 з перевіреною demo-послідовністю
(петиція → чергу людини → квіз найвищої глибини → підпис → mandates.yaml оновлений; спроба застосувати зміну
модельним підписом → відмова).
- M4 — мультиюзер: directory (.mt/directory.json, PII поза git), мультипартійний підпис (кворум) для irreversible-рішень (quorum.js, approvers[], NNNN-quiz-{handle}.md/NNNN-approval-{handle}.json), process watcher (watcher.js, bin/delta-watcher.mjs, SLA/grace ping-then-escalate), тиха година (quiet_hours), профспілковий агрегатор what_system_knows. 73 нові vitest-тести, README M4 з реально прогнаною demo-послідовністю (кворум 2/2 з двох незалежних Ed25519-ключів).
- M5: teach-back, Штаб-бриф, кандор, детектор дрейфу і делегування одним квізом
- M6 UI-догон M5: вкладка «Незручна правда» (candor), секція «Дрейф» + делегування з UI на вкладці «Стежу»
- M6 дельта-звіт: org.js (hourly_rate_eur), report.js (рух межі/рішення/ціна гейта/глибина делегування/агреговано), вкладка «Звіт»
- M6 kill-switch: SUSPENSION-шар (kill-switch.js) — перенаправлення черги (decisions.js) і пригнічення watcher-а (watcher.js), панічна кнопка в шапці без квізу
- M6 тижневе дельта-рев'ю (review.js — draft-widen через ai_petition-патерн, кандидати на звуження, відкриті розбіжності), tool-поверхня, README M6 + статус спеки
- Дистрибуція в організацію: власні іконки (Δ, teal), Tauri auto-updater (useUpdater(), спільний ключ з app/owner), реліз-конвеєр release-delta.yml за зразком owner

### Fixed

- M1-баги, знайдені на рев'ю (перед M2): `decision_quiz`/`decision_approve`/`submitQuizAnswer` тепер відмовляють
з поясненням «рішення вже закрите» на `NNNN`, що вже має підписаний `NNNN-approval.json` — квіз-файл більше не
мутується (`iterations` не росте) після підпису (`decision-flow.js: assertDecisionOpen`). `signing.js`:
`Uint8Array.prototype.toBase64`/`Uint8Array.fromBase64` (Node 24+ API) тепер мають спільний feature-detect
фолбек — `Buffer` (CLI/Bun) або побайтовий `btoa`/`atob` (WKWebView у Tauri GUI, де нативний метод може бути
відсутній) — знижує ризик несумісності підпису пристрою в GUI-поверхні. Тести round-trip на обидва фолбек-шляхи.
