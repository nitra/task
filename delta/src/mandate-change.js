// Мок `validate_mandate_change` за crate mt-rust `crates/mt-mandates/src/
// change.rs` (docs/specs/260809-delta-app.md, «Обсяг M3», п.1). Контракт:
// mt/docs/architecture/mandates.md, «Нормативний контракт (M6 фаза 0)» —
// таблиця схеми `.mt/mandates.yaml` (колонка «Хто змінює») і napi-сигнатура
// `validate_mandate_change(old, new, signatures) → Verdict`.
//
// **Мок відтворює семантику change.rs, не байти:**
// - Класифікація розширення/звуження по осях (scope.refs/decision_types,
//   thresholds.budget_eur/risk/irreversible/audacity) — 1:1 з
//   `change.rs::classify`/`scope_widened`/`thresholds_widened` тощо.
// - **Криптографія — власний вибір, не порт байт-у-байт.** change.rs підписує
//   `DOMAIN \0 old_generation \0 new_generation \0 sha256(new_file)` —
//   domain-separated фіксований формат agent-protocol. Цей мок підписує
//   ПОВНИЙ канонікалізований payload `{schema_version, type, old_generation,
//   new_generation, new_file}` через `signing.js: signPayload`/`verifyPayload`
//   — той самий шлях, що вже підписує `ApprovalResponse` (approval.js) у
//   цьому застосунку. Задокументоване рішення M3: консистентність з
//   існуючим крипто-шаром важливіша за побайтову сумісність зі crate (мок
//   буде ЗАМІНЕНИЙ napi-викликом crate, не має пережити його).
// - **Атрибуція ролі підписанта — через `device-registry.js`, не заявлена
//   викликачем.** change.rs явно делегує «чи pubkey належить заявленому
//   handle/ролі» викликачу (docs-коментар crate). Цей мок МАЄ реєстр
//   (`device-registry.json`) під рукою, тож звіряє замість сліпо довіряти —
//   сильніше за буквальний контракт crate, задокументоване підсилення.
//
// **Рішення, успадковані буквально з change.rs (docs-коментар модуля,
// «Рішення, не покриті буквою контракту»):** `old`/`new` — повні знімки
// файлу, не структурований diff; «делегатор рівня вище» для мандата = OLD
// `escalates_to` (новий мандат — `escalates_to` у `new`); змішаний diff
// (одна вісь звужується, інша розширюється) — трактується як розширення;
// видалення мандата — звуження «до нуля», самопідпис владника, що
// видаляється.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { parseMandates } from './mandates.js'
import { signPayload, verifyPayload } from './signing.js'

const RISK_ORDER = ['low', 'medium', 'high']
const AUDACITY_ORDER = ['low', 'medium', 'high']

/**
 * @param {string} reason причина невалідності
 * @returns {{valid: false, reason: string}} невалідний вердикт
 */
function invalid(reason) {
  return { valid: false, reason }
}

const VALID = Object.freeze({ valid: true })

/**
 * Розбирає `.mt/mandates.yaml` у `{generation, mandates}` — верхньорівнева
 * форма контракту (mandates.md: «Документ — обʼєкт із двома полями
 * верхнього рівня»), на відміну від `mandates.js: parseMandates`, яка
 * повертає лише масив `mandates[]` (M0 контракт цього не потребував).
 * Відсутнє/невалідне `generation` — дефолт `1` («при створенні файлу»,
 * той самий консервативний дефолт, що фікстури M0-M2 без цього поля).
 * @param {string|null|undefined} yamlText сирий вміст файлу
 * @returns {{generation: number, mandates: object[]}} нормалізований файл мандатів
 */
export function parseMandatesFile(yamlText) {
  const mandates = parseMandates(yamlText)
  const text = (yamlText ?? '').trim()
  if (!text) return { generation: 1, mandates }
  // parseMandates() вище вже кинула б з тим самим повідомленням при
  // невалідному YAML — тут документ гарантовано розбирається без винятку.
  const doc = parseYaml(text)
  const generation = Number.isSafeInteger(doc?.generation) ? doc.generation : 1
  return { generation, mandates }
}

/**
 * Серіалізує `{generation, mandates}` назад у текст `.mt/mandates.yaml` —
 * snake_case поля, той самий формат, що читає `parseMandatesFile`/
 * `mandates.js: parseMandates` (round-trip). `null`-пороги/`kind: person`
 * не серіалізуються явно (byte-форма мінімальна, як у фікстурах M0).
 * @param {{generation: number, mandates: object[]}} file файл мандатів
 * @returns {string} текст `.mt/mandates.yaml`
 */
export function formatMandatesFile(file) {
  const doc = {
    generation: file.generation,
    mandates: file.mandates.map(m => {
      const entry = { owner: m.owner }
      if (m.kind === 'model') entry.kind = 'model'
      entry.scope = { refs: m.scope.refs, decision_types: m.scope.decisionTypes }
      const thresholds = {}
      if (m.thresholds.budgetEur !== null) thresholds.budget_eur = m.thresholds.budgetEur
      if (m.thresholds.risk !== null) thresholds.risk = m.thresholds.risk
      if (m.thresholds.irreversible !== null) thresholds.irreversible = m.thresholds.irreversible
      if (m.thresholds.audacity !== null) thresholds.audacity = m.thresholds.audacity
      entry.thresholds = thresholds
      entry.escalates_to = m.escalatesTo
      return entry
    })
  }
  return stringifyYaml(doc)
}

/**
 * @param {object} thresholds `{irreversible: boolean|null, ...}`
 * @returns {boolean} `irreversible` із застосованим дефолтом контракту (`false`)
 */
function irreversibleOrDefault(thresholds) {
  return thresholds.irreversible ?? false
}

/**
 * @param {object} thresholds `{audacity: 'low'|'medium'|'high'|null, ...}`
 * @returns {'low'|'medium'|'high'} `audacity` із застосованим дефолтом контракту (`low`)
 */
function audacityOrDefault(thresholds) {
  return thresholds.audacity ?? 'low'
}

/**
 * @param {string[]} oldArr старий масив
 * @param {string[]} newArr новий масив
 * @returns {boolean} true — `newArr` містить елемент, якого немає в `oldArr`
 */
function setWidened(oldArr, newArr) {
  return newArr.some(v => !oldArr.includes(v))
}

/**
 * @param {string[]} oldTypes старі `decision_types`
 * @param {string[]} newTypes нові `decision_types`
 * @returns {boolean} true — розширення (враховує wildcard `"*"`)
 */
function decisionTypesWidened(oldTypes, newTypes) {
  if (oldTypes.includes('*')) return false // старий scope вже покриває все — розширити нікуди
  if (newTypes.includes('*')) return true
  return setWidened(oldTypes, newTypes)
}

/**
 * @param {object} oldScope `{refs, decisionTypes}`
 * @param {object} newScope `{refs, decisionTypes}`
 * @returns {boolean} true — scope розширився (по будь-якій з двох осей)
 */
function scopeWidened(oldScope, newScope) {
  return (
    setWidened(oldScope.refs, newScope.refs) || decisionTypesWidened(oldScope.decisionTypes, newScope.decisionTypes)
  )
}

/**
 * @param {object} oldScope `{refs, decisionTypes}`
 * @param {object} newScope `{refs, decisionTypes}`
 * @returns {boolean} true — scope звузився (по будь-якій з двох осей)
 */
function scopeNarrowed(oldScope, newScope) {
  return (
    setWidened(newScope.refs, oldScope.refs) || decisionTypesWidened(newScope.decisionTypes, oldScope.decisionTypes)
  )
}

/**
 * `null` = без стелі (найширше значення) — розширено, якщо стеля піднялась
 * або зникла зовсім (`old` мала стелю, `new` — ні).
 * @param {number|null} oldValue старе значення
 * @param {number|null} newValue нове значення
 * @returns {boolean} true — розширення
 */
function numericWidened(oldValue, newValue) {
  if (oldValue !== null && newValue === null) return true
  if (oldValue === null) return false
  return newValue > oldValue
}

/**
 * Той самий інваріант, що {@link numericWidened}, для порядкових значень
 * (`risk`), порівняних за позицією в `order`.
 * @param {string|null} oldValue старе значення
 * @param {string|null} newValue нове значення
 * @param {string[]} order зростаюча шкала значень
 * @returns {boolean} true — розширення
 */
function ordWidened(oldValue, newValue, order) {
  if (oldValue !== null && newValue === null) return true
  if (oldValue === null) return false
  return order.indexOf(newValue) > order.indexOf(oldValue)
}

/**
 * @param {object} oldThresholds пороги old-мандата
 * @param {object} newThresholds пороги new-мандата
 * @param {'person'|'model'} kind `kind` мандата (аудасіті-вісь лише для `model`)
 * @returns {boolean} true — пороги розширились (по будь-якій осі)
 */
function thresholdsWidened(oldThresholds, newThresholds, kind) {
  const budget = numericWidened(oldThresholds.budgetEur, newThresholds.budgetEur)
  const risk = ordWidened(oldThresholds.risk, newThresholds.risk, RISK_ORDER)
  const irreversible = !irreversibleOrDefault(oldThresholds) && irreversibleOrDefault(newThresholds)
  const audacity =
    kind === 'model' &&
    AUDACITY_ORDER.indexOf(audacityOrDefault(newThresholds)) > AUDACITY_ORDER.indexOf(audacityOrDefault(oldThresholds))
  return budget || risk || irreversible || audacity
}

/**
 * @param {object} oldThresholds пороги old-мандата
 * @param {object} newThresholds пороги new-мандата
 * @param {'person'|'model'} kind `kind` мандата (аудасіті-вісь лише для `model`)
 * @returns {boolean} true — пороги звузились (по будь-якій осі)
 */
function thresholdsNarrowed(oldThresholds, newThresholds, kind) {
  const budget = numericWidened(newThresholds.budgetEur, oldThresholds.budgetEur)
  const risk = ordWidened(newThresholds.risk, oldThresholds.risk, RISK_ORDER)
  const irreversible = irreversibleOrDefault(oldThresholds) && !irreversibleOrDefault(newThresholds)
  const audacity =
    kind === 'model' &&
    AUDACITY_ORDER.indexOf(audacityOrDefault(oldThresholds)) > AUDACITY_ORDER.indexOf(audacityOrDefault(newThresholds))
  return budget || risk || irreversible || audacity
}

/**
 * Класифікує зміну ОДНОГО owner-мандата між `old`/`new` — 1:1 з
 * `change.rs::classify`: `'added'`/`'removed'`/`'kind-changed'`/
 * `'escalates-to-changed'`/`'widened'`/`'narrowed'`/`'unchanged'`. Змішаний
 * diff (widened і narrowed одночасно по різних осях) — `'widened'`
 * (перевіряється першим, той самий порядок гілок `match`, що в Rust).
 * @param {object|null} oldMandate old-запис владника (null — новий owner)
 * @param {object|null} newMandate new-запис владника (null — видалений owner)
 * @returns {'added'|'removed'|'kind-changed'|'escalates-to-changed'|'widened'|'narrowed'|'unchanged'} вид зміни
 */
export function classifyMandateChange(oldMandate, newMandate) {
  if (!oldMandate && newMandate) return 'added'
  if (oldMandate && !newMandate) return 'removed'
  if (!oldMandate && !newMandate) return 'unchanged'
  if (oldMandate.kind !== newMandate.kind) return 'kind-changed'
  if (oldMandate.escalatesTo !== newMandate.escalatesTo) return 'escalates-to-changed'

  const widened =
    scopeWidened(oldMandate.scope, newMandate.scope) ||
    thresholdsWidened(oldMandate.thresholds, newMandate.thresholds, oldMandate.kind)
  if (widened) return 'widened'
  const narrowed =
    scopeNarrowed(oldMandate.scope, newMandate.scope) ||
    thresholdsNarrowed(oldMandate.thresholds, newMandate.thresholds, oldMandate.kind)
  if (narrowed) return 'narrowed'
  return 'unchanged'
}

/**
 * @param {object} file `{mandates: object[]}`
 * @returns {object|null} мандат кореня (`escalatesTo === null`), або `null` — не знайдено
 */
function findRoot(file) {
  return file.mandates.find(m => m.escalatesTo === null) ?? null
}

/**
 * Перевіряє одну «форму» запису (непорожній scope, `audacity` лише для
 * `kind: model`) — 1:1 з `parse.rs::validate_mandate_shape`.
 * @param {object} mandate один нормалізований мандат
 * @returns {{valid: true}|{valid: false, reason: string}} вердикт форми
 */
function validateMandateShape(mandate) {
  if (mandate.scope.refs.length === 0) {
    return invalid(`owner '${mandate.owner}': scope.refs порожній — порожній масив недопустимий (не «усе»)`)
  }
  if (mandate.scope.decisionTypes.length === 0) {
    return invalid(`owner '${mandate.owner}': scope.decision_types порожній — порожній масив недопустимий (не «усе»)`)
  }
  if (mandate.kind === 'person' && mandate.thresholds.audacity !== null) {
    return invalid(`owner '${mandate.owner}': thresholds.audacity неприпустиме для kind: person`)
  }
  return VALID
}

/**
 * Перший прохід структурної валідації: форма кожного запису + унікальність
 * `owner` + збір `escalates_to`-карти й лічильника коренів. Винесено з
 * {@link validateMandatesFileStructure} окремою функцією — знижує cognitive
 * complexity зовнішньої функції (один цикл з раннім поверненням, не
 * вкладений у решту перевірок).
 * @param {object[]} mandates масив нормалізованих мандатів
 * @returns {{valid: true, owners: Set<string>, escalatesToMap: Map<string, string|null>, rootCount: number}|{valid: false, reason: string}}
 *   зібрані дані для наступних кроків, або перша знайдена помилка форми/дубліката
 */
function collectOwnersAndShapes(mandates) {
  const owners = new Set()
  const escalatesToMap = new Map()
  let rootCount = 0
  for (const mandate of mandates) {
    const shape = validateMandateShape(mandate)
    if (!shape.valid) return shape
    if (owners.has(mandate.owner)) {
      return invalid(
        `owner '${mandate.owner}' зустрічається у мандатах більше одного разу — кожен owner має рівно один активний запис`
      )
    }
    owners.add(mandate.owner)
    escalatesToMap.set(mandate.owner, mandate.escalatesTo)
    if (mandate.escalatesTo === null) rootCount += 1
  }
  return { valid: true, owners, escalatesToMap, rootCount }
}

/**
 * Досяжність кореня скінченним ланцюгом `escalates_to` від КОЖНОГО owner —
 * без циклів і висячих handle. Винесено окремою функцією з тієї самої
 * причини, що {@link collectOwnersAndShapes}.
 * @param {Set<string>} owners усі owner файлу
 * @param {Map<string, string|null>} escalatesToMap owner → escalates_to
 * @param {string} rootOwner owner кореневого мандата
 * @returns {{valid: true}|{valid: false, reason: string}} вердикт досяжності
 */
function checkEscalationReachability(owners, escalatesToMap, rootOwner) {
  const maxSteps = owners.size + 1
  for (const owner of owners) {
    let current = owner
    let steps = 0
    while (current !== rootOwner) {
      steps += 1
      if (steps > maxSteps) {
        return invalid(`цикл ескалації: '${owner}' не досягає кореня '${rootOwner}' за ${maxSteps} кроків`)
      }
      if (!escalatesToMap.has(current)) {
        return invalid(`'${owner}' ескалює до '${current}', якого немає серед owner мандатів (висячий handle)`)
      }
      const next = escalatesToMap.get(current)
      if (next === null) break // інший корінь — вже відхилено вище (rootCount > 1), недосяжно
      current = next
    }
  }
  return VALID
}

/**
 * Повна структурна валідація `{generation, mandates}` — 1:1 з
 * `parse.rs::validate`: `generation ≥ 1`, непорожній `mandates[]`, форма
 * кожного запису, унікальність `owner`, рівно один корінь
 * (`escalatesTo: null`), досяжність кореня скінченним ланцюгом
 * `escalatesTo` без циклів/висячих handle.
 * @param {{generation: number, mandates: object[]}} file файл мандатів
 * @returns {{valid: true}|{valid: false, reason: string}} вердикт структурної валідації
 */
export function validateMandatesFileStructure(file) {
  if (!Number.isSafeInteger(file.generation) || file.generation < 1) {
    return invalid(`generation має бути ≥ 1, отримано ${file.generation}`)
  }
  if (!Array.isArray(file.mandates) || file.mandates.length === 0) {
    return invalid('mandates[] порожній — файл без кореневого мандата невалідний')
  }

  const collected = collectOwnersAndShapes(file.mandates)
  if (!collected.valid) return collected
  const { owners, escalatesToMap, rootCount } = collected

  if (rootCount === 0) return invalid("немає кореневого мандата (escalates_to: null) — рівно один обов'язковий")
  if (rootCount > 1) return invalid(`${rootCount} мандатів з escalates_to: null — має бути рівно один кореневий`)
  const rootOwner = findRoot(file).owner

  return checkEscalationReachability(owners, escalatesToMap, rootOwner)
}

/**
 * Canonical-акт зміни, що підписується — ПОВНИЙ payload (не хеш, на відміну
 * від change.rs, див. заголовок модуля): `{schema_version, type,
 * old_generation, new_generation, new_file}`. `new_file` — увесь новий стан
 * `{generation, mandates}`, той самий обʼєкт, що піде у
 * `formatMandatesFile` — підміна будь-якого поля нового файлу інвалідовує
 * підпис (той самий принцип, що `ApprovalPayload`/`MandateChangePayload`
 * у мт-контракті).
 * @param {number} oldGeneration `generation` старого файлу
 * @param {{generation: number, mandates: object[]}} newFile новий стан файлу
 * @returns {object} canonical payload для підпису/перевірки
 */
export function buildMandateChangePayload(oldGeneration, newFile) {
  return {
    schema_version: 1,
    type: 'mandate-change',
    old_generation: oldGeneration,
    new_generation: newFile.generation,
    new_file: newFile
  }
}

/**
 * Підписує акт зміни ключем пристрою — `signPayload` з `signing.js` (той
 * самий крипто-шар, що `approval.js: buildAndSignApproval`).
 * @param {object} params вхідні параметри
 * @param {number} params.oldGeneration `generation` старого файлу
 * @param {{generation: number, mandates: object[]}} params.newFile новий стан файлу
 * @param {string} params.handle handle підписанта (owner, від імені якого підписано)
 * @param {'human'|'model'} params.role роль ключа підписанта
 * @param {object} params.privateKeyJwk приватний ключ пристрою (JWK)
 * @param {string} params.publicKeyBase64 публічний ключ пристрою (base64)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} підписаний `MandateChangeSignature` — `{handle, role, pubkeyBase64, signedAt, signature}`
 */
export async function signMandateChangeAct({
  oldGeneration,
  newFile,
  handle,
  role,
  privateKeyJwk,
  publicKeyBase64,
  now
}) {
  const payload = buildMandateChangePayload(oldGeneration, newFile)
  const signature = await signPayload(privateKeyJwk, payload)
  return { handle, role, pubkeyBase64: publicKeyBase64, signedAt: (now ? now() : new Date()).toISOString(), signature }
}

/**
 * Перевіряє один підпис акта зміни проти заявленого `pubkeyBase64` —
 * крипто-перевірка ONLY (не звіряє з реєстром пристроїв — це робить
 * викликач {@link validateMandateChange} через `device-registry.js`).
 * @param {number} oldGeneration `generation` старого файлу
 * @param {{generation: number, mandates: object[]}} newFile новий стан файлу
 * @param {{pubkeyBase64: string, signature: string}} sig підпис для перевірки
 * @returns {Promise<boolean>} true — підпис криптографічно дійсний
 */
export function verifyMandateChangeSignature(oldGeneration, newFile, sig) {
  const payload = buildMandateChangePayload(oldGeneration, newFile)
  return verifyPayload(sig.pubkeyBase64, payload, sig.signature)
}

/**
 * `delegator_above` для owner-мандата — `escalates_to`, на який мандат
 * ЗАРАЗ (у `old`) вказує; для нового owner (немає `old`-запису) —
 * `escalates_to` у `new` (change.rs docs: «Новий мандат... делегатором
 * вважається escalates_to-адресат у new»).
 * @param {object|null} oldMandate old-запис
 * @param {object|null} newMandate new-запис
 * @returns {string|null} handle делегатора, або null — немає (корінь/відсутній)
 */
function delegatorAbove(oldMandate, newMandate) {
  if (oldMandate) return oldMandate.escalatesTo
  if (newMandate) return newMandate.escalatesTo
  return null
}

/**
 * @param {object|null} oldMandate old-запис
 * @param {object|null} newMandate new-запис
 * @returns {boolean} true — мандат (в тому знімку, де він існує; пріоритет old) `kind: model`
 */
function isModelMandate(oldMandate, newMandate) {
  if (oldMandate) return oldMandate.kind === 'model'
  if (newMandate) return newMandate.kind === 'model'
  return false
}

/**
 * @param {{generation: number, mandates: object[]}} old старий файл
 * @param {{generation: number, mandates: object[]}} newFile новий файл
 * @returns {string[]} унікальні owner з обох знімків, відсортовані
 */
function allOwners(old, newFile) {
  const owners = new Set([...old.mandates.map(m => m.owner), ...newFile.mandates.map(m => m.owner)])
  return [...owners].toSorted()
}

/**
 * Правило підпису «зміна `escalates_to`» — ПОДВІЙНИЙ підпис (новий адресат
 * + старий делегатор). Винесено з {@link validateMandateChange} окремою
 * функцією разом із рештою `verdictFor*`-хелперів нижче — знижує cognitive
 * complexity зовнішньої функції (плаский виклик-диспетчер замість вкладених
 * `if`-гілок за кожним видом зміни).
 * @param {string} owner owner, чий escalates_to змінився
 * @param {object} newMandate new-запис
 * @param {object|null} oldMandate old-запис
 * @param {Set<string>} verifiedAny handle-и з підтвердженим підписом (будь-яка роль)
 * @returns {{valid: true}|{valid: false, reason: string}} вердикт цього owner
 */
function verdictForEscalatesToChanged(owner, newMandate, oldMandate, verifiedAny) {
  const newAddressee = newMandate.escalatesTo
  const oldDelegator = oldMandate?.escalatesTo ?? null
  const addresseeSigned = newAddressee === null ? true : verifiedAny.has(newAddressee) // корінь (null) — приймати нема кого
  const delegatorSigned = oldDelegator !== null && verifiedAny.has(oldDelegator)
  if (!addresseeSigned || !delegatorSigned) {
    return invalid(
      `owner '${owner}': зміна escalates_to вимагає ПОДВІЙНОГО підпису — новий адресат ескалації і делегатор рівня вище (поточний escalates_to)`
    )
  }
  return VALID
}

/**
 * Правило підпису «розширення/додавання» — підпис делегатора рівня вище
 * (+ ЛИШЕ людський ключ для `kind: model` — «остання константа»).
 * @param {string} owner owner, чий мандат розширився/зʼявився
 * @param {object|null} oldMandate old-запис
 * @param {object|null} newMandate new-запис
 * @param {Set<string>} verifiedAny handle-и з підтвердженим підписом (будь-яка роль)
 * @param {Set<string>} verifiedHuman handle-и з підтвердженим ЛЮДСЬКИМ підписом
 * @returns {{valid: true}|{valid: false, reason: string}} вердикт цього owner
 */
function verdictForWidenedOrAdded(owner, oldMandate, newMandate, verifiedAny, verifiedHuman) {
  if (isModelMandate(oldMandate, newMandate) && verifiedHuman.size === 0) {
    return invalid(
      `owner '${owner}': розширення ШІ-мандата (kind: model) підписує лише людський ключ — модельний підпис відхиляється безумовно`
    )
  }
  const delegator = delegatorAbove(oldMandate, newMandate)
  if (delegator === null) {
    return invalid(`owner '${owner}': розширення без делегатора рівня вище (немає escalates_to)`)
  }
  if (!verifiedAny.has(delegator)) {
    return invalid(
      `owner '${owner}': розширення scope/thresholds вимагає підпису делегатора рівня вище ('${delegator}')`
    )
  }
  return VALID
}

/**
 * Правило підпису «звуження/видалення» — самопідпис owner (будь-якою роллю
 * — change.rs не вимагає ролі для цієї осі).
 * @param {string} owner owner, чий мандат звузився/зник
 * @param {Set<string>} verifiedAny handle-и з підтвердженим підписом (будь-яка роль)
 * @returns {{valid: true}|{valid: false, reason: string}} вердикт цього owner
 */
function verdictForNarrowedOrRemoved(owner, verifiedAny) {
  if (!verifiedAny.has(owner)) {
    return invalid(`owner '${owner}': звуження/видалення мандата вимагає самопідпису owner`)
  }
  return VALID
}

/**
 * Правило підпису «зміна kind» (person↔model) — самопідпис owner ЛЮДСЬКИМ
 * ключем, в обох напрямках.
 * @param {string} owner owner, чий kind змінився
 * @param {Set<string>} verifiedHuman handle-и з підтвердженим ЛЮДСЬКИМ підписом
 * @returns {{valid: true}|{valid: false, reason: string}} вердикт цього owner
 */
function verdictForKindChanged(owner, verifiedHuman) {
  if (verifiedHuman.size === 0 || !verifiedHuman.has(owner)) {
    return invalid(
      `owner '${owner}': зміна kind (person↔model) — delete+create, в обох напрямках підписує людина (owner)`
    )
  }
  return VALID
}

/**
 * Диспетчер за {@link classifyMandateChange} — один owner, один вердикт;
 * `'unchanged'` сюди не потрапляє (викликач фільтрує раніше).
 * @param {string} kind вид зміни ({@link classifyMandateChange})
 * @param {string} owner owner, чия зміна перевіряється
 * @param {object|null} oldMandate old-запис
 * @param {object|null} newMandate new-запис
 * @param {Set<string>} verifiedAny handle-и з підтвердженим підписом (будь-яка роль)
 * @param {Set<string>} verifiedHuman handle-и з підтвердженим ЛЮДСЬКИМ підписом
 * @returns {{valid: true}|{valid: false, reason: string}} вердикт цього owner
 */
function verdictForOwnerChange(kind, owner, oldMandate, newMandate, verifiedAny, verifiedHuman) {
  if (kind === 'escalates-to-changed') return verdictForEscalatesToChanged(owner, newMandate, oldMandate, verifiedAny)
  if (kind === 'widened' || kind === 'added')
    return verdictForWidenedOrAdded(owner, oldMandate, newMandate, verifiedAny, verifiedHuman)
  if (kind === 'narrowed' || kind === 'removed') return verdictForNarrowedOrRemoved(owner, verifiedAny)
  return verdictForKindChanged(owner, verifiedHuman) // kind === 'kind-changed'
}

/**
 * `validate_mandate_change(old, new, signatures) → Verdict` — napi-API
 * поверхня контракту (mandates.md), мок за `change.rs::validate_mandate_change`.
 * Перевіряє: `generation` зріс рівно на 1; новий стан структурно валідний
 * ({@link validateMandatesFileStructure}); для кожного зміненого owner —
 * правило підпису за видом зміни ({@link classifyMandateChange}):
 * розширення/додавання — підпис делегатора рівня вище (+ ЛИШЕ людський
 * ключ для `kind: model` — «остання константа», безумовно); зміна
 * `escalates_to` — ПОДВІЙНИЙ підпис (новий адресат + старий делегатор);
 * звуження/видалення — самопідпис owner; зміна `kind` — самопідпис owner
 * ЛЮДСЬКИМ ключем (в обох напрямках).
 * @param {object} params вхідні параметри
 * @param {{generation: number, mandates: object[]}} params.old старий файл
 * @param {{generation: number, mandates: object[]}} params.new новий файл
 * @param {object[]} [params.signatures] підписи акта — `{handle, role, pubkeyBase64, signature}[]`
 * @returns {Promise<{valid: true}|{valid: false, reason: string}>} вердикт
 */
export async function validateMandateChange({ old, new: newFile, signatures = [] }) {
  if (newFile.generation !== old.generation + 1) {
    return invalid(`generation має зрости рівно на 1: старий ${old.generation}, новий ${newFile.generation}`)
  }

  const structural = validateMandatesFileStructure(newFile)
  if (!structural.valid) return invalid(`новий стан файлу невалідний: ${structural.reason}`)

  // Кожен підпис перевіряється криптографічно ПЕРЕД тим, як зараховуватись
  // хоч у якесь правило нижче — fail-closed: непідтверджений підпис
  // ігнорується, а не приймається «за замовчуванням валідний» (той самий
  // інваріант, що change.rs).
  const verifiedFlags = await Promise.all(
    signatures.map(sig => verifyMandateChangeSignature(old.generation, newFile, sig))
  )
  const verifiedAny = new Set()
  const verifiedHuman = new Set()
  for (const [i, sig] of signatures.entries()) {
    if (!verifiedFlags[i]) continue
    verifiedAny.add(sig.handle)
    if (sig.role === 'human') verifiedHuman.add(sig.handle)
  }

  for (const owner of allOwners(old, newFile)) {
    const oldMandate = old.mandates.find(m => m.owner === owner) ?? null
    const newMandate = newFile.mandates.find(m => m.owner === owner) ?? null
    const kind = classifyMandateChange(oldMandate, newMandate)
    if (kind === 'unchanged') continue

    const verdict = verdictForOwnerChange(kind, owner, oldMandate, newMandate, verifiedAny, verifiedHuman)
    if (!verdict.valid) return verdict
  }

  return VALID
}

/**
 * Застосовує зміну — пише новий `.mt/mandates.yaml` ЛИШЕ після Valid-
 * вердикту (docs/specs/260809-delta-app.md, «Обсяг M3», п.1: «Застосування
 * зміни: пише новий mandates.yaml (generation++) ЛИШЕ після Valid-
 * вердикту»). Invalid-вердикт — файл не чіпається, викликач бачить причину.
 * @param {object} params вхідні параметри
 * @param {{writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.mandatesYamlPath абсолютний шлях до `.mt/mandates.yaml`
 * @param {{generation: number, mandates: object[]}} params.old старий файл
 * @param {{generation: number, mandates: object[]}} params.new новий файл
 * @param {object[]} [params.signatures] підписи акта зміни
 * @returns {Promise<{valid: true}|{valid: false, reason: string}>} вердикт (файл записано лише коли `valid: true`)
 */
export async function applyMandateChangeIfValid({ io, mandatesYamlPath, old, new: newFile, signatures }) {
  const verdict = await validateMandateChange({ old, new: newFile, signatures })
  if (!verdict.valid) return verdict
  await io.writeFile(mandatesYamlPath, formatMandatesFile(newFile))
  return VALID
}
