// «Довіряю» — третя площина конституції (docs/specs/260809-delta-app.md,
// «Обсяг M3», п.3): список ШІ-мандатів під відповідальністю поточного
// handle (`escalates_to === мій handle`) — трек-рекорд, бюджети/пороги,
// audacity з прикладами наслідків, дії «звузити»/«розширити». Транспорт-
// незалежний дериваційний шар — той самий інваріант, що `mandates.js`/
// `decisions.js`: GUI (composable) і CLI (`delta trust_show`) бачать той
// самий результат з тих самих файлів.
//
// **Audacity-приклади — статичні описи UI, буквально з задачі M3** (не
// дериваційна логіка, задокументований текст рівнів зухвалості):
//   low    — «агент питає перед відмовою постачальнику»
//   medium — «відмовляє сам у reversible»
//   high   — «жорсткі переговори сам» (обмежено інваріантом reversible —
//            mandates.md: «зухвалість обмежена інваріантом reversible»)
//
// **«Звузити»/«розширити» — MVP-скоуп однієї осі (audacity), не повний
// майстер делегування (docs/specs п.12, «симуляція на історії») —
// задокументоване звуження обсягу M3: повний багатовісний редактор
// мандата лишається пізнішому мілстоуну. Кнопка звужує/розширює
// `audacity` на один щабель драбинки `low → medium → high`; коли
// `kind: model` уже на межі (найнижчий/найвищий щабель), фолбек —
// `thresholds.budget_eur` (÷2 звуження, ×1.5 розширення, округлено).

import { deriveTrackRecord } from './track-record.js'

export const AUDACITY_LEVELS = Object.freeze(['low', 'medium', 'high'])

export const AUDACITY_DESCRIPTIONS = Object.freeze({
  low: 'Низька: агент питає людину перед тим, як відмовити постачальнику чи контрагенту.',
  medium: 'Середня: агент відмовляє сам, коли рішення зворотне (reversible) — без попереднього запиту.',
  high: 'Висока: агент веде жорсткі переговори самостійно — обмежено інваріантом reversible (mandates.md): незворотне рішення high-зухвалість не дозволяє.'
})

/**
 * @param {object} mandate нормалізований мандат (`mandates.js`/`mandate-change.js` camelCase форма)
 * @returns {'low'|'medium'|'high'} `audacity` із застосованим дефолтом контракту (`low`)
 */
export function audacityOf(mandate) {
  return mandate.thresholds.audacity ?? 'low'
}

/**
 * Дериваційний зріз екрана «Довіряю» — мої ШІ-мандати (`escalates_to === handle`)
 * з трек-рекордом кожного.
 * @param {object} params вхідні параметри
 * @param {{generation: number, mandates: object[]}} params.mandatesFile розібраний `.mt/mandates.yaml` ({@link import('./mandate-change.js').parseMandatesFile})
 * @param {object[]} params.deviceRegistry записи реєстру пристроїв (`device-registry.js`)
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {string|null|undefined} params.handle мій handle (делегатор)
 * @returns {{generation: number, items: {mandate: object, audacity: string, audacityDescription: string, trackRecord: object}[]}}
 *   зріз — мої моделі + трек-рекорд кожної
 */
export function deriveTrustView({ mandatesFile, deviceRegistry, decisionsDirs, handle }) {
  const myModels = handle ? mandatesFile.mandates.filter(m => m.kind === 'model' && m.escalatesTo === handle) : []
  const items = myModels.map(mandate => {
    const audacity = audacityOf(mandate)
    return {
      mandate,
      audacity,
      audacityDescription: AUDACITY_DESCRIPTIONS[audacity],
      trackRecord: deriveTrackRecord({ decisionsDirs, deviceRegistry, handle: mandate.owner })
    }
  })
  return { generation: mandatesFile.generation, items }
}

/**
 * @param {{generation: number, mandates: object[]}} file поточний файл
 * @param {string} ownerHandle owner запису, що замінюється
 * @param {(mandate: object) => object} updater чиста функція `old mandate → new mandate`
 * @returns {{generation: number, mandates: object[]}} новий файл (`generation + 1`, решта записів незмінна)
 */
export function withMandateReplaced(file, ownerHandle, updater) {
  return {
    generation: file.generation + 1,
    mandates: file.mandates.map(m => (m.owner === ownerHandle ? updater(m) : m))
  }
}

/**
 * @param {'low'|'medium'|'high'} level поточний рівень
 * @returns {'low'|'medium'|'high'|null} наступний вищий рівень, або null — уже на стелі
 */
function audacityUp(level) {
  const idx = AUDACITY_LEVELS.indexOf(level)
  return idx < AUDACITY_LEVELS.length - 1 ? AUDACITY_LEVELS[idx + 1] : null
}

/**
 * @param {'low'|'medium'|'high'} level поточний рівень
 * @returns {'low'|'medium'|'high'|null} наступний нижчий рівень, або null — уже на дні
 */
function audacityDown(level) {
  const idx = AUDACITY_LEVELS.indexOf(level)
  return idx > 0 ? AUDACITY_LEVELS[idx - 1] : null
}

/**
 * Звужений мандат — audacity на один щабель нижче; на дні (`low`) — фолбек
 * на `budget_eur` (÷2, мінімум 0). MVP-скоуп однієї осі, див. заголовок модуля.
 * @param {object} mandate нормалізований мандат
 * @returns {object} новий мандат (той самий, якщо звужувати нікуди — caller дизейблить кнопку)
 */
export function narrowMandateOneStep(mandate) {
  const down = mandate.kind === 'model' ? audacityDown(audacityOf(mandate)) : null
  if (down) return { ...mandate, thresholds: { ...mandate.thresholds, audacity: down } }
  if (mandate.thresholds.budgetEur !== null && mandate.thresholds.budgetEur > 0) {
    return {
      ...mandate,
      thresholds: { ...mandate.thresholds, budgetEur: Math.max(0, Math.round(mandate.thresholds.budgetEur / 2)) }
    }
  }
  return mandate
}

/**
 * Розширений мандат — audacity на один щабель вище; на стелі (`high`) —
 * фолбек на `budget_eur` (×1.5, мінімум +50 від нуля). MVP-скоуп однієї осі.
 * @param {object} mandate нормалізований мандат
 * @returns {object} новий мандат (той самий, якщо розширювати нікуди — caller дизейблить кнопку)
 */
export function widenMandateOneStep(mandate) {
  const up = mandate.kind === 'model' ? audacityUp(audacityOf(mandate)) : null
  if (up) return { ...mandate, thresholds: { ...mandate.thresholds, audacity: up } }
  const currentBudget = mandate.thresholds.budgetEur ?? 0
  const nextBudget = currentBudget > 0 ? Math.round(currentBudget * 1.5) : 50
  return { ...mandate, thresholds: { ...mandate.thresholds, budgetEur: nextBudget } }
}

/**
 * true — мандат уже на стелі за обома фолбек-осями (audacity high І
 * budget_eur відсутній ceiling) — UI дизейблить кнопку «розширити».
 * @param {object} mandate нормалізований мандат
 * @returns {boolean} true — розширювати нікуди (MVP-скоуп: лише дві осі)
 */
export function isAtWidenCeiling(mandate) {
  const audacityCapped = mandate.kind !== 'model' || audacityOf(mandate) === 'high'
  return audacityCapped && mandate.thresholds.budgetEur === null
}

/**
 * true — мандат уже на дні за обома фолбек-осями (audacity low І
 * budget_eur 0) — UI дизейблить кнопку «звузити».
 * @param {object} mandate нормалізований мандат
 * @returns {boolean} true — звужувати нікуди
 */
export function isAtNarrowFloor(mandate) {
  const audacityFloored = mandate.kind !== 'model' || audacityOf(mandate) === 'low'
  return audacityFloored && (mandate.thresholds.budgetEur === null || mandate.thresholds.budgetEur === 0)
}
