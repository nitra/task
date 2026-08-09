// Оркестрація квіз-гейта: generate → answer (fail ≠ покарання, шар за шаром
// розгортання контексту, iterations++) → sign. Транспорт-незалежна —
// приймає `io` (readFile/writeFile над абсолютними шляхами decisions/) і
// `knowledgeIo` (read/write бази знань поза git), той самий інваріант, що
// CLI/GUI поверхні M0/M1: сирі байти читає/пише транспорт, уся логіка — тут,
// спільна для обох (docs/specs/260809-delta-app.md, п.6/п.2 конституції).
//
// M1 реалізувала один квіз = одне питання (`depth: one-tap`). M2 узагальнює
// квіз на СПИСОК питань (`quiz.questions[]`, quiz.js): `depth: standard`
// генерує 2 питання про саму розвилку; `depth: one-tap` може підмішати ДРУГЕ
// питання зі spaced-repetition бази знань (п.5 конституції), коли інтервал
// домену настав. Активне питання квізу — `questions[resolvedCount]`
// (`resolvedCount` — draft-тільки лічильник у квіз-файлі, той самий підхід,
// що `shown_at`): скільки лідируючих питань уже здано правильно. Квіз
// фіналізується (`iterations`/`time_to_understanding_sec`, підпис
// доступний) лише коли ВСІ питання здано.
//
// Квіз-файл лишається мутабельним чернетковим станом, доки не зафіксований
// фіналізацією (mandates.md: «квіз мутабельний до моменту, коли iterations
// фіксується підписаним ApprovalResponse»): перший виклик `decisionQuiz`
// генерує й пише чернетку на диск (з `shown_at`) — саме цей запис на диск і
// є персистентним станом «час до розуміння» рахує від.
//
// M2 (п.4 конституції — особиста база знань): щойно квіз повністю здано,
// `submitQuizAnswer` дописує запис у базу знань (`src/knowledge.js`) —
// {decisionRef, domain, question, microlesson, iterations,
// timeToUnderstandingSec, completedAt} ГОЛОВНОГО питання квізу (питання про
// саму розвилку — навіть у `standard` з двома питаннями, один запис на один
// завершений квіз). Якщо друге питання квізу було spaced-repetition —
// відповідь на нього оновлює `lastRepeatedAt`/`intervalDays` того запису
// бази знань (`quiz.repetitionSource` — `id` запису, draft-тільки поле).

import { buildAndSignApproval, buildRequestId, formatApprovalFile } from './approval.js'
import { depthForFacets, parseDecisionRequest } from './decisions.js'
import { appendKnowledgeEntry, dueRepetition, loadKnowledgeEntries, recordRepetitionAnswer, saveKnowledgeEntries } from './knowledge.js'
import {
  callLlmTeachBackEvaluator,
  defaultLlmConfig,
  formatQuizFile,
  formatTeachBackFile,
  generateQuiz,
  generateStandardQuiz,
  parseQuizFile,
  parseTeachBackFile,
  rephraseQuestion,
  teachBackPromptText,
  TEACHBACK_UNAVAILABLE_MESSAGE
} from './quiz.js'

// M2 реалізувала `one-tap` (1-2 питання зі spaced-repetition) і `standard`
// (2 питання про саму розвилку); M5 (docs/specs/260809-delta-app.md, «Обсяг
// M5», п.1) додає `teach-back` — найвища глибина (irreversible/широкий
// blast_radius), переказ своїми словами замість Q&A (детальніше — заголовок
// `quiz.js`, секція teach-back).
const SUPPORTED_DEPTHS = new Set(['one-tap', 'standard', 'teach-back'])
// Spaced-repetition (п.5 конституції) підмішується ЛИШЕ в `one-tap`: два
// незалежні механізми множинних питань (standard-генерація ВЛАСНИХ 2-3
// питань про розвилку, і підмішування ЧУЖОГО питання з бази знань) свідомо
// не стекуються в M2 — уникає комбінаторного вибуху UX/тестів у першій
// ітерації; перегляд розподілу — M3+ (задокументоване рішення обсягу).
const REPETITION_ELIGIBLE_DEPTHS = new Set(['one-tap'])

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
 * @param {string} decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} nnnn чотиризначний номер
 * @returns {string} абсолютний шлях до `NNNN-approval.json`
 */
function approvalPath(decisionsDir, nnnn) {
  return `${decisionsDir}/${nnnn}-approval.json`
}

/**
 * Кидає, якщо `NNNN` уже закритий підписаним `NNNN-approval.json` — M1-баг,
 * знайдений на рев'ю: без цього гейту `decision_quiz`/`decision_approve` на
 * вже підписаному рішенні продовжували мутувати квіз-файл (`iterations`
 * росло і після підпису). Підписаний `ApprovalResponse` — термінальний акт
 * (mandates.md): жодна дія над цим `NNNN` після нього не пише файли.
 * @param {{readFile: (path: string) => Promise<string|null>}} io fs-транспорт
 * @param {string} decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} nnnn чотиризначний номер
 * @returns {Promise<void>}
 */
async function assertDecisionOpen(io, decisionsDir, nnnn) {
  const existingApproval = await io.readFile(approvalPath(decisionsDir, nnnn))
  if (existingApproval) {
    throw new Error(
      `decision ${nnnn}: рішення вже закрите підписаним approval — квіз більше не мутується ` +
        '(mandates.md: підписаний ApprovalResponse — термінальний акт)'
    )
  }
}

/**
 * Читає й розбирає decision-request за `NNNN`, обчислюючи глибину
 * квіз-гейта — кидає для глибин, яких M2 ще не реалізує (`teach-back`).
 * @param {{readFile: (path: string) => Promise<string|null>}} io fs-транспорт
 * @param {string} decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} nnnn чотиризначний номер
 * @returns {Promise<{decisionRequest: object, depth: 'one-tap'|'standard'}>} decision-request + глибина
 */
async function loadSupportedDecisionRequest(io, decisionsDir, nnnn) {
  const path = decisionRequestPath(decisionsDir, nnnn)
  const text = await io.readFile(path)
  if (!text) throw new Error(`decision-request не знайдено: ${path}`)
  const decisionRequest = parseDecisionRequest(text, { path, nnnn })
  const depth = depthForFacets(decisionRequest.leverageFacets)
  if (!SUPPORTED_DEPTHS.has(depth)) {
    throw new Error(
      `decision ${nnnn}: глибина «${depth}» ще не реалізована (лише one-tap/standard — ` +
        'docs/specs/260809-delta-app.md, «Обсяг M2»)'
    )
  }
  return { decisionRequest, depth }
}

/**
 * Домен розвилки для бази знань — `decisionRequest.decisionType`
 * (`decisions.js`), або `'general'`, коли decision-request його не несе
 * (власне розширення M2, decisionRequest.decisionType не з контракту mt).
 * @param {object} decisionRequest розібраний decision-request
 * @returns {string} домен
 */
function domainOf(decisionRequest) {
  return decisionRequest.decisionType ?? 'general'
}

const EXPLAIN_HEADINGS = { 1: 'Контекст', 2: 'Наслідки варіантів', 3: 'Рекомендація агента' }

/**
 * Навчальний режим при фейлі («право на глибину» — docs/specs/
 * 260809-delta-app.md, «Обсяг M2», п.3): розгортає decision-request шар за
 * шаром, КУМУЛЯТИВНО з кожним наступним фейлом того самого питання —
 * 1-й фейл повертає лише `## Контекст`; 2-й — і контекст, і наслідки всіх
 * варіантів; 3-й+ — і те, і те, і `## Рекомендація агента` з обґрунтуванням.
 * Гейт стелі на 3 — глибших шарів decision-request не має.
 * @param {object} decisionRequest розібраний decision-request
 * @param {number} failNumber номер щойно проваленої спроби ЦЬОГО питання (1-based)
 * @returns {{layer: number, heading: string, content: string}[]} накопичені шари контексту
 */
function layeredExplain(decisionRequest, failNumber) {
  const maxLayer = Math.min(failNumber, 3)
  const layers = []
  if (maxLayer >= 1) layers.push({ layer: 1, heading: EXPLAIN_HEADINGS[1], content: decisionRequest.context })
  if (maxLayer >= 2) {
    const content = decisionRequest.options.map(o => `${o.label}. ${o.title}\n${o.body}`).join('\n\n')
    layers.push({ layer: 2, heading: EXPLAIN_HEADINGS[2], content })
  }
  if (maxLayer >= 3) layers.push({ layer: 3, heading: EXPLAIN_HEADINGS[3], content: decisionRequest.recommendation })
  return layers
}

/**
 * @param {{question: string, options: string[], correctIndex: number, microlesson: string}} generated одне згенероване питання
 * @param {boolean} [repetition] чи це spaced-repetition-питання
 * @returns {{repetition: boolean, attempts: {question: string, options: string[], correctAnswer: string, microlesson: string}[]}}
 *   стан питання квізу з першою спробою
 */
function toQuestionState(generated, repetition = false) {
  return {
    repetition,
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
 * Гілка `decisionQuiz` для `depth: teach-back` (M5) — немає питання для
 * генерації (переказ вільний текст, LLM лише ОЦІНЮЄ його пізніше в
 * `submitTeachBack`), тому перший виклик просто пише порожню чернетку з
 * `shown_at` (старт «часу до розуміння») і повертає підказку-промпт; повторний
 * виклик показує ту саму підказку разом із фідбеком останньої НЕвдалої
 * спроби (навчальний режим М2 — «право на глибину» через `explain` дає
 * `submitTeachBack`, тут лише короткий feedback моделі).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.path абсолютний шлях до `NNNN-quiz.md`
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.domain домен розвилки
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{quizPath: string, depth: 'teach-back', prompt: string, iterations: number,
 *   generatedBy: string, domain: string, lastFeedback: string|null, missingAspects: string[]}>} підказка teach-back
 */
async function decisionQuizTeachBack({ io, path, nnnn, domain, now }) {
  const existingText = await io.readFile(path)
  if (existingText) {
    const state = parseTeachBackFile(existingText)
    const lastAttempt = state.attempts.at(-1) ?? null
    const failed = lastAttempt && lastAttempt.evaluation.understood === false
    return {
      quizPath: path,
      depth: 'teach-back',
      prompt: teachBackPromptText(),
      iterations: state.iterations ?? 0,
      generatedBy: state.generatedBy,
      domain,
      lastFeedback: failed ? lastAttempt.evaluation.feedback : null,
      missingAspects: failed ? lastAttempt.evaluation.missingAspects : []
    }
  }

  const shownAt = (now ? now() : new Date()).toISOString()
  const draft = { decisionRef: `${nnnn}-decision-request.md`, generatedBy: 'teach-back-prompt', shownAt, iterations: 0, attempts: [] }
  await io.writeFile(path, formatTeachBackFile(draft))
  return {
    quizPath: path,
    depth: 'teach-back',
    prompt: teachBackPromptText(),
    iterations: 0,
    generatedBy: 'teach-back-prompt',
    domain,
    lastFeedback: null,
    missingAspects: []
  }
}

/**
 * Генерує (при першому виклику) або показує (при повторному) активне
 * питання квізу для обраного варіанта — `delta`-tool `decision_quiz`.
 * `depth: standard` генерує 2 питання про саму розвилку; `depth: one-tap`
 * підмішує друге питання зі spaced-repetition бази знань, якщо інтервал
 * домену настав (п.5 конституції) — інакше лишається одним питанням.
 * `depth: teach-back` (M5) делегує {@link decisionQuizTeachBack}.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.chosenOption обраний варіант decision-request (label)
 * @param {{baseUrl: string, model: string}} [params.llmConfig] адреса й модель LLM-ендпоінта
 * @param {typeof fetch} [params.fetchImpl] ін'єкція fetch (тести)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @param {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} [params.knowledgeIo] io бази знань
 * @returns {Promise<{quizPath: string, question: string, options: string[], depth: string, iterations: number,
 *   generatedBy: string, questionIndex: number, questionCount: number, repetition: boolean, domain: string}>}
 *   активне питання квізу — без розкриття правильної відповіді
 */
export async function decisionQuiz({ io, decisionsDir, nnnn, chosenOption, llmConfig, fetchImpl, now, knowledgeIo }) {
  await assertDecisionOpen(io, decisionsDir, nnnn)
  const { decisionRequest, depth } = await loadSupportedDecisionRequest(io, decisionsDir, nnnn)
  const domain = domainOf(decisionRequest)
  const path = quizPath(decisionsDir, nnnn)
  if (depth === 'teach-back') return decisionQuizTeachBack({ io, path, nnnn, domain, now })
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
      repetition: Boolean(activeQuestion.repetition),
      domain
    }
  }

  const shownAt = (now ? now() : new Date()).toISOString()
  let generatedBy
  let questions
  if (depth === 'standard') {
    const generated = await generateStandardQuiz({ decisionRequest, chosenOption, llmConfig, fetchImpl })
    generatedBy = generated.generatedBy
    questions = generated.questions.map(q => toQuestionState(q))
  } else {
    const generated = await generateQuiz({ decisionRequest, chosenOption, llmConfig, fetchImpl })
    generatedBy = generated.generatedBy
    questions = [toQuestionState(generated)]
  }

  let repetitionSource = null
  if (REPETITION_ELIGIBLE_DEPTHS.has(depth)) {
    const knowledgeEntries = await loadKnowledgeEntries(knowledgeIo)
    const nowDate = now ? now() : new Date()
    const due = dueRepetition(knowledgeEntries, domain, nowDate)
    if (due) {
      questions.push({
        repetition: true,
        attempts: [{ question: due.question, options: due.options, correctAnswer: due.correctAnswer, microlesson: due.microlesson }]
      })
      repetitionSource = due.id
    }
  }

  const draft = {
    decisionRef: `${nnnn}-decision-request.md`,
    depth,
    generatedBy,
    shownAt,
    resolvedCount: 0,
    repetitionSource,
    iterations: questions.reduce((sum, q) => sum + q.attempts.length, 0),
    questions
  }
  await io.writeFile(path, formatQuizFile(draft))
  const activeAttempt = questions[0].attempts[0]
  return {
    quizPath: path,
    question: activeAttempt.question,
    options: activeAttempt.options,
    depth,
    iterations: draft.iterations,
    generatedBy,
    questionIndex: 1,
    questionCount: questions.length,
    repetition: false,
    domain
  }
}

/**
 * Проводить teach-back-спробу (M5): оцінює `transcript` локальною моделлю
 * ({@link callLlmTeachBackEvaluator}) проти decision-request. `understood:
 * false` — дописує спробу з фідбеком, `iterations++`, навчальний режим
 * («право на глибину» — {@link layeredExplain}, той самий інваріант, що
 * Q&A-квіз); `understood: true` — фіналізує teach-back-файл
 * (`time_to_understanding_sec`), дописує особисту базу знань, відкриває
 * шлях до підпису. Ендпоінт недоступний (`callLlmTeachBackEvaluator`
 * повертає `null`) — `available: false`, ЧЕСНА відмова
 * ({@link TEACHBACK_UNAVAILABLE_MESSAGE}): нічого не пишеться на диск
 * (спроба НЕ рахується — недоступність моделі не має коштувати iterations
 * власнику), рішення лишається відкритим.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.path абсолютний шлях до `NNNN-quiz.md`
 * @param {object} params.decisionRequest розібраний decision-request
 * @param {string} params.chosenOption обраний варіант (обов'язковий — оцінка teach-back звіряє переказ проти НЬОГО)
 * @param {string} params.transcript переказ власника своїми словами
 * @param {{baseUrl: string, model: string}} [params.llmConfig] адреса й модель LLM-ендпоінта
 * @param {typeof fetch} [params.fetchImpl] ін'єкція fetch (тести)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @param {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} [params.knowledgeIo] io бази знань
 * @param {string} params.existingText сирий вміст teach-back-квіз-файлу (вже прочитаний викликачем)
 * @returns {Promise<object>} результат спроби
 */
async function submitTeachBack({ io, path, decisionRequest, chosenOption, transcript, llmConfig, fetchImpl, now, knowledgeIo, existingText }) {
  if (typeof transcript !== 'string' || !transcript.trim()) {
    throw new Error('teach-back: потрібен непорожній transcript (переказ своїми словами) — decision_approve з полем transcript')
  }

  const domain = domainOf(decisionRequest)
  const state = parseTeachBackFile(existingText)
  const evaluation = await callLlmTeachBackEvaluator(llmConfig ?? defaultLlmConfig(), decisionRequest, chosenOption, transcript, fetchImpl)
  if (!evaluation) {
    return { correct: false, done: false, available: false, iterations: state.iterations ?? 0, message: TEACHBACK_UNAVAILABLE_MESSAGE, domain }
  }

  const attempts = [...state.attempts, { transcript, evaluation }]
  const iterations = attempts.length

  if (!evaluation.understood) {
    const draft = { decisionRef: state.decisionRef, generatedBy: evaluation.generatedBy, shownAt: state.shownAt, iterations, attempts }
    await io.writeFile(path, formatTeachBackFile(draft))
    return {
      correct: false,
      done: false,
      available: true,
      iterations,
      feedback: evaluation.feedback,
      missingAspects: evaluation.missingAspects,
      explain: layeredExplain(decisionRequest, iterations),
      domain
    }
  }

  const nowDate = now ? now() : new Date()
  const shownAtMs = state.shownAt ? Date.parse(state.shownAt) : Date.now()
  const timeToUnderstandingSec = Math.max(0, Math.round((nowDate.getTime() - shownAtMs) / 1000))
  const finalState = { decisionRef: state.decisionRef, generatedBy: evaluation.generatedBy, iterations, timeToUnderstandingSec, attempts }
  await io.writeFile(path, formatTeachBackFile(finalState))

  const baseEntries = await loadKnowledgeEntries(knowledgeIo)
  const withNewEntry = appendKnowledgeEntry(baseEntries, {
    decisionRef: state.decisionRef,
    domain,
    question: 'teach-back: переказ рішення власними словами',
    options: null,
    correctAnswer: null,
    microlesson: evaluation.feedback,
    iterations,
    timeToUnderstandingSec,
    completedAt: nowDate.toISOString()
  })
  await saveKnowledgeEntries(knowledgeIo, withNewEntry)

  return { correct: true, done: true, available: true, iterations, quiz: finalState, feedback: evaluation.feedback, domain }
}

/**
 * Проводить квіз-відповідь на АКТИВНЕ (перше нездане) питання квізу:
 * неправильна — дописує нову спробу того самого питання (перефразовану
 * LLM-ом, якщо `llmConfig`/`fetchImpl` і `chosenOption` дано й ендпоінт
 * живий — інакше те саме формулювання), `iterations++`, повертає мікроурок
 * і навчальний режим («право на глибину» — розгортання decision-request шар
 * за шаром, накопичувально з кожним наступним фейлом цього питання);
 * правильна — або переходить до НАСТУПНОГО питання квізу (`done: false`,
 * підпис ще недоступний), або, якщо це було останнє питання, фіналізує
 * квіз-файл (`iterations`, `time_to_understanding_sec`, `done: true`),
 * дописує запис у базу знань і відкриває шлях до підпису.
 * `depth: teach-back` (M5) делегує {@link submitTeachBack} — інша форма
 * входу (`transcript`, не `answer`) і результату (`available`, `feedback`,
 * `missingAspects`, не `options`/`questionIndex`).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.nnnn чотиризначний номер
 * @param {number|string} [params.answer] індекс (0-based) або точний текст обраної відповіді (Q&A-глибини)
 * @param {string} [params.transcript] переказ власника своїми словами (`depth: teach-back`)
 * @param {string} [params.chosenOption] обраний варіант decision-request (перефразування на ретраї Q&A; ОБОВ'ЯЗКОВИЙ для teach-back)
 * @param {{baseUrl: string, model: string}} [params.llmConfig] адреса й модель LLM-ендпоінта
 * @param {typeof fetch} [params.fetchImpl] ін'єкція fetch (тести)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @param {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} [params.knowledgeIo] io бази знань
 * @returns {Promise<object>} результат спроби (форма різна для `correct`/`done`/`depth` — див. тіло функції)
 */
export async function submitQuizAnswer({ io, decisionsDir, nnnn, answer, transcript, chosenOption, llmConfig, fetchImpl, now, knowledgeIo }) {
  await assertDecisionOpen(io, decisionsDir, nnnn)
  const path = quizPath(decisionsDir, nnnn)
  const existingText = await io.readFile(path)
  if (!existingText) throw new Error(`квіз для ${nnnn} ще не згенеровано — виклич decision_quiz спершу`)

  const { decisionRequest, depth } = await loadSupportedDecisionRequest(io, decisionsDir, nnnn)
  if (depth === 'teach-back') {
    return submitTeachBack({ io, path, decisionRequest, chosenOption, transcript, llmConfig, fetchImpl, now, knowledgeIo, existingText })
  }

  const quiz = parseQuizFile(existingText)
  const domain = domainOf(decisionRequest)

  const resolvedCount = quiz.resolvedCount ?? 0
  // Клон питань перед мутацією — quiz.questions belongs to цьому виклику,
  // не спільний стан між викликами (кожен виклик читає свіжий текст файлу).
  const questions = quiz.questions.map(q => ({ ...q, attempts: [...q.attempts] }))
  const activeQuestion = questions[resolvedCount]
  const lastAttempt = activeQuestion.attempts.at(-1)
  const answerIndex = typeof answer === 'number' ? answer : lastAttempt.options.indexOf(answer)
  const correctIndex = lastAttempt.options.indexOf(lastAttempt.correctAnswer)
  const correct = answerIndex !== -1 && answerIndex === correctIndex
  const totalAttemptsSoFar = questions.reduce((sum, q) => sum + q.attempts.length, 0)

  if (!correct) {
    const failNumber = activeQuestion.attempts.length
    let questionText = lastAttempt.question
    // Перефразування — лише для питання про САМУ розвилку (repetition-питання
    // стосується ІНШОЇ, вже закритої розвилки — decisionRequest тут не про
    // неї, перефразування на його основі було б семантично хибним).
    if (!activeQuestion.repetition && chosenOption && (llmConfig || fetchImpl)) {
      const rephrased = await rephraseQuestion({ llmConfig, decisionRequest, chosenOption, previousQuestion: lastAttempt.question, fetchImpl })
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
      repetitionSource: quiz.repetitionSource,
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
      explain: activeQuestion.repetition ? null : layeredExplain(decisionRequest, failNumber),
      domain,
      questionIndex: resolvedCount + 1,
      questionCount: questions.length,
      repetition: Boolean(activeQuestion.repetition)
    }
  }

  const nowDate = now ? now() : new Date()
  let knowledgeEntries = null
  if (activeQuestion.repetition && quiz.repetitionSource) {
    const entries = await loadKnowledgeEntries(knowledgeIo)
    knowledgeEntries = recordRepetitionAnswer(entries, quiz.repetitionSource, true, nowDate)
  }

  const newResolvedCount = resolvedCount + 1
  if (newResolvedCount < questions.length) {
    const draft = {
      decisionRef: quiz.decisionRef,
      depth: quiz.depth,
      generatedBy: quiz.generatedBy,
      shownAt: quiz.shownAt,
      repetitionSource: quiz.repetitionSource,
      resolvedCount: newResolvedCount,
      iterations: totalAttemptsSoFar,
      questions
    }
    await io.writeFile(path, formatQuizFile(draft))
    if (knowledgeEntries) await saveKnowledgeEntries(knowledgeIo, knowledgeEntries)
    const nextQuestion = questions[newResolvedCount]
    const nextAttempt = nextQuestion.attempts.at(-1)
    return {
      correct: true,
      done: false,
      iterations: draft.iterations,
      // Мікроурок ЩОЙНО відповіданого питання — показ після будь-якої
      // відповіді (М2 п.2), не лише фінальної.
      microlesson: lastAttempt.microlesson,
      domain,
      nextQuestion: {
        question: nextAttempt.question,
        options: nextAttempt.options,
        questionIndex: newResolvedCount + 1,
        questionCount: questions.length,
        repetition: Boolean(nextQuestion.repetition)
      }
    }
  }

  // Останнє питання квізу здано правильно — фіналізація.
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

  const primaryAttempt = questions[0].attempts.at(-1)
  const baseEntries = knowledgeEntries ?? (await loadKnowledgeEntries(knowledgeIo))
  const withNewEntry = appendKnowledgeEntry(baseEntries, {
    decisionRef: quiz.decisionRef,
    domain,
    question: primaryAttempt.question,
    options: primaryAttempt.options,
    correctAnswer: primaryAttempt.correctAnswer,
    microlesson: primaryAttempt.microlesson,
    iterations: finalQuiz.iterations,
    timeToUnderstandingSec,
    completedAt: nowDate.toISOString()
  })
  await saveKnowledgeEntries(knowledgeIo, withNewEntry)

  return {
    correct: true,
    done: true,
    iterations: finalQuiz.iterations,
    quiz: finalQuiz,
    // Мікроурок ЩОЙНО відповіданого (останнього) питання — може відрізнятися
    // від primaryAttempt.microlesson, коли квіз має >1 питання (standard,
    // spaced-repetition): база знань записує PRIMARY-питання, показ у GUI —
    // те, що людина щойно бачила.
    microlesson: lastAttempt.microlesson,
    domain
  }
}

/**
 * Повний потік `decision_approve`: проводить квіз-відповідь, і лише коли
 * ВСІ питання квізу здано правильно (`submitQuizAnswer` → `done: true`) —
 * підписує й пише `NNNN-approval.json`. Неправильна відповідь повертає
 * мікроурок і навчальний режим без підпису; правильна відповідь на
 * НЕостаннє питання квізу повертає наступне питання (`done: false`) —
 * підпис лишається недоступним, доки квіз не здано повністю (інваріант:
 * без завершеного квізу approval не пишеться).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт decisions/
 * @param {string} params.decisionsDir абсолютний шлях до директорії `decisions/`
 * @param {string} params.runId run-id (для `request_id`)
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.chosenOption обраний варіант decision-request (label)
 * @param {number|string} [params.answer] квіз-відповідь (індекс або текст, Q&A-глибини)
 * @param {string} [params.transcript] переказ власника своїми словами (`depth: teach-back`, M5)
 * @param {{privateKeyJwk: object, publicKeyBase64: string}} params.deviceKey ключ пристрою підписанта
 * @param {{baseUrl: string, model: string}} [params.llmConfig] адреса й модель LLM-ендпоінта (перефразування на ретраї / teach-back-оцінка)
 * @param {typeof fetch} [params.fetchImpl] ін'єкція fetch (тести)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @param {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} [params.knowledgeIo] io бази знань
 * @returns {Promise<object>} результат — `{approved, correct, done, iterations, ...}` (`available: false` — teach-back недоступний, ЧЕСНА відмова)
 */
export async function decisionApprove({
  io,
  decisionsDir,
  runId,
  nnnn,
  chosenOption,
  answer,
  transcript,
  deviceKey,
  llmConfig,
  fetchImpl,
  now,
  knowledgeIo
}) {
  const result = await submitQuizAnswer({ io, decisionsDir, nnnn, answer, transcript, chosenOption, llmConfig, fetchImpl, now, knowledgeIo })
  if (result.available === false) {
    return { approved: false, correct: false, done: false, available: false, iterations: result.iterations, message: result.message, domain: result.domain }
  }
  if (!result.correct) {
    return {
      approved: false,
      correct: false,
      done: false,
      iterations: result.iterations,
      microlesson: result.microlesson,
      explain: result.explain,
      domain: result.domain,
      questionIndex: result.questionIndex,
      questionCount: result.questionCount,
      repetition: result.repetition,
      feedback: result.feedback,
      missingAspects: result.missingAspects
    }
  }
  if (!result.done) {
    return {
      approved: false,
      correct: true,
      done: false,
      iterations: result.iterations,
      microlesson: result.microlesson,
      domain: result.domain,
      nextQuestion: result.nextQuestion
    }
  }

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
  const approvalFilePath = approvalPath(decisionsDir, nnnn)
  await io.writeFile(approvalFilePath, formatApprovalFile(approval))
  return {
    approved: true,
    correct: true,
    done: true,
    iterations: result.iterations,
    approval,
    approvalPath: approvalFilePath,
    microlesson: result.microlesson,
    feedback: result.feedback,
    domain: result.domain
  }
}
