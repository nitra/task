---
type: JS Module
title: mandate-change.js
resource: delta/src/mandate-change.js
docgen:
  crc: 3eb447fb
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min
  score: 90
  issues: internal-name:signPayload,judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл реалізує процес управління змінами в мандатах: від `parseMandatesFile` та `validateMandatesFileStructure` до `classifyMandateChange` та `buildMandateChangePayload`. Процес завершується через `signMandateChangeAct`, `verifyMandateChangeSignature` та `validateMandateChange` для безпечного застосування оновлень за допомогою `applyMandateChangeIfValid`. Форматування результатів здійснюється через `formatMandatesFile`.

## Поведінка

Потік роботи з мандатами починається з отримання даних через parseMandatesFile та їх серіалізації за допомогою formatMandatesFile. Для перевірки цілісності файлу використовується validateMandatesFileStructure, яка перевіряє структуру, унікальність власників та досяжність кореня.

Процес внесення змін базується на порівнянні старого та нового станів. classifyMandateChange визначає тип зміни для кожного власника, що дозволяє застосувати відповідні правила перевірки через validateMandateChange. Для створення підписаного акта використовуються buildMandateChangePayload та signMandateChangeAct, а криптографічна валідність перевіряється через verifyMandсяChangeSignature.

Застосування змін відбувається через applyMandateChangeIfValid, яка поєднує перевірку валідності за допомогою validateMandateChange та запис нового файлу через formatMandatesFile. При роботі з реєстрами пристроїв та перевірці підписів враховується device-registry.json.

## Публічний API

- parseMandatesFile — Розбирає `.mt/mandates.yaml` у `{generation, mandates}` — верхньорівнева
форма контракту (mandates.md: «Документ — обʼєкт із двома полями
верхнього рівня»), на відміну від `mandates.js: parseMandates`, яка
повертає лише масив `mandates[]` (M0 контракт цього не потребував).
Відсутнє/невалідне `generation` — дефолт `1` («при створенні файлу»,
той самий консервативний дефолт, що фікстури M0-M2 без цього поля).
- formatMandatesFile — Серіалізує `{generation, mandates}` назад у текст `.mt/mandates.yaml` —
snake_case поля, той самий формат, що читає `parseMandatesFile`/
`mandates.js: parseMandates` (round-trip). `null`-пороги/`kind: person`
не серіалізуються явно (byte-форма мінімальна, як у фікстурах M0).
- classifyMandateChange — Класифікує зміну ОДНОГО owner-мандата між `old`/`new` — 1:1 з
`change.rs::classify`: `'added'`/`'removed'`/`'kind-changed'`/
`'escalates-to-changed'`/`'widened'`/`'narrowed'`/`'unchanged'`. Змішаний
diff (widened і narrowed одночасно по різних осях) — `'widened'`
(перевіряється першим, той самий порядок гілок `match`, що в Rust).
- validateMandatesFileStructure — Повна структурна валідація `{generation, mandates}` — 1:1 з
`parse.rs::validate`: `generation ≥ 1`, непорожній `mandates[]`, форма
кожного запису, унікальність `owner`, рівно один корінь
(`escalatesTo: null`), досяжність кореня скінченним ланцюгом
`escalatesTo` без циклів/висячих handle.
- buildMandateChangePayload — Canonical-акт зміни, що підписується — ПОВНИЙ payload (не хеш, на відміну
від change.rs, див. заголовок модуля): `{schema_version, type,
old_generation, new_generation, new_file}`. `new_file` — увесь новий стан
`{generation, mandates}`, той самий обʼєкт, що піде у
`formatMandatesFile` — підміна будь-якого поля нового файлу інвалідовує
підпис (той самий принцип, що `ApprovalPayload`/`MandateChangePayload`
у мт-контракті).
- signMandateChangeAct — Підписує акт зміни ключем пристрою — `signPayload` з `signing.js` (той
самий крипто-шар, що `approval.js: buildAndSignApproval`).
- verifyMandateChangeSignature — Перевіряє один підпис акта зміни проти заявленого `pubkeyBase64` —
крипто-перевірка ONLY (не звіряє з реєстром пристроїв — це робить
викликач {@link validateMandateChange} через `device-registry.js`).
- validateMandateChange — `validate_mandate_change(old, new, signatures) → Verdict` — napi-API
поверхня контракту (mandates.md), мок за `change.rs::validate_mandate_change`.
Перевіряє: `generation` зріс рівно на 1; новий стан структурно валідний
({@link validateMandatesFileStructure}); для кожного зміненого owner —
правило підпису за видом зміни ({@link classifyMandateChange}):
розширення/додавання — підпис делегатора рівня вище (+ ЛИШЕ людський
ключ для `kind: model` — «остання константа», безумовно); зміна
`escalates_to` — ПОДВІЙНИЙ підпис (новий адресат + старий делегатор);
звуження/видалення — самопідпис owner; зміна `kind` — самопідпис owner
ЛЮДСЬКИМ ключем (в обох напрямках).
- applyMandateChangeIfValid — Застосовує зміну — пише новий `.mt/mandates.yaml` ЛИШЕ після Valid-
вердикту (docs/specs/260809-delta-app.md, «Обсяг M3», п.1: «Застосування
зміни: пише новий mandates.yaml (generation++) ЛИШЕ після Valid-
вердикту»). Invalid-вердикт — файл не чіпається, викликач бачить причину.

## Сценарії використання

- `delta/src/tests/mandate-change.test.js` (validateMandatesFileStructure — мок parse.rs::validate; classifyMandateChange) — валідна фікстура (3 мандати, 1 корінь) — valid; generation < 1 — невалідно; порожній mandates[] — невалідно; нуль коренів (escalates_to: null ніде) — невалідно; два корені — невалідно; ще 35

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
