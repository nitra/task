// Мультипартійний підпис (кворум) для irreversible-рішень — M4 (docs/specs/
// 260809-delta-app.md, «Обсяг M4», п.2; конституція п.8: «Мультипартійний
// підпис для незворотного: картка показує кворум і чиї квізи пройдені»).
//
// Одноосібні (не-irreversible) рішення й далі йдуть через `decision-flow.js`
// незмінно — `depthForFacets` мапить `irreversible: true` на `teach-back`
// (M5, не реалізовано), тож `loadSupportedDecisionRequest` там кидає ще ДО
// того, як цей модуль узагалі викликається: жоден irreversible
// decision-request фізично не може пройти через M1/M2-конвеєр — обидва
// шляхи взаємовиключні за конструкцією, не за додатковою перевіркою.
//
// **Кожен підписант — окремий фізичний ключ, окремі файли.** На відміну
// від `decision-flow.js` (один computed_owner, один `NNNN-quiz.md`/
// `NNNN-approval.json`), тут КОЖЕН `approvers`-handle отримує ВЛАСНИЙ
// квіз-файл `NNNN-quiz-{handle}.md` і ВЛАСНИЙ підписаний
// `NNNN-approval-{handle}.json` — `decisions.js: deriveQuorumStatus`
// деривує загальний стан кворуму з усіх approval-файлів одразу.
//
// **Депа форсована на `standard`** (та сама причина, що
// `change-proposal.js`, заголовок «Форс глибини квізу»): `teach-back` —
// контрактно правильна глибина для irreversible (mandates.md), але
// лишається M5; `standard` (2 незалежних питання про наслідки) — найвища
// ДОСТУПНА зараз, СВОЯ для кожного підписанта окремо (не одна на всіх).
//
// **Свідомо СПРОЩЕНО відносно M2 одноосібного шляху** (задокументований
// обсяг M4, не забуте): (1) немає навчального режиму «право на глибину»
// (`layeredExplain`) на фейлі — лише мікроурок; (2) немає spaced-repetition
// підмішування; (3) завершений квіз НЕ дописує особисту базу знань
// (`knowledge.js`) — квізи кворуму атрибутовані до конкретного
// irreversible-акту, не до особистого домену навчання. Розширення цього
// обсягу — кандидат наступного мілстоуна, не потрібне для demo-критерію M4
// («кворум 2/2 на irreversible-рішенні з двох пристроїв»).
//
// **Схема підпису** — той самий канонікалізований payload-підхід, що
// `approval.js: buildAndSignApproval` (`signing.js: signPayload`), З
// ДОДАТКОВИМ полем `signer_handle` (М1-схема `ApprovalResponse` контрактно
// заморожена — approval.js докладно документує це в заголовку модуля,
// тому нове поле не додається туди; тут — власна, розширена копія
// функції підпису, а не мутація частого M1-контракту).

import { buildRequestId, formatApprovalFile } from './approval.js'
import { deriveQuorumStatus, parseDecisionRequest, requiresQuorum, resolveApprovers } from './decisions.js'
import { formatQuizFile, generateStandardQuiz, parseQuizFile, rephraseQuestion } from './quiz.js'
import { signPayload } from './signing.js'

const FORCED_DEPTH = 'standard'

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
 * @param {{question: string, options: string[], correctIndex: number, microlesson: string}} generated одне згенероване питання
 * @returns {{repetition: boolean, attempts: object[]}} стан питання квізу з першою спробою
 */
function toQuestionState(generated) {
  return {
    repetition: false,
    attempts: [
      {
        question: generated.question,
        options: generated.options,
        correctAnswer: generated.options[generated.correctIndex],
        microlesson: generated.microlesson
      }
    ]
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
 * Генерує (перший виклик) або показує (повторний) активне питання
 * ВЛАСНОГО квізу одного підписанта — `quorum_quiz`, per-signer дзеркало
 * `decision-flow.js: decisionQuiz`, форсоване на {@link FORCED_DEPTH}.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.signerHandle handle цього підписанта (з `approvers`)
 * @param {string} params.chosenOption обраний варіант (label)
 * @param {{baseUrl: string, model: string}} [params.llmConfig] адреса й модель LLM-ендпоінта
 * @param {typeof fetch} [params.fetchImpl] ін'єкція fetch (тести)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} активне питання квізу цього підписанта
 */
export async function quorumQuiz({ io, decisionsDir, nnnn, signerHandle, chosenOption, llmConfig, fetchImpl, now }) {
  await assertSignerOpen(io, decisionsDir, nnnn, signerHandle)
  const decisionRequest = await loadQuorumDecisionRequest(io, decisionsDir, nnnn)
  assertIsApprover(decisionRequest, signerHandle)

  const path = quizPath(decisionsDir, nnnn, signerHandle)
  const existingText = await io.readFile(path)
  if (existingText) {
    const quiz = parseQuizFile(existingText)
    const resolvedCount = quiz.resolvedCount ?? 0
    const activeQuestion = quiz.questions[resolvedCount] ?? quiz.questions.at(-1)
    const activeAttempt = activeQuestion.attempts.at(-1)
    return {
      quizPath: path,
      question: activeAttempt.question,
      options: activeAttempt.options,
      depth: quiz.depth,
      iterations: quiz.iterations,
      generatedBy: quiz.generatedBy,
      questionIndex: quiz.questions.indexOf(activeQuestion) + 1,
      questionCount: quiz.questions.length,
      signerHandle
    }
  }

  const shownAt = (now ? now() : new Date()).toISOString()
  const generated = await generateStandardQuiz({ decisionRequest, chosenOption, llmConfig, fetchImpl })
  const questions = generated.questions.map(q => toQuestionState(q))
  const draft = {
    decisionRef: `${nnnn}-decision-request.md`,
    depth: FORCED_DEPTH,
    generatedBy: generated.generatedBy,
    shownAt,
    resolvedCount: 0,
    iterations: questions.reduce((sum, q) => sum + q.attempts.length, 0),
    questions
  }
  await io.writeFile(path, formatQuizFile(draft))
  const activeAttempt = questions[0].attempts[0]
  return {
    quizPath: path,
    question: activeAttempt.question,
    options: activeAttempt.options,
    depth: FORCED_DEPTH,
    iterations: draft.iterations,
    generatedBy: generated.generatedBy,
    questionIndex: 1,
    questionCount: questions.length,
    signerHandle
  }
}

/**
 * Проводить квіз-відповідь на активне питання ВЛАСНОГО квізу одного
 * підписанта — per-signer дзеркало `decision-flow.js: submitQuizAnswer`,
 * без навчального режиму/spaced-repetition (задокументований обсяг M4,
 * заголовок модуля).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.signerHandle handle цього підписанта
 * @param {number|string} params.answer квіз-відповідь (індекс або текст)
 * @param {string} [params.chosenOption] обраний варіант (для перефразування на ретраї)
 * @param {{baseUrl: string, model: string}} [params.llmConfig] адреса й модель LLM-ендпоінта
 * @param {typeof fetch} [params.fetchImpl] ін'єкція fetch (тести)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} результат спроби
 */
export async function submitQuorumAnswer({
  io,
  decisionsDir,
  nnnn,
  signerHandle,
  answer,
  chosenOption,
  llmConfig,
  fetchImpl,
  now
}) {
  await assertSignerOpen(io, decisionsDir, nnnn, signerHandle)
  const path = quizPath(decisionsDir, nnnn, signerHandle)
  const existingText = await io.readFile(path)
  if (!existingText) throw new Error(`квіз для ${nnnn}/${signerHandle} ще не згенеровано — виклич quorum_quiz спершу`)

  const quiz = parseQuizFile(existingText)
  const decisionRequest = await loadQuorumDecisionRequest(io, decisionsDir, nnnn)

  const resolvedCount = quiz.resolvedCount ?? 0
  const questions = quiz.questions.map(q => ({ ...q, attempts: [...q.attempts] }))
  const activeQuestion = questions[resolvedCount]
  const lastAttempt = activeQuestion.attempts.at(-1)
  const answerIndex = typeof answer === 'number' ? answer : lastAttempt.options.indexOf(answer)
  const correctIndex = lastAttempt.options.indexOf(lastAttempt.correctAnswer)
  const correct = answerIndex !== -1 && answerIndex === correctIndex
  const totalAttemptsSoFar = questions.reduce((sum, q) => sum + q.attempts.length, 0)

  if (!correct) {
    let questionText = lastAttempt.question
    if (chosenOption && (llmConfig || fetchImpl)) {
      const rephrased = await rephraseQuestion({
        llmConfig,
        decisionRequest,
        chosenOption,
        previousQuestion: lastAttempt.question,
        fetchImpl
      })
      if (rephrased) questionText = rephrased
    }
    activeQuestion.attempts.push({
      question: questionText,
      options: lastAttempt.options,
      correctAnswer: lastAttempt.correctAnswer,
      microlesson: lastAttempt.microlesson
    })
    const draft = {
      decisionRef: quiz.decisionRef,
      depth: quiz.depth,
      generatedBy: quiz.generatedBy,
      shownAt: quiz.shownAt,
      resolvedCount,
      iterations: totalAttemptsSoFar + 1,
      questions
    }
    await io.writeFile(path, formatQuizFile(draft))
    return {
      correct: false,
      done: false,
      iterations: draft.iterations,
      microlesson: lastAttempt.microlesson,
      questionIndex: resolvedCount + 1,
      questionCount: questions.length
    }
  }

  const newResolvedCount = resolvedCount + 1
  if (newResolvedCount < questions.length) {
    const draft = {
      decisionRef: quiz.decisionRef,
      depth: quiz.depth,
      generatedBy: quiz.generatedBy,
      shownAt: quiz.shownAt,
      resolvedCount: newResolvedCount,
      iterations: totalAttemptsSoFar,
      questions
    }
    await io.writeFile(path, formatQuizFile(draft))
    const nextAttempt = questions[newResolvedCount].attempts.at(-1)
    return {
      correct: true,
      done: false,
      iterations: draft.iterations,
      microlesson: lastAttempt.microlesson,
      nextQuestion: {
        question: nextAttempt.question,
        options: nextAttempt.options,
        questionIndex: newResolvedCount + 1,
        questionCount: questions.length
      }
    }
  }

  const nowDate = now ? now() : new Date()
  const shownAtMs = quiz.shownAt ? Date.parse(quiz.shownAt) : Date.now()
  const timeToUnderstandingSec = Math.max(0, Math.round((nowDate.getTime() - shownAtMs) / 1000))
  const finalQuiz = {
    decisionRef: quiz.decisionRef,
    depth: quiz.depth,
    generatedBy: quiz.generatedBy,
    iterations: totalAttemptsSoFar,
    timeToUnderstandingSec,
    questions
  }
  await io.writeFile(path, formatQuizFile(finalQuiz))
  return {
    correct: true,
    done: true,
    iterations: finalQuiz.iterations,
    quiz: finalQuiz,
    microlesson: lastAttempt.microlesson
  }
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
 * @param {number|string} params.answer квіз-відповідь
 * @param {{privateKeyJwk: object, publicKeyBase64: string}} params.deviceKey ключ ЦЬОГО підписанта
 * @param {{baseUrl: string, model: string}} [params.llmConfig] адреса й модель LLM-ендпоінта
 * @param {typeof fetch} [params.fetchImpl] ін'єкція fetch (тести)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} результат — `{approved, correct, done, iterations, ...}`
 */
export async function quorumApprove({
  io,
  decisionsDir,
  runId,
  nnnn,
  signerHandle,
  chosenOption,
  answer,
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
    answer,
    chosenOption,
    llmConfig,
    fetchImpl,
    now
  })
  if (!result.correct) {
    return {
      approved: false,
      correct: false,
      done: false,
      iterations: result.iterations,
      microlesson: result.microlesson,
      questionIndex: result.questionIndex,
      questionCount: result.questionCount
    }
  }
  if (!result.done) {
    return {
      approved: false,
      correct: true,
      done: false,
      iterations: result.iterations,
      microlesson: result.microlesson,
      nextQuestion: result.nextQuestion
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
    microlesson: result.microlesson
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
