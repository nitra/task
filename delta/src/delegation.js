// Черга відкладених дій + делегування одним квізом (M5, docs/specs/
// 260809-delta-app.md, «Обсяг M5», п.5) — деривація з дрейф-карток
// (`drift.js`): «делегувати ШІ» = обрати модель з мандатом, чий scope
// покриває `decision_type` ({@link findEligibleModel}, `mandates.js`), пройти
// ОДИН one-tap квіз («що саме делегуєш і що модель зробить»), підписати той
// самий канонікалізований payload, що `approval.js`/`quorum.js`
// (`signing.js: signPayload`).
//
// **Квіз делегування — детермінований, БЕЗ LLM (задокументоване рішення
// M5).** На відміну від `quiz.js` (розуміння НАСЛІДКІВ обраного варіанта
// розвилки — потребує генерації з домену) тут ОДНЕ фіксоване
// мета-питання: «що саме станеться, якщо делегувати» — той самий текст для
// будь-якої розвилки, лише підставлені `nnnn`/`modelHandle`/`decisionType`.
// Генерація через LLM додала б непередбачувану залежність там, де
// правильна відповідь ЗАВЖДИ одна й та сама структура («модель вирішить
// сама в межах мандата, підпис лишиться за нею») — простіше й
// тестованіше лишити деривацію повністю pure. Формат файлу — той самий
// `formatQuizFile`/`parseQuizFile`, що Q&A-квізи (`quiz.js`) —
// `depth: one-tap`, один файл `NNNN-delegation-quiz.md`, byte-сумісний з
// рештою one-tap квізів (`quiz_ref` у делегація-записі показує саме на нього).
//
// **Деривація черги моделі — `computed_owner` decision-request НЕ
// переписується.** `NNNN-delegation.json` пишеться ПОРУЧ із
// decision-request (той самий каталог `decisions/`, що approval/quiz) — сам
// файл decision-request лишається незмінним назавжди (audit-trail:
// «хто ким рекомендував це рішення спершу» не втрачається). Присутність
// `NNNN-delegation.json` — деривований сигнал для `decisions.js: deriveQueue`:
// розвилка зникає з черги `computed_owner` і з'являється в черзі
// `delegated_to` (моделі) — «делегування-файл поруч = черга моделі»
// (задокументоване рішення M5, аналогічне до того, як `NNNN-approval.json`
// закриває чергу зовсім).

import { buildRequestId } from './approval.js'
import { parseDecisionRequest } from './decisions.js'
import { modelMandates } from './mandates.js'
import { formatQuizFile, parseQuizFile } from './quiz.js'
import { signPayload } from './signing.js'

/**
 * @param {string} decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} nnnn чотиризначний номер
 * @returns {string} абсолютний шлях до `NNNN-delegation-quiz.md`
 */
function delegationQuizPath(decisionsDir, nnnn) {
  return `${decisionsDir}/${nnnn}-delegation-quiz.md`
}

/**
 * @param {string} decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} nnnn чотиризначний номер
 * @returns {string} абсолютний шлях до `NNNN-delegation.json`
 */
function delegationPath(decisionsDir, nnnn) {
  return `${decisionsDir}/${nnnn}-delegation.json`
}

/**
 * Модель з мандатом, чий scope покриває `decisionType`, серед моделей ПІД
 * відповідальністю `delegatorHandle` (`escalates_to === delegatorHandle`,
 * директорська модель — делегувати можна лише СВОЮ модель, не будь-яку
 * модель у карті). `scope.decision_types` містить `decisionType` буквально,
 * або `'*'` (той самий wildcard-підхід, що фікстура `mandates.yaml`
 * README: `decision_types: ["*"]` на кореневому мандаті).
 * @param {object[]} mandates нормалізовані мандати (`mandates.js: parseMandates`)
 * @param {string} decisionType клас рішень дрейф-картки
 * @param {string} delegatorHandle власник, що делегує (директорська відповідальність лишається на ньому)
 * @returns {object|null} перший придатний мандат моделі, або `null` — немає покриття
 */
export function findEligibleModel(mandates, decisionType, delegatorHandle) {
  const myModels = modelMandates(mandates).filter(m => m.escalatesTo === delegatorHandle)
  return myModels.find(m => m.scope.decisionTypes.includes(decisionType) || m.scope.decisionTypes.includes('*')) ?? null
}

/**
 * Будує детерміноване one-tap мета-питання делегування — той самий
 * ротаційний підхід проти постійної позиції 0, що `quiz.js: fallbackQuiz`.
 * @param {object} decisionRequest розібраний decision-request
 * @param {string} modelHandle handle моделі, якій делегується
 * @returns {{question: string, options: string[], correctIndex: number}} питання-мета-квіз
 */
function buildDelegationQuestion(decisionRequest, modelHandle) {
  const domain = decisionRequest.decisionType ?? 'general'
  const correct =
    `Модель ${modelHandle} отримає розвилку ${decisionRequest.nnnn} (${domain}) і вирішить її САМА в межах свого ` +
    'мандата — підпис на наслідковому рішенні лишиться за моделлю, не за тобою.'
  const distractors = [
    'Розвилку буде автоматично видалено без жодного рішення.',
    `Модель ${modelHandle} лише запропонує варіант — підписантом і далі лишишся ти.`
  ]
  const options = [correct, ...distractors]
  const rotation = decisionRequest.nnnn.length % options.length
  const rotated = [...options.slice(rotation), ...options.slice(0, rotation)]
  return {
    question: `Що саме станеться, якщо делегувати розвилку ${decisionRequest.nnnn} моделі ${modelHandle}?`,
    options: rotated,
    correctIndex: rotated.indexOf(correct)
  }
}

/**
 * Генерує (перший виклик) або показує (повторний) активне one-tap
 * мета-питання делегування — `delegation_quiz` tool.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.modelHandle handle моделі, якій делегується
 * @param {string} params.decisionRequestText сирий текст decision-request (для побудови питання)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{quizPath: string, question: string, options: string[], iterations: number, modelHandle: string}>}
 *   активне мета-питання делегування
 */
export async function delegationQuiz({ io, decisionsDir, nnnn, modelHandle, decisionRequestText, now }) {
  const path = delegationQuizPath(decisionsDir, nnnn)
  const existingText = await io.readFile(path)
  if (existingText) {
    const quiz = parseQuizFile(existingText)
    const attempt = quiz.questions[0].attempts.at(-1)
    return { quizPath: path, question: attempt.question, options: attempt.options, iterations: quiz.iterations, modelHandle }
  }

  const decisionRequest = parseDecisionRequest(decisionRequestText, { nnnn })
  const generated = buildDelegationQuestion(decisionRequest, modelHandle)
  const shownAt = (now ? now() : new Date()).toISOString()
  const attempt = {
    question: generated.question,
    options: generated.options,
    correctAnswer: generated.options[generated.correctIndex],
    microlesson:
      'Делегування — деривація, не мутація: computed_owner у decision-request НЕ переписується, черга моделі ' +
      `деривується з сусіднього ${nnnn}-delegation.json (docs/specs/260809-delta-app.md, «Обсяг M5», п.5).`
  }
  const draft = {
    decisionRef: `${nnnn}-decision-request.md`,
    depth: 'one-tap',
    generatedBy: 'delegation-quiz-deterministic',
    shownAt,
    resolvedCount: 0,
    iterations: 1,
    questions: [{ repetition: false, attempts: [attempt] }]
  }
  await io.writeFile(path, formatQuizFile(draft))
  return { quizPath: path, question: attempt.question, options: attempt.options, iterations: 1, modelHandle }
}

/**
 * Проводить спробу one-tap мета-квізу делегування — той самий «фейл ≠
 * покарання» інваріант, що Q&A-квізи `quiz.js` (нова спроба того самого
 * питання, `iterations++`, ЖОДНОГО підпису без правильної відповіді).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.nnnn чотиризначний номер
 * @param {number|string} params.answer індекс (0-based) або точний текст обраної відповіді
 * @returns {Promise<{correct: boolean, iterations: number, quizRef?: string}>} результат спроби
 */
export async function submitDelegationAnswer({ io, decisionsDir, nnnn, answer }) {
  const path = delegationQuizPath(decisionsDir, nnnn)
  const existingText = await io.readFile(path)
  if (!existingText) throw new Error(`квіз делегування для ${nnnn} ще не згенеровано — виклич delegation_quiz спершу`)

  const quiz = parseQuizFile(existingText)
  const attempt = quiz.questions[0].attempts.at(-1)
  const answerIndex = typeof answer === 'number' ? answer : attempt.options.indexOf(answer)
  const correctIndex = attempt.options.indexOf(attempt.correctAnswer)
  const correct = answerIndex !== -1 && answerIndex === correctIndex

  if (!correct) {
    const draft = {
      decisionRef: quiz.decisionRef,
      depth: quiz.depth,
      generatedBy: quiz.generatedBy,
      shownAt: quiz.shownAt,
      resolvedCount: 0,
      iterations: quiz.iterations + 1,
      questions: [{ repetition: false, attempts: [...quiz.questions[0].attempts, attempt] }]
    }
    await io.writeFile(path, formatQuizFile(draft))
    return { correct: false, iterations: draft.iterations }
  }

  return { correct: true, iterations: quiz.iterations, quizRef: `decisions/${nnnn}-delegation-quiz.md` }
}

/**
 * Будує й підписує делегація-запис — той самий канонікалізований
 * payload-підхід, що `approval.js: buildAndSignApproval`/`quorum.js:
 * buildAndSignQuorumApproval` (`signing.js: signPayload`), контракт задачі
 * M5, буквально: `{delegated_to, delegated_by, signed_at, pubkey,
 * signature, quiz_ref}`.
 * @param {object} params вхідні параметри
 * @param {string} params.requestId `request_id` (`approval.js: buildRequestId`)
 * @param {string} params.decisionRef `NNNN-decision-request.md`
 * @param {string} params.delegatedTo handle моделі, якій делегується
 * @param {string} params.delegatedBy handle людини, що делегує
 * @param {string} params.quizRef відносний шлях до `NNNN-delegation-quiz.md`
 * @param {object} params.privateKeyJwk приватний ключ делегатора (JWK)
 * @param {string} params.publicKeyBase64 публічний ключ делегатора (base64)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} підписаний делегація-запис
 */
export async function buildAndSignDelegation({ requestId, decisionRef, delegatedTo, delegatedBy, quizRef, privateKeyJwk, publicKeyBase64, now }) {
  const payload = {
    schema_version: 1,
    request_id: requestId,
    decision_ref: decisionRef,
    delegated_to: delegatedTo,
    delegated_by: delegatedBy,
    quiz_ref: quizRef,
    signed_at: (now ? now() : new Date()).toISOString()
  }
  const signature = await signPayload(privateKeyJwk, payload)
  return { ...payload, pubkey: publicKeyBase64, signature }
}

/**
 * @param {object} record підписаний делегація-запис
 * @returns {string} pretty-print JSON текст файлу
 */
export function formatDelegationFile(record) {
  return `${JSON.stringify(record, null, 2)}\n`
}

/**
 * Повний потік `decision_delegate`: проводить one-tap мета-квіз, і лише
 * коли здано правильно — підписує й пише `NNNN-delegation.json`. Кидає,
 * якщо рішення вже закрите (approval) чи вже делеговано (термінальні акти
 * того самого рангу, що `assertDecisionOpen` у `decision-flow.js`).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.runId run-id (для `request_id`)
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.modelHandle handle моделі, якій делегується
 * @param {string} params.delegatedByHandle handle людини, що делегує (директорська відповідальність лишається на ній)
 * @param {number|string} params.answer відповідь мета-квізу
 * @param {{privateKeyJwk: object, publicKeyBase64: string}} params.deviceKey ключ делегатора
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} результат — `{delegated, correct, iterations, ...}`
 */
export async function delegateDecision({ io, decisionsDir, runId, nnnn, modelHandle, delegatedByHandle, answer, deviceKey, now }) {
  const existingApproval = await io.readFile(`${decisionsDir}/${nnnn}-approval.json`)
  if (existingApproval) throw new Error(`decision ${nnnn}: рішення вже закрите підписаним approval — делегувати нікуди`)
  const existingDelegation = await io.readFile(delegationPath(decisionsDir, nnnn))
  if (existingDelegation) throw new Error(`decision ${nnnn}: уже делеговано — повторне делегування недоступне`)

  const result = await submitDelegationAnswer({ io, decisionsDir, nnnn, answer })
  if (!result.correct) return { delegated: false, correct: false, iterations: result.iterations }

  const requestId = buildRequestId({ runId, nnnn })
  const decisionRef = `${nnnn}-decision-request.md`
  const record = await buildAndSignDelegation({
    requestId,
    decisionRef,
    delegatedTo: modelHandle,
    delegatedBy: delegatedByHandle,
    quizRef: result.quizRef,
    privateKeyJwk: deviceKey.privateKeyJwk,
    publicKeyBase64: deviceKey.publicKeyBase64,
    now
  })
  const path = delegationPath(decisionsDir, nnnn)
  await io.writeFile(path, formatDelegationFile(record))
  return { delegated: true, correct: true, iterations: result.iterations, delegation: record, delegationPath: path }
}
