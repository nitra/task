import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { decisionApprove, decisionQuiz, submitQuizAnswer } from '../decision-flow.js'
import { verifyApproval } from '../approval.js'
import { appendKnowledgeEntry, emptyKnowledge, formatKnowledgeFile, parseKnowledgeFile } from '../knowledge.js'
import { generateDeviceKeypair } from '../signing.js'

const DECISIONS_DIR = '/root/runs/demo-1/decisions'
const DR_TEXT = readFileSync(
  join(import.meta.dirname, 'fixtures/runs/demo-1/decisions/0001-decision-request.md'),
  'utf8'
)
const DR_STANDARD_TEXT = readFileSync(
  join(import.meta.dirname, 'fixtures/runs/demo-1/decisions/0002-decision-request.md'),
  'utf8'
)
const DR_TEACHBACK_TEXT = readFileSync(
  join(import.meta.dirname, 'fixtures/runs/demo-1/decisions/0003-decision-request.md'),
  'utf8'
)

const SHOWN_AT_PREFIX_RE = /shown_at:/
const SHOWN_AT_FIELD_RE = /shown_at/
const NOT_FOUND_ERROR_RE = /не знайдено/
const CALL_DECISION_QUIZ_ERROR_RE = /decision_quiz/
const MICROLESSON_RE = /Мікроурок/
const OPTION_LINE_RE = /^- [A-Z]\.\s(.*)$/gm
const ANSWER_SECTION_RE = /### Відповідь\n([\s\S]*?)\n\n### Мікроурок/
const TIME_TO_UNDERSTANDING_FIELD_RE = /time_to_understanding_sec: 47/
const QUESTION_2_REPETITION_RE = /## Питання 2 \(повторення\)/
const CLOSED_ERROR_RE = /вже закрите/
const DEPTH_TEACHBACK_FIELD_RE = /depth: teach-back/
const TEACHBACK_UNAVAILABLE_MENTION_RE = /недоступний без локальної моделі/
const TRANSCRIPT_REQUIRED_RE = /потрібен непорожній transcript/
const TEACHBACK_HEADING_RE = /## Переказ \(teach-back\)/
const TEACHBACK_ATTEMPT1_RE = /## Переказ \(teach-back\)\nкоротко/
const TEACHBACK_ATTEMPT2_RE = /## Переказ \(teach-back\) \(спроба 2\)/
const TIME_TO_UNDERSTANDING_MENTION_RE = /time_to_understanding_sec/
const CONTEXT_MENTION_RE = /MandateCard\.vue/
const OPTIONS_MENTION_RE = /MandateChipRow/
const RECOMMENDATION_MENTION_RE = /Варіант B/
const QUESTION_BLOCK_SPLIT_RE = /\n(?=## Питання)/

/**
 * @param {object} [seed] початковий вміст сховища (шлях → вміст файлу)
 * @returns {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>, store: Map<string,string>}}
 *   in-memory fs-double — той самий контракт `io`, що node:fs (CLI) чи Tauri invoke (GUI)
 */
function memoryIo(seed = {}) {
  const store = new Map(Object.entries(seed))
  return {
    store,
    readFile: path => (store.has(path) ? store.get(path) : null),
    writeFile: (path, content) => {
      store.set(path, content)
    }
  }
}

/**
 * @param {object[]} [seedEntries] початкові записи бази знань
 * @returns {{read: () => Promise<string|null>, write: (content: string) => Promise<void>, entries: () => object[]}}
 *   in-memory knowledgeIo — той самий контракт, що CLI/GUI
 */
function memoryKnowledgeIo(seedEntries = []) {
  let text = seedEntries.length > 0 ? formatKnowledgeFile(seedEntries) : null
  return {
    read: () => text,
    write: content => {
      text = content
    },
    entries: () => parseKnowledgeFile(text)
  }
}

const REJECTING_FETCH = vi.fn().mockRejectedValue(new Error('no network in tests'))

describe('decisionQuiz', () => {
  it('перший виклик генерує й пише чернетку квізу на диск (fallback без мережі)', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const result = await decisionQuiz({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      chosenOption: 'B',
      fetchImpl: REJECTING_FETCH
    })
    expect(result.options).toHaveLength(3)
    expect(result.depth).toBe('one-tap')
    expect(result.generatedBy).toBe('quiz-gen-fallback')
    expect(io.store.has(`${DECISIONS_DIR}/0001-quiz.md`)).toBe(true)
    expect(io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)).toMatch(SHOWN_AT_PREFIX_RE)
  })

  it('повторний виклик повертає те саме питання без повторної генерації (draft вже на диску)', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const first = await decisionQuiz({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      chosenOption: 'B',
      fetchImpl: REJECTING_FETCH
    })
    const second = await decisionQuiz({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      chosenOption: 'B',
      fetchImpl: REJECTING_FETCH
    })
    expect(second.question).toBe(first.question)
    expect(second.options).toEqual(first.options)
  })

  it('decision-request відсутній — кидає', async () => {
    const io = memoryIo({})
    await expect(
      decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '9999', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    ).rejects.toThrow(NOT_FOUND_ERROR_RE)
  })
})

describe('submitQuizAnswer', () => {
  it('квіз ще не згенеровано — кидає з підказкою викликати decision_quiz', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    await expect(submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: 0 })).rejects.toThrow(
      CALL_DECISION_QUIZ_ERROR_RE
    )
  })

  it('неправильна відповідь: iterations++, повертає мікроурок, approval НЕ пишеться (файл квізу лишається без time_to_understanding_sec)', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    const draftBefore = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)

    // Перебираємо 0/1/2, доки відповідь не буде "неправильною" (фолбек детермінований,
    // тож рівно один із трьох індексів правильний — решта свідомо провокують фейл).
    let result
    for (const candidate of [0, 1, 2]) {
      result = await submitQuizAnswerFresh(candidate)
      if (!result.correct) break
    }
    expect(result.correct).toBe(false)
    expect(result.iterations).toBe(2)
    expect(result.microlesson).toMatch(MICROLESSON_RE)
    expect(io.store.has(`${DECISIONS_DIR}/0001-approval.json`)).toBe(false)

    /**
     * @param {number} candidate індекс відповіді-кандидата
     * @returns {Promise<object>} результат submitQuizAnswer на свіжому io з тим самим draft-станом
     */
    function submitQuizAnswerFresh(candidate) {
      const freshIo = memoryIo({
        [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT,
        [`${DECISIONS_DIR}/0001-quiz.md`]: draftBefore
      })
      return submitQuizAnswer({ io: freshIo, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: candidate })
    }
  })

  it('правильна відповідь фіналізує квіз: iterations фіксується, timeToUnderstandingSec обчислюється від shown_at', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const shownAtMs = Date.parse('2026-08-09T10:00:00.000Z')
    await decisionQuiz({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      chosenOption: 'B',
      fetchImpl: REJECTING_FETCH,
      now: () => new Date(shownAtMs)
    })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const optionsLine = draft
      .matchAll(OPTION_LINE_RE)
      .map(m => m[1])
      .toArray()
    const correctAnswerLine = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const correctIndex = optionsLine.indexOf(correctAnswerLine)

    const result = await submitQuizAnswer({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      answer: correctIndex,
      now: () => new Date(shownAtMs + 47_000)
    })
    expect(result.correct).toBe(true)
    expect(result.iterations).toBe(1)
    expect(result.quiz.timeToUnderstandingSec).toBe(47)
    const finalText = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    expect(finalText).not.toMatch(SHOWN_AT_FIELD_RE)
    expect(finalText).toMatch(TIME_TO_UNDERSTANDING_FIELD_RE)
  })
})

describe('decision вже закрита approval.json — квіз не мутується (M1-баг, знайдено на рев\'ю)', () => {
  it('decisionQuiz на закритому decision кидає, не пише/не читає квіз-файл', async () => {
    const io = memoryIo({
      [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT,
      [`${DECISIONS_DIR}/0001-approval.json`]: '{"approved":true}'
    })
    await expect(
      decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    ).rejects.toThrow(CLOSED_ERROR_RE)
    expect(io.store.has(`${DECISIONS_DIR}/0001-quiz.md`)).toBe(false)
  })

  it('submitQuizAnswer на закритому decision кидає, iterations квіз-файлу не змінюється', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    const quizBefore = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    io.store.set(`${DECISIONS_DIR}/0001-approval.json`, '{"approved":true}')

    await expect(
      submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: 0 })
    ).rejects.toThrow(CLOSED_ERROR_RE)
    expect(io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)).toBe(quizBefore)
  })

  it('decisionApprove на закритому decision кидає, approval.json не перезаписується', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const { publicKeyBase64, privateKeyJwk } = await generateDeviceKeypair()
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    io.store.set(`${DECISIONS_DIR}/0001-approval.json`, '{"approved":true,"marker":"original"}')

    await expect(
      decisionApprove({
        io,
        decisionsDir: DECISIONS_DIR,
        runId: 'demo-1',
        nnnn: '0001',
        chosenOption: 'B',
        answer: 0,
        deviceKey: { publicKeyBase64, privateKeyJwk }
      })
    ).rejects.toThrow(CLOSED_ERROR_RE)
    expect(io.store.get(`${DECISIONS_DIR}/0001-approval.json`)).toBe('{"approved":true,"marker":"original"}')
  })
})

describe('decisionApprove — інваріант «без квізу підпис неможливий»', () => {
  it('неправильна відповідь — approved: false, approval.json не пишеться', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const { publicKeyBase64, privateKeyJwk } = await generateDeviceKeypair()
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const options = draft
      .matchAll(OPTION_LINE_RE)
      .map(m => m[1])
      .toArray()
    const correctAnswerText = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const wrongIndex = options.findIndex(o => o !== correctAnswerText)

    const result = await decisionApprove({
      io,
      decisionsDir: DECISIONS_DIR,
      runId: 'demo-1',
      nnnn: '0001',
      chosenOption: 'B',
      answer: wrongIndex,
      deviceKey: { publicKeyBase64, privateKeyJwk }
    })
    expect(result.approved).toBe(false)
    expect(io.store.has(`${DECISIONS_DIR}/0001-approval.json`)).toBe(false)
  })

  it('правильна відповідь — пише підписаний approval.json, що проходить verifyApproval', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const { publicKeyBase64, privateKeyJwk } = await generateDeviceKeypair()
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const options = draft
      .matchAll(OPTION_LINE_RE)
      .map(m => m[1])
      .toArray()
    const correctAnswerText = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const correctIndex = options.indexOf(correctAnswerText)

    const result = await decisionApprove({
      io,
      decisionsDir: DECISIONS_DIR,
      runId: 'demo-1',
      nnnn: '0001',
      chosenOption: 'B',
      answer: correctIndex,
      deviceKey: { publicKeyBase64, privateKeyJwk }
    })
    expect(result.approved).toBe(true)
    expect(result.approval.chosen_option).toBe('B')
    expect(result.approval.quiz_ref).toBe('decisions/0001-quiz.md')
    expect(result.approval.request_id).toBe('demo-1/0001')
    expect(await verifyApproval(result.approval)).toBe(true)
    expect(io.store.has(`${DECISIONS_DIR}/0001-approval.json`)).toBe(true)
  })

  it('git-log-подібна пара: quiz.md і approval.json обидва матеріалізовані поруч із decision-request', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const { publicKeyBase64, privateKeyJwk } = await generateDeviceKeypair()
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const options = draft
      .matchAll(OPTION_LINE_RE)
      .map(m => m[1])
      .toArray()
    const correctAnswerText = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const correctIndex = options.indexOf(correctAnswerText)

    await decisionApprove({
      io,
      decisionsDir: DECISIONS_DIR,
      runId: 'demo-1',
      nnnn: '0001',
      chosenOption: 'B',
      answer: correctIndex,
      deviceKey: { publicKeyBase64, privateKeyJwk }
    })

    expect(io.store.keys().toArray().toSorted()).toEqual(
      [
        `${DECISIONS_DIR}/0001-decision-request.md`,
        `${DECISIONS_DIR}/0001-quiz.md`,
        `${DECISIONS_DIR}/0001-approval.json`
      ].toSorted()
    )
  })
})

describe('мікроурок — показується ПІСЛЯ будь-якої відповіді, не лише неправильної (M2, «Обсяг M2» п.2)', () => {
  it('submitQuizAnswer повертає microlesson і на правильній, і на неправильній відповіді', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const options = draft.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray()
    const correctAnswerText = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const correctIndex = options.indexOf(correctAnswerText)
    const wrongIndex = options.findIndex(o => o !== correctAnswerText)

    const wrongResult = await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: wrongIndex })
    expect(wrongResult.microlesson).toMatch(MICROLESSON_RE)

    const freshIo = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT, [`${DECISIONS_DIR}/0001-quiz.md`]: draft })
    const correctResult = await submitQuizAnswer({ io: freshIo, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: correctIndex })
    expect(correctResult.done).toBe(true)
    expect(correctResult.microlesson).toMatch(MICROLESSON_RE)
  })
})

describe('навчальний режим при фейлі — розгортання контексту шар за шаром («право на глибину», M2 п.3)', () => {
  it('1-й фейл — лише ## Контекст', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const options = draft.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray()
    const correctAnswerText = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const wrongIndex = options.findIndex(o => o !== correctAnswerText)

    const result = await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: wrongIndex })
    expect(result.explain).toHaveLength(1)
    expect(result.explain[0]).toMatchObject({ layer: 1, heading: 'Контекст' })
    expect(result.explain[0].content).toMatch(CONTEXT_MENTION_RE)
  })

  it('2-й фейл того самого питання — контекст + наслідки всіх варіантів (кумулятивно)', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const options = draft.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray()
    const correctAnswerText = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const wrongIndex = options.findIndex(o => o !== correctAnswerText)

    await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: wrongIndex }) // 1-й фейл
    const result = await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: wrongIndex }) // 2-й фейл
    expect(result.explain.map(l => l.layer)).toEqual([1, 2])
    expect(result.explain[1].heading).toBe('Наслідки варіантів')
    expect(result.explain[1].content).toMatch(OPTIONS_MENTION_RE)
  })

  it('3-й+ фейл того самого питання — і рекомендація агента з обґрунтуванням', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const options = draft.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray()
    const correctAnswerText = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const wrongIndex = options.findIndex(o => o !== correctAnswerText)

    await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: wrongIndex })
    await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: wrongIndex })
    const result = await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: wrongIndex })
    expect(result.explain.map(l => l.layer)).toEqual([1, 2, 3])
    expect(result.explain[2].heading).toBe('Рекомендація агента')
    expect(result.explain[2].content).toMatch(RECOMMENDATION_MENTION_RE)

    // Стеля на 3 шарах — 4-й фейл не додає ще глибший шар.
    const fourth = await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: wrongIndex })
    expect(fourth.explain).toHaveLength(3)
  })
})

describe('перефразування питання на ретраї (LLM живий) — M2 п.3', () => {
  it('LLM повертає нове формулювання — наступна спроба показує його (options/correctAnswer незмінні)', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const options = draft.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray()
    const correctAnswerText = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const wrongIndex = options.findIndex(o => o !== correctAnswerText)

    const rephraseFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ choices: [{ message: { content: 'Перефразоване питання про наслідки варіанта B?' } }] })
    })
    await submitQuizAnswer({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      answer: wrongIndex,
      chosenOption: 'B',
      fetchImpl: rephraseFetch
    })
    const next = await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    expect(next.question).toBe('Перефразоване питання про наслідки варіанта B?')
    expect(next.options).toEqual(options)
  })

  it('без chosenOption/llmConfig/fetchImpl — питання лишається тим самим (M1-поведінка за замовчуванням)', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const first = await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const options = draft.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray()
    const correctAnswerText = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const wrongIndex = options.findIndex(o => o !== correctAnswerText)

    await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: wrongIndex })
    const next = await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH })
    expect(next.question).toBe(first.question)
  })
})

describe('база знань — запис після завершеного квізу (M2 п.4)', () => {
  it('decisionApprove на успіху дописує запис у knowledgeIo з доменом decisionType', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const knowledgeIo = memoryKnowledgeIo()
    const { publicKeyBase64, privateKeyJwk } = await generateDeviceKeypair()
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH, knowledgeIo })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const options = draft.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray()
    const correctAnswerText = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const correctIndex = options.indexOf(correctAnswerText)

    const result = await decisionApprove({
      io,
      decisionsDir: DECISIONS_DIR,
      runId: 'demo-1',
      nnnn: '0001',
      chosenOption: 'B',
      answer: correctIndex,
      deviceKey: { publicKeyBase64, privateKeyJwk },
      knowledgeIo,
      now: () => new Date('2026-08-09T10:05:00.000Z')
    })
    expect(result.approved).toBe(true)
    expect(result.domain).toBe('architecture')

    const entries = knowledgeIo.entries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ decisionRef: '0001-decision-request.md', domain: 'architecture', completedAt: '2026-08-09T10:05:00.000Z' })
    expect(entries[0].options).toEqual(options)
  })

  it('неправильна відповідь — не пише запис у базу знань (квіз ще не завершено)', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const knowledgeIo = memoryKnowledgeIo()
    await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH, knowledgeIo })
    const draft = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    const options = draft.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray()
    const correctAnswerText = ANSWER_SECTION_RE.exec(draft)[1].trim()
    const wrongIndex = options.findIndex(o => o !== correctAnswerText)

    await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: wrongIndex, knowledgeIo })
    expect(knowledgeIo.entries()).toEqual([])
  })
})

describe('spaced repetition на живих рішеннях — підмішування «Питання 2 (повторення)» (M2 п.5)', () => {
  it('дозріле знання того самого домену підмішується як друге питання; квіз гейтить обидва', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const dueEntry = appendKnowledgeEntry(emptyKnowledge(), {
      decisionRef: '9998-decision-request.md',
      domain: 'architecture',
      question: 'Старе питання про архітектуру?',
      options: ['Правильна стара відповідь', 'Дистрактор 1', 'Дистрактор 2'],
      correctAnswer: 'Правильна стара відповідь',
      microlesson: 'Старий мікроурок.',
      iterations: 1,
      timeToUnderstandingSec: 30,
      completedAt: '2026-08-01T10:00:00.000Z'
    })
    const knowledgeIo = memoryKnowledgeIo(dueEntry)
    const now = new Date('2026-08-09T10:00:00.000Z') // > 1 день після completedAt → дозріло

    const quiz = await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH, knowledgeIo, now: () => now })
    expect(quiz.questionCount).toBe(2)
    expect(quiz.repetition).toBe(false) // активне — перше (головне) питання

    const draftText = io.store.get(`${DECISIONS_DIR}/0001-quiz.md`)
    expect(draftText).toMatch(QUESTION_2_REPETITION_RE)

    // Здаємо перше (головне) питання правильно — квіз ще НЕ завершено (є друге).
    const options1 = draftText.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray().slice(0, 3)
    const correctAnswer1 = ANSWER_SECTION_RE.exec(draftText)[1].trim()
    const correctIndex1 = options1.indexOf(correctAnswer1)
    const first = await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: correctIndex1, now: () => now, knowledgeIo })
    expect(first.correct).toBe(true)
    expect(first.done).toBe(false)
    expect(first.microlesson).toMatch(MICROLESSON_RE) // мікроурок після ЩОЙНО відповіданого питання, не лише фіналу
    expect(first.nextQuestion.repetition).toBe(true)
    expect(first.nextQuestion.question).toBe('Старе питання про архітектуру?')

    // Друге (повторення) — правильна відповідь фіналізує квіз і оновлює інтервал.
    const correctRepetitionIndex = first.nextQuestion.options.indexOf('Правильна стара відповідь')
    const second = await submitQuizAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', answer: correctRepetitionIndex, now: () => now, knowledgeIo })
    expect(second.correct).toBe(true)
    expect(second.done).toBe(true)

    const updated = knowledgeIo.entries().find(e => e.decisionRef === '9998-decision-request.md')
    expect(updated.intervalDays).toBe(3) // 1 → 3, драбинка просунулась
    expect(updated.lastRepeatedAt).toBe(now.toISOString())

    // Новий запис бази знань про ЦЮ (0001) розвилку теж додався.
    expect(knowledgeIo.entries().some(e => e.decisionRef === '0001-decision-request.md')).toBe(true)
  })

  it('немає дозрілого знання домену — квіз лишається одним питанням (штатний шлях)', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_TEXT })
    const knowledgeIo = memoryKnowledgeIo()
    const quiz = await decisionQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', chosenOption: 'B', fetchImpl: REJECTING_FETCH, knowledgeIo })
    expect(quiz.questionCount).toBe(1)
  })
})

describe('depth: standard — 2 питання про саму розвилку (M2 п.6, фікстура 0002: blast_radius subtree)', () => {
  it('decisionQuiz генерує 2 питання, обидва мають бути здані для підпису', async () => {
    const standardDecisionsDir = '/root/runs/demo-1/decisions'
    const io = memoryIo({ [`${standardDecisionsDir}/0002-decision-request.md`]: DR_STANDARD_TEXT })
    const first = await decisionQuiz({ io, decisionsDir: standardDecisionsDir, nnnn: '0002', chosenOption: 'A', fetchImpl: REJECTING_FETCH })
    expect(first.depth).toBe('standard')
    expect(first.questionCount).toBe(2)
    expect(first.questionIndex).toBe(1)

    const draftText = io.store.get(`${standardDecisionsDir}/0002-quiz.md`)
    const options1 = draftText.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray().slice(0, 3)
    const correctAnswer1 = ANSWER_SECTION_RE.exec(draftText)[1].trim()
    const correctIndex1 = options1.indexOf(correctAnswer1)

    const afterFirst = await submitQuizAnswer({ io, decisionsDir: standardDecisionsDir, nnnn: '0002', answer: correctIndex1 })
    expect(afterFirst.correct).toBe(true)
    expect(afterFirst.done).toBe(false)
    expect(afterFirst.nextQuestion.questionIndex).toBe(2)

    const { publicKeyBase64, privateKeyJwk } = await generateDeviceKeypair()
    // Знаходимо справжній правильний варіант другого питання з квіз-файлу
    // (перший блок після спліту — фронтматер, ігноруємо його).
    const draftText2 = io.store.get(`${standardDecisionsDir}/0002-quiz.md`)
    const blocks2 = draftText2.split(QUESTION_BLOCK_SPLIT_RE)
    const secondBlock = blocks2[2]
    const options2 = secondBlock.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray()
    const correctAnswer2 = ANSWER_SECTION_RE.exec(secondBlock)[1].trim()
    const correctIndex2 = options2.indexOf(correctAnswer2)
    expect(afterFirst.nextQuestion.options).toEqual(options2)

    const approveResult = await decisionApprove({
      io,
      decisionsDir: standardDecisionsDir,
      runId: 'demo-1',
      nnnn: '0002',
      chosenOption: 'A',
      answer: correctIndex2,
      deviceKey: { publicKeyBase64, privateKeyJwk }
    })
    expect(approveResult.approved).toBe(true)
    expect(approveResult.done).toBe(true)
    expect(await verifyApproval(approveResult.approval)).toBe(true)
  })

  it('перше питання неправильне — explain шар 1, підпис недоступний', async () => {
    const standardDecisionsDir = '/root/runs/demo-1/decisions'
    const io = memoryIo({ [`${standardDecisionsDir}/0002-decision-request.md`]: DR_STANDARD_TEXT })
    await decisionQuiz({ io, decisionsDir: standardDecisionsDir, nnnn: '0002', chosenOption: 'A', fetchImpl: REJECTING_FETCH })
    const draftText = io.store.get(`${standardDecisionsDir}/0002-quiz.md`)
    const options1 = draftText.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray().slice(0, 3)
    const correctAnswer1 = ANSWER_SECTION_RE.exec(draftText)[1].trim()
    const wrongIndex1 = options1.findIndex(o => o !== correctAnswer1)

    const result = await submitQuizAnswer({ io, decisionsDir: standardDecisionsDir, nnnn: '0002', answer: wrongIndex1 })
    expect(result.correct).toBe(false)
    expect(result.explain).toHaveLength(1)
    expect(io.store.has(`${standardDecisionsDir}/0002-approval.json`)).toBe(false)
  })
})

/**
 * @param {{understood: boolean, missingAspects?: string[], feedback?: string}} verdict бажаний вердикт оцінки
 * @returns {ReturnType<typeof vi.fn>} мок fetch, що повертає ОДНУ LLM-відповідь оцінки teach-back
 */
function teachBackFetch({ understood, missingAspects = [], feedback = 'ок' }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => ({ choices: [{ message: { content: JSON.stringify({ understood, missingAspects, feedback }) } }] })
  })
}

describe('teach-back — depth: teach-back одноосібного шляху (M5, blast_radius: company + irreversible: false)', () => {
  const TEACHBACK_DIR = '/root/runs/demo-1/decisions'

  it('decisionQuiz — перший виклик пише порожню чернетку з shown_at, повертає prompt (не question)', async () => {
    const io = memoryIo({ [`${TEACHBACK_DIR}/0003-decision-request.md`]: DR_TEACHBACK_TEXT })
    const result = await decisionQuiz({ io, decisionsDir: TEACHBACK_DIR, nnnn: '0003', chosenOption: 'A' })
    expect(result.depth).toBe('teach-back')
    expect(result.prompt).toBeTruthy()
    expect(result.iterations).toBe(0)
    expect(io.store.get(`${TEACHBACK_DIR}/0003-quiz.md`)).toMatch(SHOWN_AT_PREFIX_RE)
    expect(io.store.get(`${TEACHBACK_DIR}/0003-quiz.md`)).toMatch(DEPTH_TEACHBACK_FIELD_RE)
  })

  it('submitQuizAnswer — LLM недоступний: available false, ЧЕСНА відмова, нічого не пишеться, спроба не рахується', async () => {
    const io = memoryIo({ [`${TEACHBACK_DIR}/0003-decision-request.md`]: DR_TEACHBACK_TEXT })
    await decisionQuiz({ io, decisionsDir: TEACHBACK_DIR, nnnn: '0003', chosenOption: 'A' })
    const before = io.store.get(`${TEACHBACK_DIR}/0003-quiz.md`)
    const result = await submitQuizAnswer({
      io,
      decisionsDir: TEACHBACK_DIR,
      nnnn: '0003',
      chosenOption: 'A',
      transcript: 'переказ',
      fetchImpl: REJECTING_FETCH
    })
    expect(result.correct).toBe(false)
    expect(result.available).toBe(false)
    expect(result.message).toMatch(TEACHBACK_UNAVAILABLE_MENTION_RE)
    expect(io.store.get(`${TEACHBACK_DIR}/0003-quiz.md`)).toBe(before)
  })

  it('кидає без transcript', async () => {
    const io = memoryIo({ [`${TEACHBACK_DIR}/0003-decision-request.md`]: DR_TEACHBACK_TEXT })
    await decisionQuiz({ io, decisionsDir: TEACHBACK_DIR, nnnn: '0003', chosenOption: 'A' })
    await expect(
      submitQuizAnswer({ io, decisionsDir: TEACHBACK_DIR, nnnn: '0003', chosenOption: 'A', fetchImpl: REJECTING_FETCH })
    ).rejects.toThrow(TRANSCRIPT_REQUIRED_RE)
  })

  it('understood: false — навчальний режим (explain), iterations++, approval НЕ пишеться', async () => {
    const io = memoryIo({ [`${TEACHBACK_DIR}/0003-decision-request.md`]: DR_TEACHBACK_TEXT })
    await decisionQuiz({ io, decisionsDir: TEACHBACK_DIR, nnnn: '0003', chosenOption: 'A' })
    const result = await decisionApprove({
      io,
      decisionsDir: TEACHBACK_DIR,
      runId: 'demo-1',
      nnnn: '0003',
      chosenOption: 'A',
      transcript: 'коротко',
      deviceKey: await generateDeviceKeypair(),
      fetchImpl: teachBackFetch({ understood: false, missingAspects: ['головний ризик'], feedback: 'бракує ризику' })
    })
    expect(result.approved).toBe(false)
    expect(result.correct).toBe(false)
    expect(result.feedback).toBe('бракує ризику')
    expect(result.missingAspects).toEqual(['головний ризик'])
    expect(result.explain).toHaveLength(1) // 1-й фейл — лише «## Контекст», той самий інваріант, що Q&A-квіз
    expect(io.store.has(`${TEACHBACK_DIR}/0003-approval.json`)).toBe(false)
    expect(io.store.get(`${TEACHBACK_DIR}/0003-quiz.md`)).toMatch(TEACHBACK_HEADING_RE)
  })

  it('understood: true — фіналізує, підписує, дописує особисту базу знань', async () => {
    const io = memoryIo({ [`${TEACHBACK_DIR}/0003-decision-request.md`]: DR_TEACHBACK_TEXT })
    const knowledgeIo = memoryKnowledgeIo()
    await decisionQuiz({ io, decisionsDir: TEACHBACK_DIR, nnnn: '0003', chosenOption: 'A' })
    const { privateKeyJwk, publicKeyBase64 } = await generateDeviceKeypair()
    const result = await decisionApprove({
      io,
      decisionsDir: TEACHBACK_DIR,
      runId: 'demo-1',
      nnnn: '0003',
      chosenOption: 'A',
      transcript: 'Обираю варіант A (чотириденний тиждень), головний наслідок — вища залученість, головний ризик — SLA на перехідний період.',
      deviceKey: { privateKeyJwk, publicKeyBase64 },
      knowledgeIo,
      fetchImpl: teachBackFetch({ understood: true, feedback: 'Переказ покриває всі аспекти.' })
    })
    expect(result.approved).toBe(true)
    expect(result.done).toBe(true)
    expect(await verifyApproval(result.approval)).toBe(true)
    expect(io.store.has(`${TEACHBACK_DIR}/0003-approval.json`)).toBe(true)

    const entries = knowledgeIo.entries()
    expect(entries).toHaveLength(1)
    expect(entries[0].domain).toBe('process')
    expect(entries[0].microlesson).toBe('Переказ покриває всі аспекти.')
  })

  it('не зрозумів → новий переказ зрозумілий — друга спроба фіналізує teach-back-файл з обома спробами', async () => {
    const io = memoryIo({ [`${TEACHBACK_DIR}/0003-decision-request.md`]: DR_TEACHBACK_TEXT })
    await decisionQuiz({ io, decisionsDir: TEACHBACK_DIR, nnnn: '0003', chosenOption: 'A' })
    await decisionApprove({
      io,
      decisionsDir: TEACHBACK_DIR,
      runId: 'demo-1',
      nnnn: '0003',
      chosenOption: 'A',
      transcript: 'коротко',
      deviceKey: await generateDeviceKeypair(),
      fetchImpl: teachBackFetch({ understood: false, missingAspects: ['головний ризик'], feedback: 'бракує ризику' })
    })
    const deviceKey = await generateDeviceKeypair()
    const result = await decisionApprove({
      io,
      decisionsDir: TEACHBACK_DIR,
      runId: 'demo-1',
      nnnn: '0003',
      chosenOption: 'A',
      transcript: 'Тепер повний переказ з наслідком і ризиком.',
      deviceKey,
      fetchImpl: teachBackFetch({ understood: true })
    })
    expect(result.approved).toBe(true)
    expect(result.iterations).toBe(2)
    const finalText = io.store.get(`${TEACHBACK_DIR}/0003-quiz.md`)
    expect(finalText).toMatch(TEACHBACK_ATTEMPT1_RE)
    expect(finalText).toMatch(TEACHBACK_ATTEMPT2_RE)
    expect(finalText).toMatch(TIME_TO_UNDERSTANDING_MENTION_RE)
  })

  it('рішення вже закрите — подальші виклики кидають (термінальний approval)', async () => {
    const io = memoryIo({
      [`${TEACHBACK_DIR}/0003-decision-request.md`]: DR_TEACHBACK_TEXT,
      [`${TEACHBACK_DIR}/0003-approval.json`]: '{"approved":true}'
    })
    await expect(decisionQuiz({ io, decisionsDir: TEACHBACK_DIR, nnnn: '0003', chosenOption: 'A' })).rejects.toThrow(
      CLOSED_ERROR_RE
    )
  })
})
