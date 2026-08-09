// Тижневе дельта-рев'ю (M6, docs/specs/260809-delta-app.md, «Обсяг M6»,
// п.4; конституція п.4: «Тижневе дельта-рев'ю (30 хв) — єдина синхронна
// церемонія: організація дивиться звіт і підписує розширення/звуження
// мандатів»). Детермінований порядок денний — БЕЗ LLM, той самий дух, що
// `report.js`: markdown, відтворюваний з фактів файлової системи (той
// самий знімок — ті самі кандидати).
//
// Три секції задачі M6, п.4:
//  (а) **draft-пропозиції розширення** — модель мала `widenThreshold`+
//      рішень БЕЗ override за період (`track-record.js`), і її делегатор
//      НЕ має активного kill-switch (розширювати мандат моделі, чий
//      делегатор щойно явно забрав контроль, суперечило б жесту) — для
//      кожної такої моделі рев'ю САМЕ матеріалізує change-proposal ОДНИМ
//      викликом `ai-petition.js: aiPetition` (буквально задача: «одним
//      викликом ai_petition-патерну від імені аналізатора» — тут
//      «аналізатор» = сам `review_agenda`, той самий headless-actor
//      патерн, що ШІ-петиція M3, initiatedBy позначений `review-agenda`).
//      Підписує ЛЮДИНА звичайним change-proposal-flow (M3) — рев'ю НІЧОГО
//      не підписує само, лише готує чернетку в чергу делегатора.
//  (б) **кандидати на звуження** — моделі з override-ами за період
//      (`overrideCount > 0`) АБО активним kill-switch делегатора (снепшот
//      «зараз») — інформаційний список, БЕЗ автоматичної дії (звуження — та
//      сама кнопка «Довіряю», що людина натискає сама, `trust.js`).
//  (в) **відкриті розбіжності кворумів** (`quorum.status === 'diverged'`) і
//      **застарілі розвилки** (відкриті, старші за `staleDays`) — по УСІХ
//      decision-request-ах воркспейсу (на відміну від `drift.js`, який
//      бачить лише СВОЇ картки власника-приватно — рев'ю ЗВОРОТНЕ:
//      організаційна прозорість, не приватне дзеркало одному).

import { aiPetition } from './ai-petition.js'
import { deriveQuorumStatus, parseDecisionRequest, requiresQuorum } from './decisions.js'
import { modelMandates } from './mandates.js'
import { deriveTrackRecord } from './track-record.js'
import { widenMandateOneStep } from './trust.js'

const DECISION_REQUEST_RE = /^(\d{4})-decision-request\.md$/
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_WIDEN_THRESHOLD = 5
const DEFAULT_STALE_DAYS = 7

/**
 * @returns {{widenThreshold: number, staleDays: number}} дефолтний конфіг рев'ю
 */
export function defaultReviewConfig() {
  return { widenThreshold: DEFAULT_WIDEN_THRESHOLD, staleDays: DEFAULT_STALE_DAYS }
}

/**
 * @param {string|undefined} iso ISO-час
 * @param {Date} start початок вікна (включно)
 * @param {Date} end кінець вікна (включно)
 * @returns {boolean} true — `iso` валідний і потрапляє у `[start, end]`
 */
function withinPeriod(iso, start, end) {
  if (!iso) return false
  const ms = Date.parse(iso)
  return !Number.isNaN(ms) && ms >= start.getTime() && ms <= end.getTime()
}

/**
 * (а)/(б) Один прохід трек-рекорду КОЖНОЇ моделі за період — спільна основа
 * для draft-widen і narrow-кандидатів (уникає подвійного сканування
 * `decisionsDirs`).
 * @param {object} params вхідні параметри
 * @param {object[]} params.mandates нормалізовані мандати
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {object[]} params.deviceRegistry записи реєстру пристроїв (`device-registry.js`)
 * @param {Date} params.periodStart початок вікна
 * @param {Date} params.periodEnd кінець вікна
 * @returns {{model: object, inPeriod: object[], overrideFreeInPeriod: object[], overriddenInPeriod: object[]}[]}
 *   по одному запису на модель карти
 */
function modelActivityInPeriod({ mandates, decisionsDirs, deviceRegistry, periodStart, periodEnd }) {
  return modelMandates(mandates).map(model => {
    const trackRecord = deriveTrackRecord({ decisionsDirs, deviceRegistry, handle: model.owner, recentLimit: Number.MAX_SAFE_INTEGER })
    const inPeriod = trackRecord.recent.filter(e => withinPeriod(e.signedAt, periodStart, periodEnd))
    return {
      model,
      inPeriod,
      overrideFreeInPeriod: inPeriod.filter(e => !e.override),
      overriddenInPeriod: inPeriod.filter(e => e.override)
    }
  })
}

/**
 * (а) Кандидати на розширення — ЛИШЕ дериваційний список (без IO), кожен
 * запис несе усе потрібне для {@link materializeWidenProposals}.
 * @param {object} params вхідні параметри
 * @param {object[]} params.mandates нормалізовані мандати
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {object[]} params.deviceRegistry записи реєстру пристроїв
 * @param {Set<string>} params.killSwitchActiveHandles person-owner з активним kill-switch (`kill-switch.js`)
 * @param {Date} params.periodStart початок вікна
 * @param {Date} params.periodEnd кінець вікна
 * @param {number} [params.widenThreshold] поріг «N+ рішень без override» (дефолт 5)
 * @returns {{modelHandle: string, delegatorHandle: string|null, decisionsInPeriod: number, overrideFreeInPeriod: number}[]}
 *   кандидати на розширення, найактивніші перші
 */
export function draftWidenCandidates({ mandates, decisionsDirs, deviceRegistry, killSwitchActiveHandles, periodStart, periodEnd, widenThreshold = DEFAULT_WIDEN_THRESHOLD }) {
  const activity = modelActivityInPeriod({ mandates, decisionsDirs, deviceRegistry, periodStart, periodEnd })
  const candidates = []
  for (const { model, inPeriod, overrideFreeInPeriod } of activity) {
    if (model.escalatesTo && killSwitchActiveHandles?.has(model.escalatesTo)) continue
    if (overrideFreeInPeriod.length < widenThreshold) continue
    candidates.push({
      modelHandle: model.owner,
      delegatorHandle: model.escalatesTo,
      decisionsInPeriod: inPeriod.length,
      overrideFreeInPeriod: overrideFreeInPeriod.length
    })
  }
  return candidates.toSorted((a, b) => b.overrideFreeInPeriod - a.overrideFreeInPeriod)
}

/**
 * (б) Кандидати на звуження — override-и за період АБО активний kill-switch
 * делегатора (снепшот «зараз»). Інформаційний список, дій не виконує.
 * @param {object} params вхідні параметри
 * @param {object[]} params.mandates нормалізовані мандати
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {object[]} params.deviceRegistry записи реєстру пристроїв
 * @param {Set<string>} params.killSwitchActiveHandles person-owner з активним kill-switch
 * @param {Date} params.periodStart початок вікна
 * @param {Date} params.periodEnd кінець вікна
 * @returns {{modelHandle: string, delegatorHandle: string|null, overriddenInPeriod: number, delegatorKillSwitchActive: boolean}[]}
 *   кандидати на звуження, найбільше override-ів перші
 */
export function narrowCandidates({ mandates, decisionsDirs, deviceRegistry, killSwitchActiveHandles, periodStart, periodEnd }) {
  const activity = modelActivityInPeriod({ mandates, decisionsDirs, deviceRegistry, periodStart, periodEnd })
  const candidates = []
  for (const { model, overriddenInPeriod } of activity) {
    const delegatorKillSwitchActive = Boolean(model.escalatesTo && killSwitchActiveHandles?.has(model.escalatesTo))
    if (overriddenInPeriod.length === 0 && !delegatorKillSwitchActive) continue
    candidates.push({
      modelHandle: model.owner,
      delegatorHandle: model.escalatesTo,
      overriddenInPeriod: overriddenInPeriod.length,
      delegatorKillSwitchActive
    })
  }
  return candidates.toSorted((a, b) => b.overriddenInPeriod - a.overriddenInPeriod)
}

/**
 * (в) Відкриті розбіжності кворумів і застарілі розвилки — по УСІХ
 * decision-request-ах воркспейсу (організаційна прозорість, на відміну
 * від `drift.js`, приватного дзеркала одному власнику).
 * @param {object} params вхідні параметри
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {Date} params.now поточний час (для «застаріле»)
 * @param {number} [params.staleDays] поріг «застаріле» в днях (дефолт 7)
 * @returns {{diverged: {runId: string|null, nnnn: string, decisionType: string, signed: object[]}[],
 *   stale: {runId: string|null, nnnn: string, decisionType: string, computedOwner: string|null, ageDays: number}[]}}
 *   відкриті розбіжності + застарілі розвилки
 */
export function openDisputes({ decisionsDirs, now, staleDays = DEFAULT_STALE_DAYS }) {
  const diverged = []
  const stale = []
  for (const { dir, files } of decisionsDirs ?? []) {
    const filesByName = new Map(files.map(f => [f.name, f.content]))
    for (const file of files) {
      const match = DECISION_REQUEST_RE.exec(file.name)
      if (!match) continue
      const nnnn = match[1]
      const runId = dir.split('/').filter(Boolean).at(-2) ?? null
      const parsed = parseDecisionRequest(file.content, { path: `${dir}/${file.name}`, runId, nnnn })
      const decisionType = parsed.decisionType ?? 'general'

      if (requiresQuorum(parsed.leverageFacets)) {
        const quorum = deriveQuorumStatus(parsed, filesByName)
        if (quorum.status === 'diverged') diverged.push({ runId, nnnn, decisionType, signed: quorum.signed })
        continue // кворумні — власна механіка прогресу, «застаріле» тут не рахуємо (той самий інваріант, що drift.js)
      }

      if (filesByName.has(`${nnnn}-approval.json`) || !parsed.openedAt) continue
      const ageDays = (now.getTime() - Date.parse(parsed.openedAt)) / DAY_MS
      if (Number.isNaN(ageDays) || ageDays < staleDays) continue
      stale.push({ runId, nnnn, decisionType, computedOwner: parsed.computedOwner, ageDays: Math.round(ageDays) })
    }
  }
  return {
    diverged,
    stale: stale.toSorted((a, b) => b.ageDays - a.ageDays)
  }
}

/**
 * Матеріалізує draft change-proposal для КОЖНОГО widen-кандидата — один
 * виклик `ai-petition.js: aiPetition` на кандидата (буквально задача M6,
 * п.4: «ai_petition-патерну від імені аналізатора» — `initiatedBy` тут
 * `review-agenda`, не `ai-petition-{handle}`, щоб рев'ю-згенеровані
 * чернетки лишались відрізнюваними в аудиті від прямої ШІ-петиції моделі).
 * Ідемпотентно за конструкцією `changeId` (`review-{generation}-{model}`)
 * — повторний прогін рев'ю в межах того самого `generation` mandates.yaml
 * лише освіжає ту саму чернетку, не плодить дублікати.
 * @param {object} params вхідні параметри
 * @param {{writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {{generation: number, mandates: object[]}} params.mandatesFile поточний стан `.mt/mandates.yaml`
 * @param {{modelHandle: string, delegatorHandle: string|null, decisionsInPeriod: number, overrideFreeInPeriod: number}[]}
 *   params.candidates вихід {@link draftWidenCandidates}
 * @param {(handle: string) => Promise<{privateKeyJwk: object, publicKeyBase64: string}>} params.loadModelDeviceKey
 *   транспорт-специфічне завантаження (чи генерація) ключа моделі
 * @param {(device: {handle: string, role: 'model', pubkeyBase64: string}) => Promise<void>} [params.registerDevice]
 *   транспорт-специфічна реєстрація pubkey у `device-registry.json` (опційно — тести можуть пропустити)
 * @param {(params: object) => object} [params.trackRecordFor] override для трек-рекорду одного кандидата (тести)
 * @param {{dir: string, files: {name: string, content: string}[]}[]} [params.decisionsDirs] скановані `decisions/`-директорії (evidence)
 * @param {object[]} [params.deviceRegistry] записи реєстру пристроїв (evidence)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{modelHandle: string, delegatorHandle: string|null, changeId: string, decisionRequestPath: string}[]>}
 *   матеріалізовані change-proposal-и, готові до звичайного decision_quiz/decision_approve
 */
export async function materializeWidenProposals({
  io,
  mandatesDir,
  mandatesFile,
  candidates,
  loadModelDeviceKey,
  registerDevice,
  decisionsDirs,
  deviceRegistry,
  now
}) {
  const created = []
  for (const candidate of candidates) {
    if (!candidate.delegatorHandle) continue
    const mandate = mandatesFile.mandates.find(m => m.owner === candidate.modelHandle)
    if (!mandate) continue
    const newFile = {
      generation: mandatesFile.generation + 1,
      mandates: mandatesFile.mandates.map(m => (m.owner === candidate.modelHandle ? widenMandateOneStep(m) : m))
    }
    const modelDeviceKey = await loadModelDeviceKey(candidate.modelHandle)
    if (registerDevice) {
      await registerDevice({ handle: candidate.modelHandle, role: 'model', pubkeyBase64: modelDeviceKey.publicKeyBase64 })
    }
    const trackRecord = deriveTrackRecord({ decisionsDirs, deviceRegistry, handle: candidate.modelHandle })
    const changeId = `review-${mandatesFile.generation}-${candidate.modelHandle}`
    const result = await aiPetition({
      io,
      mandatesDir,
      changeId,
      old: mandatesFile,
      new: newFile,
      modelHandle: candidate.modelHandle,
      delegatorHandle: candidate.delegatorHandle,
      trackRecord,
      modelDeviceKey,
      now
    })
    created.push({ modelHandle: candidate.modelHandle, delegatorHandle: candidate.delegatorHandle, changeId, decisionRequestPath: result.decisionRequestPath })
  }
  return created
}

/**
 * Рендерить порядок денний у ДЕТЕРМІНОВАНИЙ markdown — жодного LLM.
 * @param {object} params вхідні параметри
 * @param {Date} params.periodStart початок вікна
 * @param {Date} params.periodEnd кінець вікна
 * @param {object[]} params.widenCandidates вихід {@link draftWidenCandidates}
 * @param {object[]} params.materialized вихід {@link materializeWidenProposals} (порожньо — dry-run/без IO)
 * @param {object[]} params.narrowCandidates вихід {@link narrowCandidates}
 * @param {{diverged: object[], stale: object[]}} params.disputes вихід {@link openDisputes}
 * @returns {string} markdown-текст порядку денного
 */
export function formatReviewAgendaMarkdown({ periodStart, periodEnd, widenCandidates, materialized, narrowCandidates: narrow, disputes }) {
  const title = `# Дельта-рев’ю: порядок денний — ${periodStart.slice(0, 10)} — ${periodEnd.slice(0, 10)}`
  const subtitle = '30 хв, єдина синхронна церемонія (README, «Ритуал дельта-рев’ю»).'
  const lines = [title, '', subtitle, '']

  lines.push('## Draft-пропозиції розширення', '')
  if (widenCandidates.length === 0) {
    lines.push('Жодна модель не набрала порогу без-override рішень за період.', '')
  } else {
    for (const c of widenCandidates) {
      const draft = materialized.find(m => m.modelHandle === c.modelHandle)
      const draftNote = draft ? ` — чернетка готова: \`${draft.changeId}\` (\`${draft.decisionRequestPath}\`)` : ''
      lines.push(`- **${c.modelHandle}** → делегатор \`${c.delegatorHandle}\`: ${c.overrideFreeInPeriod}/${c.decisionsInPeriod} без override за період${draftNote}`)
    }
    lines.push('')
  }

  lines.push('## Кандидати на звуження', '')
  if (narrow.length === 0) {
    lines.push('Жодного кандидата — override-ів немає, kill-switch не активний.', '')
  } else {
    for (const c of narrow) {
      const reasons = []
      if (c.overriddenInPeriod > 0) reasons.push(`${c.overriddenInPeriod} override(-и/ів) за період`)
      if (c.delegatorKillSwitchActive) reasons.push(`делегатор \`${c.delegatorHandle}\` — активний kill-switch`)
      lines.push(`- **${c.modelHandle}** → делегатор \`${c.delegatorHandle}\`: ${reasons.join('; ')}`)
    }
    lines.push('')
  }

  lines.push('## Відкриті розбіжності й застарілі розвилки', '')
  if (disputes.diverged.length === 0) {
    lines.push('Розбіжностей кворуму немає.', '')
  } else {
    lines.push('Розбіжності кворуму (усі підписали, chosen_option розійшовся):', '')
    for (const d of disputes.diverged) lines.push(`- ${d.runId}/${d.nnnn} (${d.decisionType}): ${d.signed.map(s => `${s.handle}→${s.chosenOption}`).join(', ')}`)
    lines.push('')
  }
  if (disputes.stale.length === 0) {
    lines.push('Застарілих розвилок немає.', '')
  } else {
    lines.push('Застарілі розвилки (відкриті, старші за поріг):', '')
    for (const s of disputes.stale) lines.push(`- ${s.runId}/${s.nnnn} (${s.decisionType}), власник \`${s.computedOwner}\`, ${s.ageDays} дн.`)
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} periodEndIso ISO-час кінця вікна (дата у назві файлу)
 * @returns {string} абсолютний шлях до `.mt/reviews/YYYY-MM-DD-agenda.md`
 */
export function reviewAgendaPath(mandatesDir, periodEndIso) {
  return `${mandatesDir}/.mt/reviews/${periodEndIso.slice(0, 10)}-agenda.md`
}

/**
 * Повний потік `review_agenda`: деривує три секції, МАТЕРІАЛІЗУЄ
 * draft-widen change-proposal-и ({@link materializeWidenProposals}),
 * рендерить і пише markdown — спільна точка входу для CLI/GUI tool.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {{generation: number, mandates: object[]}} params.mandatesFile поточний стан `.mt/mandates.yaml`
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {object[]} params.deviceRegistry записи реєстру пристроїв
 * @param {Set<string>} params.killSwitchActiveHandles person-owner з активним kill-switch (`kill-switch.js`)
 * @param {(handle: string) => Promise<{privateKeyJwk: object, publicKeyBase64: string}>} params.loadModelDeviceKey
 *   транспорт-специфічне завантаження ключа моделі (для draft-петицій)
 * @param {(device: object) => Promise<void>} [params.registerDevice] транспорт-специфічна реєстрація pubkey
 * @param {number} [params.periodDays] розмір вікна в днях (дефолт 7)
 * @param {object} [params.config] override порогів ({@link defaultReviewConfig})
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} `{widenCandidates, materialized, narrowCandidates, disputes, markdown, path}`
 */
export async function reviewAgenda({
  io,
  mandatesDir,
  mandatesFile,
  decisionsDirs,
  deviceRegistry,
  killSwitchActiveHandles,
  loadModelDeviceKey,
  registerDevice,
  periodDays = 7,
  config,
  now
}) {
  const resolvedConfig = { ...defaultReviewConfig(), ...config }
  const nowDate = now ? now() : new Date()
  const periodEnd = nowDate
  const periodStart = new Date(nowDate.getTime() - periodDays * DAY_MS)
  const mandates = mandatesFile.mandates

  const widenCandidates = draftWidenCandidates({
    mandates,
    decisionsDirs,
    deviceRegistry,
    killSwitchActiveHandles,
    periodStart,
    periodEnd,
    widenThreshold: resolvedConfig.widenThreshold
  })
  const narrow = narrowCandidates({ mandates, decisionsDirs, deviceRegistry, killSwitchActiveHandles, periodStart, periodEnd })
  const disputes = openDisputes({ decisionsDirs, now: nowDate, staleDays: resolvedConfig.staleDays })

  const materialized = await materializeWidenProposals({
    io,
    mandatesDir,
    mandatesFile,
    candidates: widenCandidates,
    loadModelDeviceKey,
    registerDevice,
    decisionsDirs,
    deviceRegistry,
    now
  })

  const markdown = formatReviewAgendaMarkdown({
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    widenCandidates,
    materialized,
    narrowCandidates: narrow,
    disputes
  })
  const path = reviewAgendaPath(mandatesDir, periodEnd.toISOString())
  await io.writeFile(path, markdown)

  return { widenCandidates, materialized, narrowCandidates: narrow, disputes, markdown, path }
}
