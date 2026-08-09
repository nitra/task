// Оркестрація квіз-гейта: generate → answer (fail ≠ покарання, роз'яснення,
// iterations++) → sign. Транспорт-незалежна — приймає `io` (readFile/writeFile
// над абсолютними шляхами), той самий інваріант, що CLI/GUI поверхні M0:
// сирі байти читає/пише транспорт (Rust fs-команди в GUI, node:fs у CLI),
// уся логіка — тут, спільна для обох (docs/specs/260809-delta-app.md, п.6).
//
// Квіз-файл лишається мутабельним чернетковим станом, доки не зафіксований
// правильною відповіддю (mandates.md: «квіз мутабельний до моменту, коли
// iterations фіксується підписаним ApprovalResponse»): перший виклик
// `decisionQuiz` генерує й пише чернетку на диск (з `shown_at`, без
// `time_to_understanding_sec`) — саме цей запис на диск і є персистентним
// станом «час до розуміння» рахує від; кожна неправильна відповідь дописує
// нову спробу того самого питання; правильна відповідь фіналізує файл
// (прибирає `shown_at`, фіксує `iterations`/`time_to_understanding_sec`) і
// відкриває шлях до підписаного approval.

import { buildAndSignApproval, buildRequestId, formatApprovalFile } from './approval.js'
import { depthForFacets, parseDecisionRequest } from './decisions.js'
import { formatQuizFile, generateQuiz, parseQuizFile } from './quiz.js'

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
 * @returns {string} абсолютний шлях до `NNNN-quiz.md`
 */
function quizPath(decisionsDir, nnnn) {
  return `${decisionsDir}/${nnnn}-quiz.md`
}

/**
 * Читає й розбирає decision-request за `NNNN`, перевіряючи, що глибина
 * квіз-гейта — `one-tap` (М1 не реалізує standard/teach-back).
 * @param {{readFile: (path: string) => Promise<string|null>}} io fs-транспорт
 * @param {string} decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} nnnn чотиризначний номер
 * @returns {Promise<object>} розібраний decision-request
 */
async function loadOneTapDecisionRequest(io, decisionsDir, nnnn) {
  const path = decisionRequestPath(decisionsDir, nnnn)
  const text = await io.readFile(path)
  if (!text) throw new Error(`decision-request не знайдено: ${path}`)
  const decisionRequest = parseDecisionRequest(text, { path, nnnn })
  const depth = depthForFacets(decisionRequest.leverageFacets)
  if (depth !== 'one-tap') {
    throw new Error(
      `decision ${nnnn}: глибина «${depth}» ще не реалізована в M1 (лише one-tap — docs/specs/260809-delta-app.md)`
    )
  }
  return decisionRequest
}

/**
 * Генерує (при першому виклику) або показує (при повторному) one-tap квіз
 * для обраного варіанта — `delta`-tool `decision_quiz`.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.chosenOption обраний варіант decision-request (label)
 * @param {{baseUrl: string, model: string}} [params.llmConfig] адреса й модель LLM-ендпоінта
 * @param {typeof fetch} [params.fetchImpl] ін'єкція fetch (тести)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{quizPath: string, question: string, options: string[], depth: string, iterations: number, generatedBy: string}>}
 *   поточне (останнє) питання квізу — без розкриття правильної відповіді
 */
export async function decisionQuiz({ io, decisionsDir, nnnn, chosenOption, llmConfig, fetchImpl, now }) {
  const decisionRequest = await loadOneTapDecisionRequest(io, decisionsDir, nnnn)
  const path = quizPath(decisionsDir, nnnn)
  const existingText = await io.readFile(path)

  if (existingText) {
    const quiz = parseQuizFile(existingText)
    const last = quiz.attempts.at(-1)
    return {
      quizPath: path,
      question: last.question,
      options: last.options,
      depth: quiz.depth,
      iterations: quiz.iterations,
      generatedBy: quiz.generatedBy
    }
  }

  const generated = await generateQuiz({ decisionRequest, chosenOption, llmConfig, fetchImpl })
  const shownAt = (now ? now() : new Date()).toISOString()
  const draft = {
    decisionRef: `${nnnn}-decision-request.md`,
    depth: 'one-tap',
    generatedBy: generated.generatedBy,
    shownAt,
    iterations: 1,
    attempts: [
      {
        question: generated.question,
        options: generated.options,
        correctAnswer: generated.options[generated.correctIndex],
        microlesson: generated.microlesson
      }
    ]
  }
  await io.writeFile(path, formatQuizFile(draft))
  return {
    quizPath: path,
    question: generated.question,
    options: generated.options,
    depth: 'one-tap',
    iterations: 1,
    generatedBy: generated.generatedBy
  }
}

/**
 * Проводить квіз-відповідь: неправильна — дописує нову спробу того самого
 * питання з роз'ясненням (мікроурок), `iterations++`, підпис лишається
 * недоступним; правильна — фіналізує квіз-файл (`iterations`,
 * `time_to_understanding_sec`), відкриваючи шлях до підпису.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.nnnn чотиризначний номер
 * @param {number|string} params.answer індекс (0-based) або точний текст обраної відповіді
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{correct: boolean, iterations: number, microlesson?: string, quiz?: object}>} результат спроби
 */
export async function submitQuizAnswer({ io, decisionsDir, nnnn, answer, now }) {
  const path = quizPath(decisionsDir, nnnn)
  const existingText = await io.readFile(path)
  if (!existingText) throw new Error(`квіз для ${nnnn} ще не згенеровано — виклич decision_quiz спершу`)

  const quiz = parseQuizFile(existingText)
  const last = quiz.attempts.at(-1)
  const answerIndex = typeof answer === 'number' ? answer : last.options.indexOf(answer)
  const correctIndex = last.options.indexOf(last.correctAnswer)
  const correct = answerIndex !== -1 && answerIndex === correctIndex

  if (correct) {
    const shownAtMs = quiz.shownAt ? Date.parse(quiz.shownAt) : Date.now()
    const nowMs = (now ? now() : new Date()).getTime()
    const timeToUnderstandingSec = Math.max(0, Math.round((nowMs - shownAtMs) / 1000))
    const finalQuiz = {
      decisionRef: quiz.decisionRef,
      depth: quiz.depth,
      generatedBy: quiz.generatedBy,
      iterations: quiz.attempts.length,
      timeToUnderstandingSec,
      attempts: quiz.attempts
    }
    await io.writeFile(path, formatQuizFile(finalQuiz))
    return { correct: true, iterations: finalQuiz.iterations, quiz: finalQuiz }
  }

  // Фейл ≠ покарання (конституція п.2/3): нова спроба того самого питання,
  // мікроурок повертається одразу — не «здав/не здав», а розгортання контексту.
  const draft = {
    decisionRef: quiz.decisionRef,
    depth: quiz.depth,
    generatedBy: quiz.generatedBy,
    shownAt: quiz.shownAt,
    iterations: quiz.attempts.length + 1,
    attempts: [
      ...quiz.attempts,
      {
        question: last.question,
        options: last.options,
        correctAnswer: last.correctAnswer,
        microlesson: last.microlesson
      }
    ]
  }
  await io.writeFile(path, formatQuizFile(draft))
  return { correct: false, iterations: draft.iterations, microlesson: last.microlesson }
}

/**
 * Повний потік `decision_approve`: проводить квіз-відповідь, і лише на
 * правильній — підписує й пише `NNNN-approval.json`. Неправильна відповідь
 * повертає роз'яснення без підпису (інваріант: без завершеного квізу
 * approval не пишеться).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.runId run-id (для `request_id`)
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.chosenOption обраний варіант decision-request (label)
 * @param {number|string} params.answer квіз-відповідь (індекс або текст)
 * @param {{privateKeyJwk: object, publicKeyBase64: string}} params.deviceKey ключ пристрою підписанта
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{approved: boolean, correct: boolean, iterations: number, microlesson?: string, approval?: object, approvalPath?: string}>} результат
 */
export async function decisionApprove({ io, decisionsDir, runId, nnnn, chosenOption, answer, deviceKey, now }) {
  const result = await submitQuizAnswer({ io, decisionsDir, nnnn, answer, now })
  if (!result.correct)
    return { approved: false, correct: false, iterations: result.iterations, microlesson: result.microlesson }

  const requestId = buildRequestId({ runId, nnnn })
  const quizRef = `decisions/${nnnn}-quiz.md`
  const decisionRef = `${nnnn}-decision-request.md`
  const approval = await buildAndSignApproval({
    requestId,
    chosenOption,
    quizRef,
    quiz: result.quiz,
    decisionRef,
    privateKeyJwk: deviceKey.privateKeyJwk,
    publicKeyBase64: deviceKey.publicKeyBase64
  })
  const approvalFilePath = `${decisionsDir}/${nnnn}-approval.json`
  await io.writeFile(approvalFilePath, formatApprovalFile(approval))
  return { approved: true, correct: true, iterations: result.iterations, approval, approvalPath: approvalFilePath }
}
