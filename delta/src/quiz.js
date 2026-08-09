// Квіз-генератор (one-tap) і формат квіз-файлів — контракт mt:
// mt/docs/architecture/mandates.md, «Нормативний контракт (M6 фаза 0)» →
// «Формат квіз-файлів». M1 реалізує лише `depth: one-tap` (одне контрольне
// питання) — standard/teach-back лишаються M2 (docs/specs/260809-delta-app.md,
// «Обсяг M1»).
//
// Джерело питання — локальний OpenAI-сумісний ендпоінт (адреса/модель —
// конфіг, не константа: `.mt`-незалежний `config.json` застосунку, той
// самий, що `identity`/`mandates_dir`). Ендпоінт недоступний → детермінований
// фолбек, зібраний із самого тіла decision-request; квіз ніколи не
// пропускається (інваріант конституції п.2 — «фейл ≠ покарання», не
// «квіз ≠ обовʼязковий»).

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

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
const ATTEMPT_HEADING_RE = /^## Питання (\d+)(?: \(спроба (\d+)\))?$/
const NEWLINE_RE = /\r?\n/
const ATTEMPT_BLOCK_SPLIT_RE = /\r?\n(?=## Питання)/
const OPTION_LINE_RE = /^- [A-Z]\.\s(.*)$/gm
const ANSWER_SECTION_RE = /### Відповідь\r?\n([\s\S]*?)(?:\r?\n### Мікроурок|$)/
const MICROLESSON_SECTION_RE = /### Мікроурок\r?\n([\s\S]*?)$/
const QUESTION_TEXT_RE = /^([\s\S]*?)(?:\r?\n\r?\n- [A-Z]\.|\r?\n\r?\n### Відповідь)/
const TRAILING_SLASH_RE = /\/$/

/**
 * Серіалізує квіз-стан у markdown точно за форматом mandates.md
 * (`schema_version` перше поле; `## Питання N` / `## Питання N (спроба K)`
 * для повторних заходів того самого питання — «фейл ≠ покарання»: номер
 * питання не змінюється, змінюється лише лічильник спроби).
 * @param {{decisionRef: string, depth: string, generatedBy: string, iterations: number,
 *   timeToUnderstandingSec: number|null, shownAt?: string|null,
 *   attempts: {question: string, options: string[], correctAnswer: string, microlesson: string}[]}} quiz квіз-стан
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
  // `shown_at` — недокументоване контрактом поле, присутнє ЛИШЕ в чернетці
  // (до фіксації підписом): момент показу питання, потрібен для обчислення
  // `time_to_understanding_sec` між процесами stateless CLI-викликів.
  // Фіналізація (decision-flow.js: submitQuizAnswer на правильній відповіді)
  // ніколи не передає `shownAt` — рядок зникає з файлу разом із чернеткою.
  if (quiz.shownAt) lines.push(`shown_at: ${quiz.shownAt}`)
  if (typeof quiz.timeToUnderstandingSec === 'number')
    lines.push(`time_to_understanding_sec: ${quiz.timeToUnderstandingSec}`)
  lines.push(`iterations: ${quiz.iterations}`, '---', '')

  const body = quiz.attempts
    .map((attempt, index) => {
      const heading = index === 0 ? `## Питання 1` : `## Питання 1 (спроба ${index + 1})`
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

  return `${lines.join('\n')}\n${body}`
}

/**
 * Розбирає квіз-файл назад у структурований стан (CLI-показ, тести,
 * round-trip перевірка формату).
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

  const blocks = body.split(ATTEMPT_BLOCK_SPLIT_RE).filter(b => b.trim())
  const attempts = blocks.map((block, blockIndex) => {
    const lines = block.split(NEWLINE_RE)
    const headingMatch = ATTEMPT_HEADING_RE.exec(lines[0].trim())
    const rest = lines.slice(1).join('\n')
    const options = rest
      .matchAll(OPTION_LINE_RE)
      .map(m => m[1])
      .toArray()
    const answerMatch = ANSWER_SECTION_RE.exec(rest)
    const microlessonMatch = MICROLESSON_SECTION_RE.exec(rest)
    const questionMatch = QUESTION_TEXT_RE.exec(rest)
    return {
      attempt: headingMatch ? Number(headingMatch[2] ?? 1) : blockIndex + 1,
      question: (questionMatch ? questionMatch[1] : rest).trim(),
      options,
      correctAnswer: answerMatch ? answerMatch[1].trim() : '',
      microlesson: microlessonMatch ? microlessonMatch[1].trim() : ''
    }
  })

  return {
    schemaVersion: fields.schema_version === undefined ? null : Number(fields.schema_version),
    type: fields.type ?? null,
    decisionRef: fields.decision_ref ?? null,
    depth: fields.depth ?? null,
    generatedBy: fields.generated_by ?? null,
    shownAt: fields.shown_at ?? null,
    timeToUnderstandingSec:
      fields.time_to_understanding_sec === undefined ? null : Number(fields.time_to_understanding_sec),
    iterations: fields.iterations === undefined ? null : Number(fields.iterations),
    attempts
  }
}
