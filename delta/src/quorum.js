// Мультипартійний підпис (кворум) для irreversible-рішень — M4 (docs/specs/
// 260809-delta-app.md, «Обсяг M4», п.2; конституція п.8: «Мультипартійний
// підпис для незворотного: картка показує кворум і чиї квізи пройдені»).
//
// Одноосібні (не-irreversible) рішення й далі йдуть через `decision-flow.js`
// — `requiresQuorum` (decisions.js) маршрутизує лише за `irreversible: true`,
// не за глибиною: `decision-flow.js` МОЖЕ так само дійти до `teach-back`
// (широкий `blast_radius` без `irreversible`), обидва модулі спільно
// використовують один Q&A-незалежний механізм teach-back (`quiz.js`), кожен
// зі своєю формою файлів (один computed_owner vs один файл на approver).
//
// **Кожен підписант — окремий фізичний ключ, окремі файли.** На відміну
// від `decision-flow.js` (один computed_owner, один `NNNN-quiz.md`/
// `NNNN-approval.json`), тут КОЖЕН `approvers`-handle отримує ВЛАСНИЙ
// квіз-файл `NNNN-quiz-{handle}.md` і ВЛАСНИЙ підписаний
// `NNNN-approval-{handle}.json` — `decisions.js: deriveQuorumStatus`
// деривує загальний стан кворуму з усіх approval-файлів одразу.
//
// **Depth — `teach-back`, більше НЕ форсована на `standard`** (M5,
// docs/specs/260809-delta-app.md, «Обсяг M5», п.1): `teach-back` —
// контрактно правильна глибина для irreversible (mandates.md, «irreversible
// + широкий blast_radius → teach-back»); M4 форсувала `standard`, бо
// teach-back ще не існував — той форс задокументовано видалено тут.
// КОЖЕН підписант пише ВЛАСНИЙ переказ (transcript) своїми словами, оцінює
// ЛОКАЛЬНА модель ({@link import('./quiz.js').callLlmTeachBackEvaluator}) —
// той самий механізм, що одноосібний шлях (`decision-flow.js`), per-signer
// файли/квізи (заголовок вище).
//
// **Свідомо СПРОЩЕНО відносно одноосібного шляху** (задокументований обсяг
// M4/M5, не забуте): завершений teach-back НЕ дописує особисту базу знань
// (`knowledge.js`) — квізи кворуму атрибутовані до конкретного
// irreversible-акту, не до особистого домену навчання (на відміну від
// одноосібного `decision-flow.js: submitTeachBack`, який дописує). Розширення
// цього обсягу — кандидат наступного мілстоуна, не потрібне для demo-критерію
// M4/M5.
//
// **Схема підпису** — той самий канонікалізований payload-підхід, що
// `approval.js: buildAndSignApproval` (`signing.js: signPayload`), З
// ДОДАТКОВИМ полем `signer_handle` (М1-схема `ApprovalResponse` контрактно
// заморожена — approval.js докладно документує це в заголовку модуля,
// тому нове поле не додається туди; тут — власна, розширена копія
// функції підпису, а не мутація частого M1-контракту).

import { buildRequestId, formatApprovalFile } from './approval.js'
import { deriveQuorumStatus, parseDecisionRequest, requiresQuorum, resolveApprovers } from './decisions.js'
import {
  callLlmTeachBackEvaluator,
  defaultLlmConfig,
  formatTeachBackFile,
  parseTeachBackFile,
  teachBackPromptText,
  TEACHBACK_UNAVAILABLE_MESSAGE
} from './quiz.js'
import { signPayload } from './signing.js'

const QUORUM_DEPTH = 'teach-back'

/**
 * @param {string} decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} nnnn чотиризначний номер
 * @returns {string} абсолютний шлях до `NNNN-decision-request.md`
 */
function decisionRequestPath(decisionsDir, nnnn) {
  return `${decisionsDir}/${nnnn}-decision-request.md`
}

/**
 * @param {string} decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} nnnn чотиризначний номер
 * @param {string} handle підписант
 * @returns {string} абсолютний шлях до `NNNN-quiz-{handle}.md`
 */
function quizPath(decisionsDir, nnnn, handle) {
  return `${decisionsDir}/${nnnn}-quiz-${handle}.md`
}

/**
 * @param {string} decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} nnnn чотиризначний номер
 * @param {string} handle підписант
 * @returns {string} абсолютний шлях до `NNNN-approval-{handle}.json`
 */
function approvalPath(decisionsDir, nnnn, handle) {
  return `${decisionsDir}/${nnnn}-approval-${handle}.json`
}

/**
 * Читає й розбирає decision-request, перевіряючи, що воно ДІЙСНО irreversible
 * (кворумний шлях застосовується лише до нього — інші йдуть через
 * `decision-flow.js`).
 * @param {{readFile: (path: string) => Promise<string|null>}} io fs-транспорт
 * @param {string} decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} nnnn чотиризначний номер
 * @returns {Promise<object>} розібраний decision-request
 */
async function loadQuorumDecisionRequest(io, decisionsDir, nnnn) {
  const path = decisionRequestPath(decisionsDir, nnnn)
  const text = await io.readFile(path)
  if (!text) throw new Error(`decision-request не знайдено: ${path}`)
  const decisionRequest = parseDecisionRequest(text, { path, nnnn })
  if (!requiresQuorum(decisionRequest.leverageFacets)) {
    throw new Error(
      `decision ${nnnn}: кворум-конвеєр застосовується лише до irreversible-рішень ` +
        '(leverage_facets.irreversible: true) — інші йдуть через decision-flow.js'
    )
  }
  return decisionRequest
}

/**
 * Кидає, якщо ЦЕЙ підписант уже закрив свою частину кворуму — той самий
 * інваріант, що `decision-flow.js: assertDecisionOpen`, але per-signer:
 * інші approvers можуть лишатись відкритими, доки не підпишуть усі.
 * @param {{readFile: (path: string) => Promise<string|null>}} io fs-транспорт
 * @param {string} decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} nnnn чотиризначний номер
 * @param {string} handle підписант
 * @returns {Promise<void>}
 */
async function assertSignerOpen(io, decisionsDir, nnnn, handle) {
  const existing = await io.readFile(approvalPath(decisionsDir, nnnn, handle))
  if (existing) {
    throw new Error(`decision ${nnnn}: '${handle}' уже підписав(ла) свою частину кворуму — approval термінальний`)
  }
}

/**
 * Перевіряє, що `signerHandle` дійсно входить до `approvers` цього
 * рішення — самозванець не отримує квіз-файл.
 * @param {object} decisionRequest розібраний decision-request
 * @param {string} signerHandle заявлений підписант
 * @returns {string[]} список approvers (для повідомлення помилки)
 */
function assertIsApprover(decisionRequest, signerHandle) {
  const approvers = resolveApprovers(decisionRequest)
  if (!approvers.includes(signerHandle)) {
    throw new Error(
      `decision ${decisionRequest.nnnn}: '${signerHandle}' не входить до approvers [${approvers.join(', ')}] цього рішення`
    )
  }
  return approvers
}

/**
 * Генерує (перший виклик) або показує (повторний) підказку-промпт
 * ВЛАСНОГО teach-back-квізу одного підписанта — `quorum_quiz`, per-signer
 * дзеркало `decision-flow.js: decisionQuizTeachBack` (M5).
 * `chosenOption`/`llmConfig`/`fetchImpl` — прийняті, але НЕ використані:
 * teach-back не має питання для генерації (лише підказка-промпт), той самий
 * контракт входу, що `quorum_approve`/`decision_quiz`, для інтерфейсної
 * симетрії з Q&A-глибинами.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.signerHandle handle цього підписанта (з `approvers`)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} підказка-промпт teach-back цього підписанта
 */
export async function quorumQuiz({ io, decisionsDir, nnnn, signerHandle, now }) {
  await assertSignerOpen(io, decisionsDir, nnnn, signerHandle)
  const decisionRequest = await loadQuorumDecisionRequest(io, decisionsDir, nnnn)
  assertIsApprover(decisionRequest, signerHandle)

  const path = quizPath(decisionsDir, nnnn, signerHandle)
  const existingText = await io.readFile(path)
  if (existingText) {
    const state = parseTeachBackFile(existingText)
    const lastAttempt = state.attempts.at(-1) ?? null
    const failed = lastAttempt && lastAttempt.evaluation.understood === false
    return {
      quizPath: path,
      depth: QUORUM_DEPTH,
      prompt: teachBackPromptText(),
      iterations: state.iterations ?? 0,
      generatedBy: state.generatedBy,
      signerHandle,
      lastFeedback: failed ? lastAttempt.evaluation.feedback : null,
      missingAspects: failed ? lastAttempt.evaluation.missingAspects : []
    }
  }

  const shownAt = (now ? now() : new Date()).toISOString()
  const draft = { decisionRef: `${nnnn}-decision-request.md`, generatedBy: 'teach-back-prompt', shownAt, iterations: 0, attempts: [] }
  await io.writeFile(path, formatTeachBackFile(draft))
  return {
    quizPath: path,
    depth: QUORUM_DEPTH,
    prompt: teachBackPromptText(),
    iterations: 0,
    generatedBy: 'teach-back-prompt',
    signerHandle,
    lastFeedback: null,
    missingAspects: []
  }
}

/**
 * Проводить teach-back-спробу ВЛАСНОГО квізу одного підписанта — per-signer
 * дзеркало `decision-flow.js: submitTeachBack` (M5); та сама ЧЕСНА відмова
 * (`available: false`, {@link TEACHBACK_UNAVAILABLE_MESSAGE}), коли локальна
 * модель недоступна — нічого не пишеться, спроба не рахується.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.signerHandle handle цього підписанта
 * @param {string} params.transcript переказ ЦЬОГО підписанта своїми словами
 * @param {string} params.chosenOption обраний варіант (обов'язковий — оцінка звіряє переказ проти НЬОГО)
 * @param {{baseUrl: string, model: string}} [params.llmConfig] адреса й модель LLM-ендпоінта
 * @param {typeof fetch} [params.fetchImpl] ін'єкція fetch (тести)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} результат спроби
 */
export async function submitQuorumAnswer({ io, decisionsDir, nnnn, signerHandle, transcript, chosenOption, llmConfig, fetchImpl, now }) {
  await assertSignerOpen(io, decisionsDir, nnnn, signerHandle)
  const path = quizPath(decisionsDir, nnnn, signerHandle)
  const existingText = await io.readFile(path)
  if (!existingText) throw new Error(`квіз для ${nnnn}/${signerHandle} ще не згенеровано — виклич quorum_quiz спершу`)
  if (typeof transcript !== 'string' || !transcript.trim()) {
    throw new Error('teach-back: потрібен непорожній transcript (переказ своїми словами) — quorum_approve з полем transcript')
  }

  const state = parseTeachBackFile(existingText)
  const decisionRequest = await loadQuorumDecisionRequest(io, decisionsDir, nnnn)
  const evaluation = await callLlmTeachBackEvaluator(llmConfig ?? defaultLlmConfig(), decisionRequest, chosenOption, transcript, fetchImpl)
  if (!evaluation) {
    return { correct: false, done: false, available: false, iterations: state.iterations ?? 0, message: TEACHBACK_UNAVAILABLE_MESSAGE }
  }

  const attempts = [...state.attempts, { transcript, evaluation }]
  const iterations = attempts.length

  if (!evaluation.understood) {
    const draft = { decisionRef: state.decisionRef, generatedBy: evaluation.generatedBy, shownAt: state.shownAt, iterations, attempts }
    await io.writeFile(path, formatTeachBackFile(draft))
    return { correct: false, done: false, available: true, iterations, feedback: evaluation.feedback, missingAspects: evaluation.missingAspects }
  }

  const nowDate = now ? now() : new Date()
  const shownAtMs = state.shownAt ? Date.parse(state.shownAt) : Date.now()
  const timeToUnderstandingSec = Math.max(0, Math.round((nowDate.getTime() - shownAtMs) / 1000))
  const finalState = { decisionRef: state.decisionRef, generatedBy: evaluation.generatedBy, iterations, timeToUnderstandingSec, attempts }
  await io.writeFile(path, formatTeachBackFile(finalState))
  return { correct: true, done: true, available: true, iterations, quiz: finalState, feedback: evaluation.feedback }
}

/**
 * Будує й підписує `ApprovalResponse` кворуму — та сама схема, що
 * `approval.js`, ПЛЮС `signer_handle` (заголовок модуля: власна копія, не
 * мутація частого M1-контракту).
 * @param {object} params вхідні параметри
 * @param {string} params.requestId `request_id` (`buildRequestId`)
 * @param {string} params.chosenOption обраний варіант (label)
 * @param {string} params.quizRef відносний шлях до квіз-файлу цього підписанта (`decisions/NNNN-quiz-{handle}.md`)
 * @param {string} params.signerHandle handle підписанта
 * @param {object} params.privateKeyJwk приватний ключ підписанта (JWK)
 * @param {string} params.publicKeyBase64 публічний ключ підписанта (base64)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} підписаний approval
 */
async function buildAndSignQuorumApproval({
  requestId,
  chosenOption,
  quizRef,
  signerHandle,
  privateKeyJwk,
  publicKeyBase64,
  now
}) {
  const payload = {
    schema_version: 1,
    request_id: requestId,
    approved: true,
    chosen_option: chosenOption,
    quiz_ref: quizRef,
    signer_handle: signerHandle,
    signed_at: (now ? now() : new Date()).toISOString()
  }
  const signature = await signPayload(privateKeyJwk, payload)
  return { ...payload, pubkey: publicKeyBase64, signature }
}

/**
 * Повний потік `quorum_approve`: проводить квіз-відповідь власного квізу
 * підписанта, і лише коли ВІН здав його повністю — підписує й пише
 * `NNNN-approval-{handle}.json`. Не зачіпає інших approvers — кожен
 * підписант незалежний, кворум закривається лише коли ВСІ підписали з
 * ОДНАКОВИМ `chosen_option` ({@link import('./decisions.js').deriveQuorumStatus}).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.runId run-id (для `request_id`)
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.signerHandle handle цього підписанта
 * @param {string} params.chosenOption обраний варіант (label)
 * @param {string} params.transcript переказ ЦЬОГО підписанта своїми словами (`depth: teach-back`, M5)
 * @param {{privateKeyJwk: object, publicKeyBase64: string}} params.deviceKey ключ ЦЬОГО підписанта
 * @param {{baseUrl: string, model: string}} [params.llmConfig] адреса й модель LLM-ендпоінта
 * @param {typeof fetch} [params.fetchImpl] ін'єкція fetch (тести)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} результат — `{approved, correct, done, iterations, ...}` (`available: false` — teach-back недоступний)
 */
export async function quorumApprove({
  io,
  decisionsDir,
  runId,
  nnnn,
  signerHandle,
  chosenOption,
  transcript,
  deviceKey,
  llmConfig,
  fetchImpl,
  now
}) {
  const result = await submitQuorumAnswer({
    io,
    decisionsDir,
    nnnn,
    signerHandle,
    transcript,
    chosenOption,
    llmConfig,
    fetchImpl,
    now
  })
  if (result.available === false) {
    return { approved: false, correct: false, done: false, available: false, iterations: result.iterations, message: result.message }
  }
  if (!result.correct) {
    return {
      approved: false,
      correct: false,
      done: false,
      iterations: result.iterations,
      feedback: result.feedback,
      missingAspects: result.missingAspects
    }
  }

  const requestId = buildRequestId({ runId, nnnn })
  const quizRef = `decisions/${nnnn}-quiz-${signerHandle}.md`
  const approval = await buildAndSignQuorumApproval({
    requestId,
    chosenOption,
    quizRef,
    signerHandle,
    privateKeyJwk: deviceKey.privateKeyJwk,
    publicKeyBase64: deviceKey.publicKeyBase64,
    now
  })
  const approvalFilePath = approvalPath(decisionsDir, nnnn, signerHandle)
  await io.writeFile(approvalFilePath, formatApprovalFile(approval))
  return {
    approved: true,
    correct: true,
    done: true,
    iterations: result.iterations,
    approval,
    approvalPath: approvalFilePath,
    feedback: result.feedback
  }
}

/**
 * Точковий запит стану кворуму одного рішення — `quorum_status` tool,
 * читає лише approval-файли `approvers` (без повного сканування
 * decisions-директорії) і делегує обчислення {@link import('./decisions.js').deriveQuorumStatus}
 * (та сама логіка, що `deriveQueue` використовує зі сканованих даних —
 * єдине джерело правди для статусу «pending/closed/diverged»).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.nnnn чотиризначний номер
 * @returns {Promise<object>} `{nnnn, approvers, signed, pending, status}`
 */
export async function loadQuorumStatus({ io, decisionsDir, nnnn }) {
  const decisionRequest = await loadQuorumDecisionRequest(io, decisionsDir, nnnn)
  const approvers = resolveApprovers(decisionRequest)
  const filesByName = new Map()
  for (const handle of approvers) {
    const raw = await io.readFile(approvalPath(decisionsDir, nnnn, handle))
    if (raw) filesByName.set(`${nnnn}-approval-${handle}.json`, raw)
  }
  return { nnnn, ...deriveQuorumStatus(decisionRequest, filesByName) }
}
