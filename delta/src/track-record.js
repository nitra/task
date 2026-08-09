// Трек-рекорд ШІ-мандата (M3, docs/specs/260809-delta-app.md, «Обсяг M3»,
// п.2): дериваційний зріз history `decisions/` для ОДНОГО `handle` (моделі)
// — скільки рішень якого `decision_type`, останні N з розгорткою, і частка
// рішень без наступного людського override.
//
// **ЧЕСНІСТЬ (задокументовано за прямою вимогою задачі):** ці числа —
// «активність і послідовність» моделі, НЕ «success rate»/«якість». Немає
// суддя-механіки (аналізатор ескалацій з mandates.md ще не реалізований —
// M6), яка б оцінювала, чи рішення моделі БУЛИ ПРАВИЛЬНИМИ; трек-рекорд лише
// рахує (а) скільки разів мандат моделі покривав рішення і (б) чи людина
// пізніше явно не погодилась (override). UI (`TrustView.vue`) відображає
// це буквально як «активність», не як зірочки/рейтинг.
//
// **Атрибуція підписанта — виключно через device-registry.js.** Схема
// `ApprovalResponse` (mandates.md) несе лише `pubkey`, не `handle`/`role` —
// той самий інваріант, що crate делегує «чи pubkey належить заявленому
// handle» викликачу («поза межами crate»). Тут викликач — цей модуль,
// джерело істини — `device-registry.json` (той самий реєстр, що
// `mandate-change.js` звіряє при валідації підписів зміни мандата).
//
// **Спрощення override (задокументовано за прямою вимогою задачі):**
// override = ПІЗНІШИЙ (за `signed_at`) підписаний `ApprovalResponse`
// ЛЮДИНИ в ТОМУ САМОМУ run-і (`runs/{run-id}/decisions/`) з ПРОТИЛЕЖНИМ
// `chosen_option`. Це НЕ перевіряє, що людський approval стосується того ж
// самого класу рішень чи того ж вузла графа — будь-яка пізніша незгодна
// людська відповідь у run-і рахується як сигнал override. Справжня
// override-семантика (той самий вузол/клас рішень, не просто той самий
// run) потребує графової прив'язки decision-request до вузла, якої мок M3
// не має — задокументований борг, перенесений на M6 (аналізатор ескалацій).

import { findByPubkey } from './device-registry.js'
import { parseDecisionRequest } from './decisions.js'

const DECISION_REQUEST_RE = /^(\d{4})-decision-request\.md$/
const DEFAULT_RECENT_LIMIT = 5

/**
 * Розбирає одну `decisions/`-директорію (один run) у список пар
 * decision-request + підписаний approval (пари БЕЗ approval — розвилка ще
 * не вирішена — пропускаються, трек-рекорд рахує лише завершені акти).
 * @param {{dir: string, files: {name: string, content: string}[]}} decisionsDir скановані файли одного run-у
 * @returns {{runId: string|null, nnnn: string, path: string, decisionRequest: object, approval: object}[]} пари цього run-у
 */
function pairsInDir({ dir, files }) {
  const filesByName = new Map(files.map(f => [f.name, f.content]))
  const runId = dir.split('/').filter(Boolean).at(-2) ?? null
  const pairs = []
  for (const file of files) {
    const match = DECISION_REQUEST_RE.exec(file.name)
    if (!match) continue
    const nnnn = match[1]
    const approvalText = filesByName.get(`${nnnn}-approval.json`)
    if (!approvalText) continue
    let approval
    try {
      approval = JSON.parse(approvalText)
    } catch {
      continue // побитий approval.json — не зараховуємо (той самий дух, що decisions.js: побита фікстура не валить решту)
    }
    const decisionRequest = parseDecisionRequest(file.content, { path: `${dir}/${file.name}`, runId, nnnn })
    pairs.push({ runId, nnnn, path: `${dir}/${nnnn}-approval.json`, decisionRequest, approval })
  }
  return pairs
}

/**
 * @param {object} pair пара decision-request + approval ({@link pairsInDir})
 * @param {object[]} deviceRegistry записи реєстру пристроїв
 * @returns {{handle: string, role: 'human'|'model'}|null} атрибуція підписанта, або null — pubkey не зареєстрований
 */
function signerOf(pair, deviceRegistry) {
  return findByPubkey(deviceRegistry, pair.approval.pubkey)
}

/**
 * Override-перевірка одного model-рішення проти решти пар ТОГО САМОГО run-у
 * — «спрощення» задокументоване в заголовку модуля.
 * @param {object} modelPair model-рішення, яке перевіряємо
 * @param {object[]} runPairs усі пари цього ж run-у (включно з `modelPair`)
 * @param {object[]} deviceRegistry записи реєстру пристроїв
 * @returns {boolean} true — знайдено пізнішу людську відповідь з протилежним `chosen_option`
 */
function isOverridden(modelPair, runPairs, deviceRegistry) {
  const modelSignedAtMs = Date.parse(modelPair.approval.signed_at)
  return runPairs.some(other => {
    if (other === modelPair) return false
    const signer = signerOf(other, deviceRegistry)
    if (!signer || signer.role !== 'human') return false
    if (other.approval.chosen_option === modelPair.approval.chosen_option) return false
    return Date.parse(other.approval.signed_at) > modelSignedAtMs
  })
}

/**
 * @param {object[]} entries записи трек-рекорду ({@link deriveTrackRecord})
 * @returns {{decisionType: string, count: number}[]} кількість рішень за decision_type, спадно за count, tie-break за назвою
 */
function byDecisionTypeCounts(entries) {
  const counts = new Map()
  for (const e of entries) counts.set(e.decisionType, (counts.get(e.decisionType) ?? 0) + 1)
  return Array.from(counts, ([decisionType, count]) => ({ decisionType, count })).toSorted(
    (a, b) => b.count - a.count || a.decisionType.localeCompare(b.decisionType)
  )
}

/**
 * Дериваційний трек-рекорд одного `handle` (моделі) — читає всі
 * `decisions/`-run-и, знаходить рішення, підписані ЦИМ handle (за
 * атрибуцією реєстру пристроїв), рахує активність/послідовність.
 * @param {object} params вхідні параметри
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії (той самий формат, що `decisions.js: deriveQueue`)
 * @param {object[]} params.deviceRegistry записи реєстру пристроїв (`device-registry.js`)
 * @param {string} params.handle handle моделі, чий трек-рекорд деривуємо
 * @param {number} [params.recentLimit] скільки останніх рішень включати в розгортку (дефолт 5)
 * @returns {{
 *   handle: string,
 *   totalDecisions: number,
 *   byDecisionType: {decisionType: string, count: number}[],
 *   recent: {runId: string|null, nnnn: string, decisionType: string, chosenOption: string, signedAt: string, path: string, override: boolean}[],
 *   overrideCount: number,
 *   overrideFreeCount: number,
 *   overrideFreeRate: number|null
 * }} трек-рекорд («активність і послідовність» — НЕ success rate, див. заголовок модуля)
 */
export function deriveTrackRecord({ decisionsDirs, deviceRegistry, handle, recentLimit = DEFAULT_RECENT_LIMIT }) {
  const entries = []
  for (const decisionsDir of decisionsDirs ?? []) {
    const runPairs = pairsInDir(decisionsDir)
    for (const pair of runPairs) {
      const signer = signerOf(pair, deviceRegistry)
      if (!signer || signer.role !== 'model' || signer.handle !== handle) continue
      entries.push({
        runId: pair.runId,
        nnnn: pair.nnnn,
        path: pair.path,
        decisionType: pair.decisionRequest.decisionType ?? 'general',
        chosenOption: pair.approval.chosen_option,
        signedAt: pair.approval.signed_at,
        override: isOverridden(pair, runPairs, deviceRegistry)
      })
    }
  }

  const sortedByRecency = entries.toSorted((a, b) => b.signedAt.localeCompare(a.signedAt))
  const overrideCount = entries.filter(e => e.override).length
  const overrideFreeCount = entries.length - overrideCount

  return {
    handle,
    totalDecisions: entries.length,
    byDecisionType: byDecisionTypeCounts(entries),
    recent: sortedByRecency.slice(0, recentLimit),
    overrideCount,
    overrideFreeCount,
    overrideFreeRate: entries.length === 0 ? null : overrideFreeCount / entries.length
  }
}
