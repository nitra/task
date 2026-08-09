import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { decisionApprove, decisionQuiz, submitQuizAnswer } from '../decision-flow.js'
import { verifyApproval } from '../approval.js'
import { generateDeviceKeypair } from '../signing.js'

const DECISIONS_DIR = '/root/runs/demo-1/decisions'
const DR_TEXT = readFileSync(
  join(import.meta.dirname, 'fixtures/runs/demo-1/decisions/0001-decision-request.md'),
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
