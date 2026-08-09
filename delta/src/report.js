// Дельта-звіт (M6, docs/specs/260809-delta-app.md, «Обсяг M6», п.2;
// конституція п.4: «Щотижневий дельта-звіт директору: як посунулась межа
// (класи рішень до/від ШІ), вартість ШІ-рішень поруч зі звільненою
// людською увагою (ROI без аналітика)»; «Метрики пілота» п.1-4). Той самий
// дериваційний JS-шар, що решта tool-поверхні (`decisions.js`/`drift.js`/
// `watcher.js`) — ЖОДНОГО LLM: звіт мусить бути ВІДТВОРЮВАНИМ byte-у-byte
// для того самого знімка файлової системи (задача M6, п.2: «детермінований
// шаблон, без LLM»).
//
// **Чотири секції — буквально задача M6, п.2:**
//  (а) **рух межі** — застосовані mandate-change за період, скановано
//      `runs/mandate-change-*/decisions/0001-applied.json` (маркер, який
//      тепер пише `change-proposal.js: applyMandateChangeProposal` ПІСЛЯ
//      Valid-вердикту `validate_mandate_change` — сам факт мутації
//      `.mt/mandates.yaml` не несе часової мітки застосування, маркер несе);
//      клас зміни — {@link import('./mandate-change.js').classifyMandateChange}
//      над `0001-change.json` `{old, new}`.
//  (б) **рішення за період** — закриті decision-request-и (є підписаний
//      approval), класифіковані людський/модельний/кворумний за ЕФЕКТИВНИМ
//      власником (`delegated_to`, якщо є `NNNN-delegation.json`, інакше
//      `computed_owner`) звіреним проти `kind` мандата в `mandates.yaml`.
//  (в) **ціна гейта** — Σ `time_to_understanding_sec` (людських/кворумних
//      підписів, зі своїх `NNNN-quiz.md`/`NNNN-quiz-{handle}.md`) ×
//      `hourly_rate_eur` (`org.js`, дефолт 60 €/год) + кількість (НЕ сума
//      грошей — `deadline_cost` текстове поле, парсинг суми не вигадуємо)
//      ВІДКРИТИХ розвилок з непорожнім `deadline_cost` (поточний знімок).
//  (г) **глибина делегування** — кількість `decision_types` із
//      model-власником у `mandates.yaml` + кількість `NNNN-delegation.json`
//      підписаних за період.
//  (д) **агреговано без приватного** — кількість доставлених кандор-заяв
//      (`.mt/candor/{handle}.jsonl` кожного person-owner, лише count) і
//      кількість активацій kill-switch (`kill-switch.js` лог, лише count)
//      — БЕЗ вмісту приватних дрейф-карток (`drift.json`) і бази знань
//      (`knowledge.json`), які цей модуль НІКОЛИ не читає (профспілковий
//      принцип, конституція п.9: моя приватність лишається моєю).

import { describeMandateDiffLines } from './change-proposal.js'
import { deriveQuorumStatus, parseDecisionRequest, requiresQuorum } from './decisions.js'
import { killSwitchLogPath } from './kill-switch.js'
import { classifyMandateChange } from './mandate-change.js'
import { modelMandates } from './mandates.js'
import { loadOrgConfig } from './org.js'

const DAY_MS = 24 * 60 * 60 * 1000
const DECISION_REQUEST_RE = /^(\d{4})-decision-request\.md$/
const DELEGATION_FILE_RE = /^(\d{4})-delegation\.json$/
const TIME_FIELD_RE = /^time_to_understanding_sec: ([\d.]+)$/m

/**
 * @param {string} dir абсолютний шлях до `decisions/`-директорії
 * @returns {string|null} run-id (передостанній сегмент шляху), або null
 */
function runIdOf(dir) {
  return dir.split('/').filter(Boolean).at(-2) ?? null
}

/**
 * @param {string|null} runId run-id
 * @returns {boolean} true — run change-proposal (`mandate-change-{changeId}`)
 */
function isMandateChangeRun(runId) {
  return typeof runId === 'string' && runId.startsWith('mandate-change-')
}

/**
 * @param {{mandates: object[]}} old старий файл мандатів
 * @param {{mandates: object[]}} newFile новий файл мандатів
 * @returns {string[]} унікальні owner з обох знімків, відсортовані
 */
function allFileOwners(old, newFile) {
  return [...new Set([...old.mandates.map(m => m.owner), ...newFile.mandates.map(m => m.owner)])].toSorted()
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
 * Витягує `time_to_understanding_sec` СИРИМ regex над фронтматером квіз-
 * файлу — той самий підхід, що `drift.js: quizIterations`: звіт навмисно не
 * залежить від того, Q&A це (`quiz.js: parseQuizFile`) чи teach-back
 * (`parseTeachBackFile`) формат, лише від поля, спільного для ОБОХ.
 * @param {string|undefined} quizText сирий вміст квіз-файлу, якщо є
 * @returns {number|null} час до розуміння в секундах, або null
 */
function quizTimeToUnderstandingSec(quizText) {
  if (!quizText) return null
  const match = TIME_FIELD_RE.exec(quizText)
  return match ? Number(match[1]) : null
}

/**
 * @param {object[]} mandates нормалізовані мандати (`mandates.js`/`mandate-change.js` camelCase форма)
 * @param {string|null} owner handle владника
 * @returns {'person'|'model'} `kind` владника (не знайдено в карті → `'person'`, консервативний дефолт)
 */
function ownerKind(mandates, owner) {
  return mandates.find(m => m.owner === owner)?.kind ?? 'person'
}

/**
 * (а) «Рух межі» — застосовані mandate-change за період, зі знайденого
 * маркера `0001-applied.json` (`change-proposal.js`).
 * @param {object} params вхідні параметри
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {Date} params.periodStart початок вікна
 * @param {Date} params.periodEnd кінець вікна
 * @returns {{runId: string, changeId: string, owner: string, kind: string, diffLines: string[],
 *   delegatorHandle: string|null, appliedAt: string}[]} рухи межі, хронологічно
 */
export function deriveBoundaryMoves({ decisionsDirs, periodStart, periodEnd }) {
  const moves = []
  for (const { dir, files } of decisionsDirs ?? []) {
    const runId = runIdOf(dir)
    if (!isMandateChangeRun(runId)) continue
    const filesByName = new Map(files.map(f => [f.name, f.content]))
    const appliedText = filesByName.get('0001-applied.json')
    const changeText = filesByName.get('0001-change.json')
    if (!appliedText || !changeText) continue

    let applied
    let change
    try {
      applied = JSON.parse(appliedText)
      change = JSON.parse(changeText)
    } catch {
      continue // битий маркер/change.json — не рахуємо, не валимо весь звіт
    }
    if (!withinPeriod(applied.appliedAt, periodStart, periodEnd)) continue

    const { old, new: newFile } = change
    for (const owner of allFileOwners(old, newFile)) {
      const oldMandate = old.mandates.find(m => m.owner === owner) ?? null
      const newMandate = newFile.mandates.find(m => m.owner === owner) ?? null
      const kind = classifyMandateChange(oldMandate, newMandate)
      if (kind === 'unchanged') continue
      moves.push({
        runId,
        changeId: runId.slice('mandate-change-'.length),
        owner,
        kind,
        diffLines: oldMandate && newMandate ? describeMandateDiffLines(oldMandate, newMandate) : [],
        delegatorHandle: applied.handle ?? null,
        appliedAt: applied.appliedAt
      })
    }
  }
  return moves.toSorted((a, b) => Date.parse(a.appliedAt) - Date.parse(b.appliedAt))
}

/**
 * (б) Рішення, закриті за період — людські/модельні/кворумні, з квіз-часом
 * для метрики «ціна гейта».
 * @param {object} params вхідні параметри
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {object[]} params.mandates нормалізовані мандати (для класифікації людський/модельний)
 * @param {Date} params.periodStart початок вікна
 * @param {Date} params.periodEnd кінець вікна
 * @returns {{runId: string|null, nnnn: string, decisionType: string, classification: 'human'|'model'|'quorum',
 *   chosenOption: string|null, closedAt: string, quizTimeToUnderstandingSec: number}[]} закриті рішення періоду
 */
export function deriveDecisionsSummary({ decisionsDirs, mandates, periodStart, periodEnd }) {
  const closed = []
  for (const { dir, files } of decisionsDirs ?? []) {
    const filesByName = new Map(files.map(f => [f.name, f.content]))
    for (const file of files) {
      const match = DECISION_REQUEST_RE.exec(file.name)
      if (!match) continue
      const nnnn = match[1]
      const runId = runIdOf(dir)
      const parsed = parseDecisionRequest(file.content, { path: `${dir}/${file.name}`, runId, nnnn })
      const resolved = requiresQuorum(parsed.leverageFacets)
        ? closedQuorumDecision(parsed, filesByName, nnnn)
        : closedSoloDecision(parsed, filesByName, nnnn, mandates)
      if (!resolved || !withinPeriod(resolved.closedAt, periodStart, periodEnd)) continue
      closed.push({ runId, nnnn, decisionType: parsed.decisionType ?? 'general', ...resolved })
    }
  }
  return closed
}

/**
 * @param {object} parsed розібраний decision-request
 * @param {Map<string, string>} filesByName карта імʼя файлу → вміст decisions-директорії
 * @param {string} nnnn чотиризначний номер
 * @returns {object|null} `{classification, chosenOption, closedAt, quizTimeToUnderstandingSec}`, або null — не закрито
 */
function closedQuorumDecision(parsed, filesByName, nnnn) {
  const quorum = deriveQuorumStatus(parsed, filesByName)
  if (quorum.status !== 'closed') return null
  const closedAt = quorum.signed.reduce((max, s) => (s.signedAt && (!max || s.signedAt > max) ? s.signedAt : max), null)
  const timeSec = quorum.signed.reduce((sum, s) => sum + (quizTimeToUnderstandingSec(filesByName.get(`${nnnn}-quiz-${s.handle}.md`)) ?? 0), 0)
  return { classification: 'quorum', chosenOption: quorum.signed[0]?.chosenOption ?? null, closedAt, quizTimeToUnderstandingSec: timeSec }
}

/**
 * @param {object} parsed розібраний decision-request
 * @param {Map<string, string>} filesByName карта імʼя файлу → вміст decisions-директорії
 * @param {string} nnnn чотиризначний номер
 * @param {object[]} mandates нормалізовані мандати
 * @returns {object|null} `{classification, chosenOption, closedAt, quizTimeToUnderstandingSec}`, або null — не закрито
 */
function closedSoloDecision(parsed, filesByName, nnnn, mandates) {
  const approvalText = filesByName.get(`${nnnn}-approval.json`)
  if (!approvalText) return null
  let approval
  try {
    approval = JSON.parse(approvalText)
  } catch {
    return null
  }
  let effectiveOwner = parsed.computedOwner
  const delegationText = filesByName.get(`${nnnn}-delegation.json`)
  if (delegationText) {
    try {
      effectiveOwner = JSON.parse(delegationText).delegated_to ?? effectiveOwner
    } catch {
      // битий delegation.json — лишаємо computed_owner
    }
  }
  const classification = ownerKind(mandates, effectiveOwner) === 'model' ? 'model' : 'human'
  const timeSec = quizTimeToUnderstandingSec(filesByName.get(`${nnnn}-quiz.md`)) ?? 0
  return { classification, chosenOption: approval.chosen_option ?? null, closedAt: approval.signed_at ?? null, quizTimeToUnderstandingSec: timeSec }
}

/**
 * Агрегує закриті рішення по класифікації і по `decision_type`.
 * @param {object[]} closed вихід {@link deriveDecisionsSummary}
 * @returns {{total: number, byClassification: {human: number, model: number, quorum: number},
 *   byType: {decisionType: string, human: number, model: number, quorum: number, total: number}[]}} зведення
 */
export function summarizeDecisions(closed) {
  const byClassification = { human: 0, model: 0, quorum: 0 }
  const byType = new Map()
  for (const d of closed) {
    byClassification[d.classification] += 1
    if (!byType.has(d.decisionType)) byType.set(d.decisionType, { decisionType: d.decisionType, human: 0, model: 0, quorum: 0, total: 0 })
    const bucket = byType.get(d.decisionType)
    bucket[d.classification] += 1
    bucket.total += 1
  }
  return { total: closed.length, byClassification, byType: Array.from(byType.values()).toSorted((a, b) => b.total - a.total) }
}

/**
 * (в) «Ціна гейта» — Σ `time_to_understanding_sec` людських/кворумних
 * підписів (модельні НЕ рахуються — людська увага не витрачалась) × ставка.
 * @param {object[]} closed вихід {@link deriveDecisionsSummary}
 * @param {number} hourlyRateEur ставка вартості людської години (`org.js`)
 * @returns {number} вартість у EUR, округлена до центів
 */
export function gateCostEur(closed, hourlyRateEur) {
  const totalSeconds = closed
    .filter(d => d.classification === 'human' || d.classification === 'quorum')
    .reduce((sum, d) => sum + (d.quizTimeToUnderstandingSec ?? 0), 0)
  return Math.round((totalSeconds / 3600) * hourlyRateEur * 100) / 100
}

/**
 * Кількість ВІДКРИТИХ розвилок з непорожнім `deadline_cost` — поточний
 * знімок (НЕ період: «заблоковано зараз», не «заблокувалось цього тижня»).
 * Рахуємо КІЛЬКІСТЬ, не парсимо суму з текстового поля (задача M6, п.2 —
 * «не вигадуй парсинг грошей»).
 * @param {object} params вхідні параметри
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @returns {number} кількість заблокованих розвилок з deadline_cost
 */
export function countBlockedWithDeadlineCost({ decisionsDirs }) {
  let count = 0
  for (const { files } of decisionsDirs ?? []) {
    const filesByName = new Map(files.map(f => [f.name, f.content]))
    for (const file of files) {
      const match = DECISION_REQUEST_RE.exec(file.name)
      if (!match) continue
      const nnnn = match[1]
      const parsed = parseDecisionRequest(file.content, { nnnn })
      if (!parsed.deadlineCost) continue
      if (requiresQuorum(parsed.leverageFacets)) {
        if (deriveQuorumStatus(parsed, filesByName).status === 'closed') continue
      } else if (filesByName.has(`${nnnn}-approval.json`)) {
        continue
      }
      count += 1
    }
  }
  return count
}

/**
 * (г) «Глибина делегування» — класи рішень із model-власником у карті +
 * делегування підписані за період.
 * @param {object} params вхідні параметри
 * @param {object[]} params.mandates нормалізовані мандати
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {Date} params.periodStart початок вікна
 * @param {Date} params.periodEnd кінець вікна
 * @returns {{modelOwnedDecisionTypes: number, delegationsInPeriod: number}} метрика глибини делегування
 */
export function delegationDepth({ mandates, decisionsDirs, periodStart, periodEnd }) {
  const modelDecisionTypes = new Set()
  for (const model of modelMandates(mandates)) {
    for (const type of model.scope.decisionTypes) modelDecisionTypes.add(type)
  }

  let delegationsInPeriod = 0
  for (const { files } of decisionsDirs ?? []) {
    for (const file of files) {
      if (!DELEGATION_FILE_RE.test(file.name)) continue
      let record
      try {
        record = JSON.parse(file.content)
      } catch {
        continue
      }
      if (withinPeriod(record.signed_at, periodStart, periodEnd)) delegationsInPeriod += 1
    }
  }
  return { modelOwnedDecisionTypes: modelDecisionTypes.size, delegationsInPeriod }
}

/**
 * (д) Кандор-заяв доставлено за період — АГРЕГОВАНА кількість по УСІХ
 * person-owner (перевіряє `.mt/candor/{handle}.jsonl` кожного, лише
 * рахує) — НІКОЛИ не повертає сам `statement`/`evidence_refs`.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {object[]} params.mandates нормалізовані мандати (перелік person-owner — адресатів кандору)
 * @param {Date} params.periodStart початок вікна
 * @param {Date} params.periodEnd кінець вікна
 * @returns {Promise<number>} кількість доставлених кандор-заяв за період
 */
export async function candorDeliveredCount({ io, mandatesDir, mandates, periodStart, periodEnd }) {
  const recipients = [...new Set(mandates.filter(m => m.kind !== 'model').map(m => m.owner))]
  let count = 0
  for (const handle of recipients) {
    const text = await io.readFile(`${mandatesDir}/.mt/candor/${handle}.jsonl`)
    if (!text) continue
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let record
      try {
        record = JSON.parse(trimmed)
      } catch {
        continue
      }
      if (withinPeriod(record.created_at, periodStart, periodEnd)) count += 1
    }
  }
  return count
}

/**
 * (д) Активацій kill-switch за період — АГРЕГОВАНА кількість з логу
 * `kill-switch.js`, лише `action: 'on'` (рахуємо АКТИВАЦІЇ, не деактивації).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {Date} params.periodStart початок вікна
 * @param {Date} params.periodEnd кінець вікна
 * @returns {Promise<number>} кількість активацій за період
 */
export async function killSwitchActivationsCount({ io, mandatesDir, periodStart, periodEnd }) {
  const text = await io.readFile(killSwitchLogPath(mandatesDir))
  if (!text) return 0
  let count = 0
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let record
    try {
      record = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (record.action === 'on' && withinPeriod(record.at, periodStart, periodEnd)) count += 1
  }
  return count
}

/**
 * @param {'added'|'removed'|'kind-changed'|'escalates-to-changed'|'widened'|'narrowed'} kind вид зміни ({@link import('./mandate-change.js').classifyMandateChange})
 * @returns {string} людиночитабельна мітка українською
 */
function moveLabel(kind) {
  const labels = {
    added: 'додано мандат',
    removed: 'видалено мандат',
    'kind-changed': 'змінено kind',
    'escalates-to-changed': 'змінено делегатора',
    widened: 'розширено',
    narrowed: 'звужено'
  }
  return labels[kind] ?? kind
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} periodEndIso ISO-час кінця вікна звіту (дата у назві файлу)
 * @returns {string} абсолютний шлях до `.mt/reports/YYYY-MM-DD-delta.md`
 */
export function reportPath(mandatesDir, periodEndIso) {
  return `${mandatesDir}/.mt/reports/${periodEndIso.slice(0, 10)}-delta.md`
}

/**
 * Деривує повну модель дельта-звіту (без рендеру в markdown) — окрема
 * функція з {@link formatDeltaReportMarkdown}, той самий рефактор-намір, що
 * решта модулів (`drift.js: detectDrift` окремо від персисту).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {{generation: number, mandates: object[]}} params.mandatesFile розібраний `.mt/mandates.yaml`
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {number} [params.periodDays] розмір вікна звіту в днях (дефолт 7)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} повна модель звіту
 */
export async function buildDeltaReport({ io, mandatesDir, mandatesFile, decisionsDirs, periodDays = 7, now }) {
  const periodEnd = now ? now() : new Date()
  const periodStart = new Date(periodEnd.getTime() - periodDays * DAY_MS)
  const mandates = mandatesFile.mandates

  const boundaryMoves = deriveBoundaryMoves({ decisionsDirs, periodStart, periodEnd })
  const closedDecisions = deriveDecisionsSummary({ decisionsDirs, mandates, periodStart, periodEnd })
  const decisions = summarizeDecisions(closedDecisions)
  const orgConfig = await loadOrgConfig(io, mandatesDir)
  const gateCost = gateCostEur(closedDecisions, orgConfig.hourlyRateEur)
  const blockedWithDeadlineCost = countBlockedWithDeadlineCost({ decisionsDirs })
  const delegation = delegationDepth({ mandates, decisionsDirs, periodStart, periodEnd })
  const candorDelivered = await candorDeliveredCount({ io, mandatesDir, mandates, periodStart, periodEnd })
  const killSwitchActivations = await killSwitchActivationsCount({ io, mandatesDir, periodStart, periodEnd })

  return {
    periodDays,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    boundaryMoves,
    decisions,
    gateCostEur: gateCost,
    hourlyRateEur: orgConfig.hourlyRateEur,
    blockedWithDeadlineCost,
    delegationDepth: delegation,
    candorDelivered,
    killSwitchActivations
  }
}

/**
 * Рендерить повну модель звіту ({@link buildDeltaReport}) у ДЕТЕРМІНОВАНИЙ
 * markdown — жодного LLM, той самий вхід завжди дає ТОЙ САМИЙ текст.
 * @param {object} report модель звіту ({@link buildDeltaReport})
 * @returns {string} markdown-текст звіту
 */
export function formatDeltaReportMarkdown(report) {
  const lines = [`# Дельта-звіт: ${report.periodStart.slice(0, 10)} — ${report.periodEnd.slice(0, 10)}`, '']

  lines.push('## Рух межі', '')
  if (report.boundaryMoves.length === 0) {
    lines.push('Жодного застосованого mandate-change за період.', '')
  } else {
    for (const move of report.boundaryMoves) {
      lines.push(`- **${move.owner}** — ${moveLabel(move.kind)} (підписав делегатор \`${move.delegatorHandle}\`, ${move.appliedAt})`)
      for (const diffLine of move.diffLines) lines.push(`  - ${diffLine}`)
    }
    lines.push('')
  }

  lines.push('## Рішення за період', '')
  lines.push(
    `Усього закрито: **${report.decisions.total}** (людських: ${report.decisions.byClassification.human}, ` +
      `модельних: ${report.decisions.byClassification.model}, кворумних: ${report.decisions.byClassification.quorum}).`,
    ''
  )
  if (report.decisions.byType.length > 0) {
    lines.push('| Клас рішень | людських | модельних | кворумних | усього |', '| --- | --- | --- | --- | --- |')
    for (const t of report.decisions.byType) lines.push(`| ${t.decisionType} | ${t.human} | ${t.model} | ${t.quorum} | ${t.total} |`)
    lines.push('')
  }

  lines.push('## Ціна гейта', '')
  lines.push(`Σ час до розуміння × ставка (${report.hourlyRateEur} €/год): **${report.gateCostEur} €**.`)
  lines.push(`Заблокованих розвилок з непорожнім deadline_cost (поточний знімок): **${report.blockedWithDeadlineCost}**.`, '')

  lines.push('## Глибина делегування', '')
  lines.push(`Класів рішень із model-власником у mandates.yaml: **${report.delegationDepth.modelOwnedDecisionTypes}**.`)
  lines.push(`Делегувань одним квізом за період: **${report.delegationDepth.delegationsInPeriod}**.`, '')

  lines.push('## Агреговано (без приватного)', '')
  lines.push(`Кандор-заяв доставлено: **${report.candorDelivered}**.`)
  lines.push(`Активацій kill-switch: **${report.killSwitchActivations}**.`, '')

  return `${lines.join('\n')}\n`
}

/**
 * Повний потік `delta_report`: деривує звіт, рендерить markdown і пише
 * `.mt/reports/YYYY-MM-DD-delta.md` — спільна точка входу для CLI/GUI tool.
 * @param {object} params вхідні параметри (той самий набір, що {@link buildDeltaReport})
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {{generation: number, mandates: object[]}} params.mandatesFile розібраний `.mt/mandates.yaml`
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {number} [params.periodDays] розмір вікна звіту в днях (дефолт 7)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} модель звіту + `markdown` + `path`
 */
export async function deltaReport({ io, mandatesDir, mandatesFile, decisionsDirs, periodDays = 7, now }) {
  const report = await buildDeltaReport({ io, mandatesDir, mandatesFile, decisionsDirs, periodDays, now })
  const markdown = formatDeltaReportMarkdown(report)
  const path = reportPath(mandatesDir, report.periodEnd)
  await io.writeFile(path, markdown)
  return { ...report, markdown, path }
}
