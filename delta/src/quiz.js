// Квіз-генератор (one-tap + standard) і формат квіз-файлів — контракт mt:
// mt/docs/architecture/mandates.md, «Квіз-гейт: підпис із доведеним
// розумінням». M1 реалізувала лише `depth: one-tap` (одне контрольне
// питання); M2 додає `standard` (2 питання, docs/specs/260809-delta-app.md,
// «Обсяг M2», п.6) — `teach-back` лишається M5.
//
// Джерело питання — локальний OpenAI-сумісний ендпоінт (адреса/модель —
// конфіг, не константа: `.mt`-незалежний `config.json` застосунку, той
// самий, що `identity`/`mandates_dir`). Ендпоінт недоступний → детермінований
// фолбек, зібраний із самого тіла decision-request; квіз ніколи не
// пропускається (інваріант конституції п.2 — «фейл ≠ покарання», не
// «квіз ≠ обовʼязковий»).
//
// M2 (п.2 конституції — «квіз насамперед навчання»): мікроурок генерується
// LLM РАЗОМ із питанням (уже було в M1 — SYSTEM_PROMPT нижче), але тепер
// показується ПІСЛЯ будь-якої відповіді (правильної теж), не лише
// неправильної — decision-flow.js завжди повертає `microlesson`, незалежно
// від `correct`. Формат квіз-файлу (`formatQuizFile`/`parseQuizFile`)
// узагальнено на кілька питань в одному квізі — і для `depth: standard`
// (2-3 питання про саму розвилку), і для spaced-repetition-«Питання N
// (повторення)» (п.5 конституції), підмішаного до one-tap квізу нової
// розвилки з бази знань (`src/knowledge.js`).

const DEFAULT_LLM_CONFIG = Object.freeze({ baseUrl: 'http://127.0.0.1:8080', model: 'gemma-4-26b-a4b-it' })

const SYSTEM_PROMPT =
  'Ти — генератор квіз-гейтів для системи «Дельта» (mt mandates.md). ' +
  'Твоя робота відокремлена від агента, що готував рекомендацію (конфлікт інтересів у промпті) — ' +
  'не повторюй рекомендацію, перевіряй розуміння НАСЛІДКІВ обраного варіанта. ' +
  'Поверни СТРОГО JSON без пояснень поза ним: ' +
  '{"question": string, "options": [string, string, string], "correctIndex": 0|1|2, "microlesson": string}. ' +
  'question — одне контрольне питання про наслідки обраного варіанта; ' +
  'options — рівно 3 варіанти відповіді, лише один правильний (correctIndex); ' +
  'microlesson — 2-3 речення «що ще варто знати», не сама відповідь, а контекст навколо неї.'

/**
 * @returns {{baseUrl: string, model: string}} дефолтний конфіг локального LLM-ендпоінта
 */
export function defaultLlmConfig() {
  return { ...DEFAULT_LLM_CONFIG }
}

/**
 * Формує user-промпт із тіла decision-request і обраного варіанта.
 * @param {object} decisionRequest розібраний decision-request (decisions.js)
 * @param {string} chosenOption обраний варіант (label, напр. `'B'`)
 * @returns {string} промпт
 */
export function buildQuizPrompt(decisionRequest, chosenOption) {
  const chosen = decisionRequest.options.find(o => o.label === chosenOption)
  const chosenTitleSuffix = chosen ? ` — ${chosen.title}` : ''
  const optionsText = decisionRequest.options.map(o => `### ${o.label}. ${o.title}\n${o.body}`).join('\n\n')
  return [
    `## Контекст\n${decisionRequest.context}`,
    `## Варіанти\n${optionsText}`,
    `## Обраний варіант\n${chosenOption}${chosenTitleSuffix}`,
    `## Рекомендація агента (лише для контексту, НЕ повторюй її як питання)\n${decisionRequest.recommendation}`
  ].join('\n\n')
}

/**
 * Валідує сирий JSON-payload від LLM за очікуваною формою
 * `{question, options[3], correctIndex, microlesson}`.
 * @param {unknown} payload розпарсений JSON
 * @returns {boolean} true — форма валідна
 */
function isValidLlmPayload(payload) {
  return Boolean(
    payload &&
    typeof payload.question === 'string' &&
    payload.question.trim() &&
    Array.isArray(payload.options) &&
    payload.options.length === 3 &&
    payload.options.every(o => typeof o === 'string' && o.trim()) &&
    Number.isSafeInteger(payload.correctIndex) &&
    payload.correctIndex >= 0 &&
    payload.correctIndex <= 2 &&
    typeof payload.microlesson === 'string' &&
    payload.microlesson.trim()
  )
}

/**
 * Викликає локальний OpenAI-сумісний ендпоінт для генерації квіз-питання.
 * Мережева/парсингова помилка, неочікувана форма відповіді, чи недоступний
 * ендпоінт — повертає `null` (не кидає): виклик тримає фолбек як штатний,
 * не винятковий шлях («квіз ніколи не пропускається»).
 * @param {{baseUrl: string, model: string}} llmConfig адреса й модель ендпоінта
 * @param {object} decisionRequest розібраний decision-request
 * @param {string} chosenOption обраний варіант
 * @param {typeof fetch} [fetchImpl] ін'єкція fetch (тести мокають мережу)
 * @returns {Promise<{question: string, options: string[], correctIndex: number, microlesson: string, generatedBy: string}|null>}
 *   згенерований квіз, або `null` — ендпоінт недоступний/відповідь невалідна
 */
export async function callLlmQuizGenerator(llmConfig, decisionRequest, chosenOption, fetchImpl = fetch) {
  const config = llmConfig ?? defaultLlmConfig()
  try {
    const response = await fetchImpl(`${config.baseUrl.replace(TRAILING_SLASH_RE, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildQuizPrompt(decisionRequest, chosenOption) }
        ]
      })
    })
    if (!response.ok) return null
    const data = await response.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') return null
    const parsed = JSON.parse(raw)
    if (!isValidLlmPayload(parsed)) return null
    return {
      question: parsed.question.trim(),
      options: parsed.options.map(o => o.trim()),
      correctIndex: parsed.correctIndex,
      microlesson: parsed.microlesson.trim(),
      generatedBy: `quiz-gen-${config.model}`
    }
  } catch {
    return null
  }
}

/**
 * Детермінований фолбек-генератор (ендпоінт недоступний): питання й варіанти
 * будуються з самих варіантів decision-request, без LLM. Правильна відповідь
 * — заголовок+тіло обраного варіанта; дистрактори — інші варіанти файлу
 * (доповнені нейтральним «жоден з наслідків вище», якщо варіантів < 2).
 * @param {object} decisionRequest розібраний decision-request
 * @param {string} chosenOption обраний варіант
 * @returns {{question: string, options: string[], correctIndex: number, microlesson: string, generatedBy: string}} фолбек-квіз
 */
export function fallbackQuiz(decisionRequest, chosenOption) {
  const chosen = decisionRequest.options.find(o => o.label === chosenOption)
  const chosenText = chosen ? `${chosen.title} — ${chosen.body}`.trim() : `варіант ${chosenOption}`
  const distractors = decisionRequest.options
    .filter(o => o.label !== chosenOption)
    .map(o => `${o.title} — ${o.body}`.trim())
    .slice(0, 2)
  while (distractors.length < 2) distractors.push('Жоден із перелічених наслідків не застосовується')

  const options = [chosenText, ...distractors]
  // Детермінований, але не завжди на позиції 0 — обертаємо масив на основі
  // довжини decision-request-контексту (стабільно відтворювано з тих самих
  // вхідних даних, без Math.random — квіз-фолбек не має бути флейкі в тестах).
  const rotation = (decisionRequest.context?.length ?? 0) % options.length
  const rotated = [...options.slice(rotation), ...options.slice(0, rotation)]
  const correctIndex = rotated.indexOf(chosenText)

  return {
    question: `Який наслідок у варіанта ${chosenOption}, якщо його обрати?`,
    options: rotated,
    correctIndex,
    microlesson:
      `Мікроурок: рішення застосовується до decision-request «${decisionRequest.path ?? decisionRequest.nnnn}» ` +
      `(escalation_chain: ${decisionRequest.escalationChain.join(' → ') || 'н/д'}); ` +
      `deadline_cost: ${decisionRequest.deadlineCost ?? 'не вказано'}.`,
    generatedBy: 'quiz-gen-fallback'
  }
}

/**
 * Генерує one-tap квіз для обраного варіанта: спершу LLM, потім фолбек.
 * Валідує інваріант `generated_by ≠ recommended_by` (mandates.md,
 * «конфлікт інтересів у промпті») — якщо LLM-ідентифікатор моделі якимось
 * чином збігся з рекомендувальником, примусово переходить на фолбек.
 * @param {{decisionRequest: object, chosenOption: string, llmConfig?: {baseUrl: string, model: string}, fetchImpl?: typeof fetch}} params вхідні параметри
 * @returns {Promise<{question: string, options: string[], correctIndex: number, microlesson: string, generatedBy: string}>} згенерований квіз
 */
export async function generateQuiz({ decisionRequest, chosenOption, llmConfig, fetchImpl }) {
  let quiz = await callLlmQuizGenerator(llmConfig ?? defaultLlmConfig(), decisionRequest, chosenOption, fetchImpl)
  if (!quiz || quiz.generatedBy === decisionRequest.recommendedBy) {
    quiz = fallbackQuiz(decisionRequest, chosenOption)
  }
  if (quiz.generatedBy === decisionRequest.recommendedBy) {
    throw new Error('generated_by квізу збігається з recommended_by decision-request — інваріант порушено')
  }
  return quiz
}

const SYSTEM_PROMPT_STANDARD =
  'Ти — генератор квіз-гейтів для системи «Дельта» (mt mandates.md), режим STANDARD (глибина decide-and-inform: ' +
  'середні leverage-фасети, лише reversible). Твоя робота відокремлена від агента, що готував рекомендацію ' +
  '(конфлікт інтересів у промпті) — не повторюй рекомендацію, перевіряй розуміння НАСЛІДКІВ обраного варіанта ' +
  'з РІЗНИХ боків (не переказ, а 2 незалежні контрольні питання). ' +
  'Поверни СТРОГО JSON без пояснень поза ним: {"questions": [' +
  '{"question": string, "options": [string, string, string], "correctIndex": 0|1|2, "microlesson": string}, ' +
  '{"question": string, "options": [string, string, string], "correctIndex": 0|1|2, "microlesson": string}' +
  ']} — рівно 2 питання, кожне про інший аспект наслідків (напр. перше — сам наслідок вибору, друге — ' +
  'ціна помилки/дедлайну чи межа наслідків).'

const REPHRASE_SYSTEM_PROMPT =
  'Ти переформульовуєш формулювання КОНТРОЛЬНОГО питання квіз-гейта системи «Дельта» після неправильної ' +
  'відповіді — той самий сенс і ті самі варіанти відповіді (не міняй, що правильно), інше формулювання, щоб ' +
  'людина читала питання свіжим поглядом, а не впізнавала попередній текст. Поверни СТРОГО текст нового ' +
  'питання, без лапок і без пояснень поза ним.'

/**
 * Валідує один елемент масиву `questions` LLM-відповіді режиму standard —
 * та сама форма, що {@link isValidLlmPayload}, без поля `microlesson`
 * необов'язковості (тут воно так само обов'язкове).
 * @param {unknown} q один елемент масиву `questions`
 * @returns {boolean} true — форма валідна
 */
function isValidQuestionPayload(q) {
  return isValidLlmPayload(q)
}

/**
 * Викликає локальний ендпоінт у режимі `standard` (2 питання одним
 * викликом) — той самий контракт помилок, що {@link callLlmQuizGenerator}:
 * мережева/парсингова помилка чи невалідна форма повертає `null`, не кидає.
 * @param {{baseUrl: string, model: string}} llmConfig адреса й модель ендпоінта
 * @param {object} decisionRequest розібраний decision-request
 * @param {string} chosenOption обраний варіант
 * @param {typeof fetch} [fetchImpl] ін'єкція fetch (тести)
 * @returns {Promise<{questions: {question: string, options: string[], correctIndex: number, microlesson: string}[], generatedBy: string}|null>}
 *   згенеровані 2 питання, або `null`
 */
export async function callLlmStandardQuizGenerator(llmConfig, decisionRequest, chosenOption, fetchImpl = fetch) {
  const config = llmConfig ?? defaultLlmConfig()
  try {
    const response = await fetchImpl(`${config.baseUrl.replace(TRAILING_SLASH_RE, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT_STANDARD },
          { role: 'user', content: buildQuizPrompt(decisionRequest, chosenOption) }
        ]
      })
    })
    if (!response.ok) return null
    const data = await response.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.questions) || parsed.questions.length < 2 || parsed.questions.length > 3) return null
    if (parsed.questions.some(q => !isValidQuestionPayload(q))) return null
    return {
      questions: parsed.questions.map(q => ({
        question: q.question.trim(),
        options: q.options.map(o => o.trim()),
        correctIndex: q.correctIndex,
        microlesson: q.microlesson.trim()
      })),
      generatedBy: `quiz-gen-${config.model}`
    }
  } catch {
    return null
  }
}

/**
 * Детермінований фолбек другого standard-питання — про `deadline_cost`
 * (якщо є) або `blast_radius` (інакше): інший бік наслідків, ніж перше
 * питання ({@link fallbackQuiz} — про сам обраний варіант), той самий
 * підхід «без LLM, з полів decision-request», що фолбек M1.
 * @param {object} decisionRequest розібраний decision-request
 * @returns {{question: string, options: string[], correctIndex: number, microlesson: string}} друге фолбек-питання
 */
function fallbackSecondaryQuestion(decisionRequest) {
  if (decisionRequest.deadlineCost) {
    const distractors = ['Дедлайн не критичний — розвилка нічого не блокує', 'Розвилка не має встановленого дедлайну']
    const options = [decisionRequest.deadlineCost, ...distractors]
    const rotation = decisionRequest.deadlineCost.length % options.length
    const rotated = [...options.slice(rotation), ...options.slice(0, rotation)]
    return {
      question: 'Яка ціна затримки цієї розвилки (deadline_cost)?',
      options: rotated,
      correctIndex: rotated.indexOf(decisionRequest.deadlineCost),
      microlesson:
        'Мікроурок: deadline_cost — контрактне поле decision-request (mandates.md), не оцінка агента; ' +
        'разом із leverage-фасетами воно визначає пріоритет розвилки в черзі «Вирішую».'
    }
  }
  const radii = ['node', 'subtree', 'repo', 'company']
  const actual = decisionRequest.leverageFacets.blastRadius
  const distractors = radii.filter(r => r !== actual).slice(0, 2)
  const options = [actual, ...distractors]
  const rotation = actual.length % options.length
  const rotated = [...options.slice(rotation), ...options.slice(0, rotation)]
  return {
    question: 'Який blast_radius (межа наслідків) цієї розвилки?',
    options: rotated,
    correctIndex: rotated.indexOf(actual),
    microlesson:
      'Мікроурок: blast_radius — один із leverage-фасетів (mandates.md), що визначає ширину наслідків рішення ' +
      'і саме він (разом з irreversible/divergence/est_cost_eur) визначив глибину цього квіз-гейта.'
  }
}

/**
 * Детермінований фолбек-генератор режиму `standard` (2 питання, ендпоінт
 * недоступний): перше — {@link fallbackQuiz} (наслідок обраного варіанта),
 * друге — {@link fallbackSecondaryQuestion} (ціна/межа наслідків) — різні
 * боки розвилки, той самий інваріант «квіз ніколи не пропускається».
 * @param {object} decisionRequest розібраний decision-request
 * @param {string} chosenOption обраний варіант
 * @returns {{questions: {question: string, options: string[], correctIndex: number, microlesson: string}[], generatedBy: string}} фолбек-квіз
 */
export function fallbackStandardQuiz(decisionRequest, chosenOption) {
  const first = fallbackQuiz(decisionRequest, chosenOption)
  const second = fallbackSecondaryQuestion(decisionRequest)
  return {
    questions: [
      { question: first.question, options: first.options, correctIndex: first.correctIndex, microlesson: first.microlesson },
      { question: second.question, options: second.options, correctIndex: second.correctIndex, microlesson: second.microlesson }
    ],
    generatedBy: 'quiz-gen-fallback'
  }
}

/**
 * Генерує `depth: standard` квіз (2 питання) для обраного варіанта: спершу
 * LLM, потім фолбек — той самий `generated_by ≠ recommended_by` інваріант,
 * що {@link generateQuiz} (one-tap).
 * @param {{decisionRequest: object, chosenOption: string, llmConfig?: {baseUrl: string, model: string}, fetchImpl?: typeof fetch}} params вхідні параметри
 * @returns {Promise<{questions: {question: string, options: string[], correctIndex: number, microlesson: string}[], generatedBy: string}>}
 *   згенерований квіз (2 питання)
 */
export async function generateStandardQuiz({ decisionRequest, chosenOption, llmConfig, fetchImpl }) {
  let quiz = await callLlmStandardQuizGenerator(llmConfig ?? defaultLlmConfig(), decisionRequest, chosenOption, fetchImpl)
  if (!quiz || quiz.generatedBy === decisionRequest.recommendedBy) {
    quiz = fallbackStandardQuiz(decisionRequest, chosenOption)
  }
  if (quiz.generatedBy === decisionRequest.recommendedBy) {
    throw new Error('generated_by квізу збігається з recommended_by decision-request — інваріант порушено')
  }
  return quiz
}

/**
 * Перефразовує формулювання питання для повторного заходу після
 * неправильної відповіді («Повторне питання після кожного шару... те саме
 * або перефразоване LLM-ом, якщо ендпоінт живий» — docs/specs/
 * 260809-delta-app.md, «Обсяг M2», п.3). Best-effort: мережева помилка,
 * недоступний ендпоінт, порожня чи незмінена відповідь — повертає `null`,
 * викликач лишає попередній текст питання (варіанти/правильна відповідь
 * НІКОЛИ не міняються перефразуванням — лише текст самого питання).
 * @param {object} params вхідні параметри
 * @param {{baseUrl: string, model: string}} [params.llmConfig] адреса й модель ендпоінта
 * @param {object} params.decisionRequest розібраний decision-request
 * @param {string} params.chosenOption обраний варіант
 * @param {string} params.previousQuestion попереднє формулювання питання
 * @param {typeof fetch} [params.fetchImpl] ін'єкція fetch (тести)
 * @returns {Promise<string|null>} нове формулювання, або `null` — лишити попереднє
 */
export async function rephraseQuestion({ llmConfig, decisionRequest, chosenOption, previousQuestion, fetchImpl = fetch }) {
  const config = llmConfig ?? defaultLlmConfig()
  try {
    const response = await fetchImpl(`${config.baseUrl.replace(TRAILING_SLASH_RE, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: REPHRASE_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `${buildQuizPrompt(decisionRequest, chosenOption)}\n\n## Попереднє формулювання питання\n${previousQuestion}`
          }
        ]
      })
    })
    if (!response.ok) return null
    const data = await response.json()
    const raw = data?.choices?.[0]?.message?.content
    const text = typeof raw === 'string' ? raw.trim().replaceAll(/^"|"$/g, '') : ''
    if (!text || text === previousQuestion) return null
    return text
  } catch {
    return null
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
const HEADING_RE = /^## Питання (\d+)(?: \(([^)]*)\))?$/
const ATTEMPT_NUM_RE = /спроба (\d+)/
const NEWLINE_RE = /\r?\n/
const QUESTION_BLOCK_SPLIT_RE = /\r?\n(?=## Питання)/
const OPTION_LINE_RE = /^- [A-Z]\.\s(.*)$/gm
const ANSWER_SECTION_RE = /### Відповідь\r?\n([\s\S]*?)(?:\r?\n### Мікроурок|$)/
const MICROLESSON_SECTION_RE = /### Мікроурок\r?\n([\s\S]*?)$/
const QUESTION_TEXT_RE = /^([\s\S]*?)(?:\r?\n\r?\n- [A-Z]\.|\r?\n\r?\n### Відповідь)/
const TRAILING_SLASH_RE = /\/$/

/**
 * Будує заголовок одного блоку-спроби: `## Питання N`, `## Питання N
 * (повторення)` (перша спроба spaced-repetition-питання), `## Питання N
 * (спроба K)` (повторний захід звичайного питання), або `## Питання N
 * (повторення, спроба K)` (повторний захід repetition-питання) — «фейл ≠
 * покарання»: номер питання не змінюється, змінюється лише лічильник спроби.
 * @param {number} questionIndex 1-based номер питання в квізі
 * @param {number} attemptIndex 0-based номер спроби ЦЬОГО питання
 * @param {boolean} repetition чи це spaced-repetition-питання (п.5 конституції)
 * @returns {string} заголовок `## Питання ...`
 */
function formatHeading(questionIndex, attemptIndex, repetition) {
  const parts = []
  if (repetition) parts.push('повторення')
  if (attemptIndex > 0) parts.push(`спроба ${attemptIndex + 1}`)
  return parts.length ? `## Питання ${questionIndex} (${parts.join(', ')})` : `## Питання ${questionIndex}`
}

/**
 * Серіалізує квіз-стан у markdown точно за форматом mandates.md
 * (`schema_version` перше поле). Приймає або legacy-форму (`attempts` —
 * єдине питання, той самий формат, що M1) або узагальнену `questions`
 * (масив питань квізу — `depth: standard`, і/або підмішане spaced-repetition
 * «Питання N (повторення)»); `attempts` без `questions` трактується як одне
 * питання без повторення — байтово той самий вихід, що M1 (backward-compat).
 * @param {{decisionRef: string, depth: string, generatedBy: string, iterations: number,
 *   timeToUnderstandingSec?: number|null, shownAt?: string|null,
 *   resolvedCount?: number|null, repetitionSource?: string|null,
 *   attempts?: {question: string, options: string[], correctAnswer: string, microlesson: string}[],
 *   questions?: {repetition?: boolean, attempts: {question: string, options: string[], correctAnswer: string, microlesson: string}[]}[]
 * }} quiz квіз-стан
 * @returns {string} markdown-текст квіз-файлу
 */
export function formatQuizFile(quiz) {
  const lines = [
    '---',
    'schema_version: 1',
    'type: quiz',
    `decision_ref: ${quiz.decisionRef}`,
    `depth: ${quiz.depth}`,
    `generated_by: ${quiz.generatedBy}`
  ]
  // `shown_at`/`repetition_source`/`resolved_count` — недокументовані
  // контрактом поля, присутні ЛИШЕ в чернетці (до фіксації підписом):
  // `shown_at` — момент показу першого питання (для `time_to_understanding_sec`
  // між процесами stateless CLI-викликів); `repetition_source` — `id` запису
  // бази знань, звідки взято spaced-repetition-питання (для оновлення
  // інтервалу після відповіді); `resolved_count` — скільки ЛІДИРУЮЧИХ питань
  // квізу вже здано правильно (наступне — активне). Фіналізація
  // (decision-flow.js: submitQuizAnswer на останній правильній відповіді)
  // ніколи не передає ці поля — вони зникають з файлу разом із чернеткою.
  if (quiz.shownAt) lines.push(`shown_at: ${quiz.shownAt}`)
  if (quiz.repetitionSource) lines.push(`repetition_source: ${quiz.repetitionSource}`)
  if (typeof quiz.resolvedCount === 'number') lines.push(`resolved_count: ${quiz.resolvedCount}`)
  if (typeof quiz.timeToUnderstandingSec === 'number')
    lines.push(`time_to_understanding_sec: ${quiz.timeToUnderstandingSec}`)
  lines.push(`iterations: ${quiz.iterations}`, '---', '')

  const questions = quiz.questions ?? [{ repetition: false, attempts: quiz.attempts }]
  const body = questions
    .map((q, qi) =>
      q.attempts
        .map((attempt, ai) => {
          const heading = formatHeading(qi + 1, ai, Boolean(q.repetition))
          const optionsMd = attempt.options.map((o, i) => `- ${String.fromCodePoint(65 + i)}. ${o}`).join('\n')
          return [
            heading,
            attempt.question,
            '',
            optionsMd,
            '',
            '### Відповідь',
            attempt.correctAnswer,
            '',
            '### Мікроурок',
            attempt.microlesson,
            ''
          ].join('\n')
        })
        .join('\n')
    )
    .join('\n')

  return `${lines.join('\n')}\n${body}`
}

/**
 * Розбирає квіз-файл назад у структурований стан (CLI-показ, тести,
 * round-trip перевірка формату). Повертає ОБИДВІ форми: `attempts` —
 * плаский список УСІХ спроб УСІХ питань (backward-compat з M1 для
 * one-question квізів) і `questions` — згруповані за номером питання, з
 * прапорцем `repetition` на кожному (spaced-repetition-питання).
 * @param {string} text markdown-текст квіз-файлу
 * @returns {object} розібраний квіз-стан
 */
export function parseQuizFile(text) {
  const match = FRONTMATTER_RE.exec(text ?? '')
  const raw = match ? match[1] : ''
  const body = match ? match[2] : (text ?? '')

  const fields = Object.fromEntries(
    raw
      .split(NEWLINE_RE)
      .filter(Boolean)
      .map(line => {
        const idx = line.indexOf(':')
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
      })
  )

  const blocks = body.split(QUESTION_BLOCK_SPLIT_RE).filter(b => b.trim())
  const rawAttempts = blocks.map((block, blockIndex) => {
    const lines = block.split(NEWLINE_RE)
    const headingMatch = HEADING_RE.exec(lines[0].trim())
    const rest = lines.slice(1).join('\n')
    const options = rest
      .matchAll(OPTION_LINE_RE)
      .map(m => m[1])
      .toArray()
    const answerMatch = ANSWER_SECTION_RE.exec(rest)
    const microlessonMatch = MICROLESSON_SECTION_RE.exec(rest)
    const questionMatch = QUESTION_TEXT_RE.exec(rest)
    const inner = headingMatch ? (headingMatch[2] ?? '') : ''
    const attemptNumMatch = ATTEMPT_NUM_RE.exec(inner)
    return {
      questionIndex: headingMatch ? Number(headingMatch[1]) : blockIndex + 1,
      repetition: inner.includes('повторення'),
      attempt: attemptNumMatch ? Number(attemptNumMatch[1]) : 1,
      question: (questionMatch ? questionMatch[1] : rest).trim(),
      options,
      correctAnswer: answerMatch ? answerMatch[1].trim() : '',
      microlesson: microlessonMatch ? microlessonMatch[1].trim() : ''
    }
  })

  const questionsByIndex = new Map()
  for (const a of rawAttempts) {
    if (!questionsByIndex.has(a.questionIndex)) {
      questionsByIndex.set(a.questionIndex, { index: a.questionIndex, repetition: a.repetition, attempts: [] })
    }
    questionsByIndex.get(a.questionIndex).attempts.push({
      question: a.question,
      options: a.options,
      correctAnswer: a.correctAnswer,
      microlesson: a.microlesson
    })
  }
  const questions = questionsByIndex.values().toArray().toSorted((x, y) => x.index - y.index)
  const attempts = rawAttempts.map(a => ({
    attempt: a.attempt,
    question: a.question,
    options: a.options,
    correctAnswer: a.correctAnswer,
    microlesson: a.microlesson
  }))

  return {
    schemaVersion: fields.schema_version === undefined ? null : Number(fields.schema_version),
    type: fields.type ?? null,
    decisionRef: fields.decision_ref ?? null,
    depth: fields.depth ?? null,
    generatedBy: fields.generated_by ?? null,
    shownAt: fields.shown_at ?? null,
    repetitionSource: fields.repetition_source ?? null,
    resolvedCount: fields.resolved_count === undefined ? null : Number(fields.resolved_count),
    timeToUnderstandingSec:
      fields.time_to_understanding_sec === undefined ? null : Number(fields.time_to_understanding_sec),
    iterations: fields.iterations === undefined ? null : Number(fields.iterations),
    attempts,
    questions
  }
}
