import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseDecisionRequest } from '../decisions.js'
import {
  buildQuizPrompt,
  callLlmQuizGenerator,
  defaultLlmConfig,
  fallbackQuiz,
  formatQuizFile,
  generateQuiz,
  parseQuizFile
} from '../quiz.js'

const DR_TEXT = readFileSync(
  join(import.meta.dirname, 'fixtures/runs/demo-1/decisions/0001-decision-request.md'),
  'utf8'
)
const decisionRequest = parseDecisionRequest(DR_TEXT, { path: 'x', nnnn: '0001' })

const CONTEXT_RE = /MandateCard\.vue/
const CHOSEN_OPTION_RE = /Обраний варіант\nB/
const RECOMMENDATION_HEADING_RE = /Рекомендація агента/
const COMPOSABLE_RE = /composable/i
const DECISION_REF_FIELD_RE = /decision_ref: 0001-decision-request\.md/
const DEPTH_FIELD_RE = /depth: one-tap/
const GENERATED_BY_FIELD_RE = /generated_by: quiz-gen-fallback/
const TIME_TO_UNDERSTANDING_FIELD_RE = /time_to_understanding_sec: 47/
const ITERATIONS_FIELD_RE = /iterations: 1/
const PASSED_FAILED_RE = /passed|failed/
const QUESTION_1_RE = /## Питання 1\n/
const QUESTION_1_ATTEMPT_2_RE = /## Питання 1 \(спроба 2\)/
const QUESTION_2_RE = /## Питання 2/
const SHOWN_AT_VALUE_RE = /shown_at: 2026-08-09T10:00:00\.000Z/
const SHOWN_AT_FIELD_RE = /shown_at/

describe('defaultLlmConfig', () => {
  it('дефолт — 127.0.0.1:8080 / gemma-4-26b-a4b-it (спека 260809-delta-app.md, рішення З)', () => {
    expect(defaultLlmConfig()).toEqual({ baseUrl: 'http://127.0.0.1:8080', model: 'gemma-4-26b-a4b-it' })
  })
})

describe('buildQuizPrompt', () => {
  it('включає контекст, варіанти, обраний варіант і рекомендацію (для LLM-контексту)', () => {
    const prompt = buildQuizPrompt(decisionRequest, 'B')
    expect(prompt).toMatch(CONTEXT_RE)
    expect(prompt).toMatch(CHOSEN_OPTION_RE)
    expect(prompt).toMatch(RECOMMENDATION_HEADING_RE)
  })
})

describe('callLlmQuizGenerator', () => {
  it('валідна відповідь LLM — генерує квіз з generatedBy = quiz-gen-<model>', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                question: 'Що станеться з версткою при варіанті B?',
                options: ['Логіка мігрує в composable', 'Зʼявиться новий .vue-файл', 'Нічого не зміниться'],
                correctIndex: 0,
                microlesson: 'Composable-и легше тестувати ізольовано від розмітки.'
              })
            }
          }
        ]
      })
    })
    const result = await callLlmQuizGenerator(
      { baseUrl: 'http://127.0.0.1:8080', model: 'gemma-4-26b-a4b-it' },
      decisionRequest,
      'B',
      fetchImpl
    )
    expect(result).toMatchObject({ generatedBy: 'quiz-gen-gemma-4-26b-a4b-it', correctIndex: 0 })
    expect(result.options).toHaveLength(3)
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8080/v1/chat/completions', expect.any(Object))
  })

  it('мережева помилка — повертає null, не кидає', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await callLlmQuizGenerator(defaultLlmConfig(), decisionRequest, 'B', fetchImpl)
    expect(result).toBeNull()
  })

  it('не-2xx відповідь — повертає null', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false })
    expect(await callLlmQuizGenerator(defaultLlmConfig(), decisionRequest, 'B', fetchImpl)).toBeNull()
  })

  it('невалідна форма JSON (не 3 варіанти) — повертає null', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ question: 'x', options: ['a', 'b'], correctIndex: 0, microlesson: 'y' })
            }
          }
        ]
      })
    })
    expect(await callLlmQuizGenerator(defaultLlmConfig(), decisionRequest, 'B', fetchImpl)).toBeNull()
  })

  it('битий JSON у content — повертає null, не кидає', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content: 'not json' } }] }) })
    expect(await callLlmQuizGenerator(defaultLlmConfig(), decisionRequest, 'B', fetchImpl)).toBeNull()
  })
})

describe('fallbackQuiz', () => {
  it('детермінований — той самий вхід дає той самий результат (без мережі)', () => {
    const a = fallbackQuiz(decisionRequest, 'B')
    const b = fallbackQuiz(decisionRequest, 'B')
    expect(a).toEqual(b)
  })

  it('generatedBy: quiz-gen-fallback', () => {
    expect(fallbackQuiz(decisionRequest, 'B').generatedBy).toBe('quiz-gen-fallback')
  })

  it('правильна відповідь у options на позиції correctIndex — текст обраного варіанта', () => {
    const quiz = fallbackQuiz(decisionRequest, 'B')
    expect(quiz.options).toHaveLength(3)
    expect(quiz.options[quiz.correctIndex]).toMatch(COMPOSABLE_RE)
  })
})

describe('generateQuiz', () => {
  it('LLM недоступний — падає на фолбек, квіз все одно повертається (квіз ніколи не пропускається)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'))
    const quiz = await generateQuiz({ decisionRequest, chosenOption: 'B', fetchImpl })
    expect(quiz.generatedBy).toBe('quiz-gen-fallback')
  })

  it('generated_by ніколи не дорівнює recommended_by decision-request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ question: 'q', options: ['1', '2', '3'], correctIndex: 0, microlesson: 'm' })
            }
          }
        ]
      })
    })
    // Підміняємо модель на значення, що штучно збігається з recommended_by фікстури.
    const quiz = await generateQuiz({
      decisionRequest,
      chosenOption: 'B',
      llmConfig: { baseUrl: 'http://127.0.0.1:8080', model: decisionRequest.recommendedBy.replace('quiz-gen-', '') },
      fetchImpl
    })
    expect(quiz.generatedBy).not.toBe(decisionRequest.recommendedBy)
  })
})

describe('formatQuizFile / parseQuizFile — round trip', () => {
  const quizState = {
    decisionRef: '0001-decision-request.md',
    depth: 'one-tap',
    generatedBy: 'quiz-gen-fallback',
    iterations: 1,
    timeToUnderstandingSec: 47,
    attempts: [
      {
        question: 'Що станеться з бюджетом задачі, якщо обереш варіант B?',
        options: ['Логіка мігрує в composable', 'Новий .vue-файл', 'Нічого не зміниться'],
        correctAnswer: 'Логіка мігрує в composable',
        microlesson: 'Composable-и легше тестувати ізольовано.'
      }
    ]
  }

  it('schema_version — перше поле фронтматера', () => {
    const text = formatQuizFile(quizState)
    expect(text.startsWith('---\nschema_version: 1\ntype: quiz\n')).toBe(true)
  })

  it('містить усі контрактні поля фронтматера (mandates.md)', () => {
    const text = formatQuizFile(quizState)
    expect(text).toMatch(DECISION_REF_FIELD_RE)
    expect(text).toMatch(DEPTH_FIELD_RE)
    expect(text).toMatch(GENERATED_BY_FIELD_RE)
    expect(text).toMatch(TIME_TO_UNDERSTANDING_FIELD_RE)
    expect(text).toMatch(ITERATIONS_FIELD_RE)
  })

  it('НЕ містить поля passed/failed (mandates.md: «схема свідомо без passed/failed»)', () => {
    expect(formatQuizFile(quizState)).not.toMatch(PASSED_FAILED_RE)
  })

  it('round-trip parseQuizFile(formatQuizFile(x)) відновлює ключові поля', () => {
    const parsed = parseQuizFile(formatQuizFile(quizState))
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.decisionRef).toBe('0001-decision-request.md')
    expect(parsed.depth).toBe('one-tap')
    expect(parsed.generatedBy).toBe('quiz-gen-fallback')
    expect(parsed.iterations).toBe(1)
    expect(parsed.timeToUnderstandingSec).toBe(47)
    expect(parsed.attempts).toHaveLength(1)
    expect(parsed.attempts[0].question).toBe(quizState.attempts[0].question)
    expect(parsed.attempts[0].correctAnswer).toBe('Логіка мігрує в composable')
  })

  it('другий блок дописується як «Питання 1 (спроба 2)», не «Питання 2»', () => {
    const twoAttempts = {
      ...quizState,
      iterations: 2,
      attempts: [quizState.attempts[0], quizState.attempts[0]]
    }
    const text = formatQuizFile(twoAttempts)
    expect(text).toMatch(QUESTION_1_RE)
    expect(text).toMatch(QUESTION_1_ATTEMPT_2_RE)
    expect(text).not.toMatch(QUESTION_2_RE)
    expect(parseQuizFile(text).attempts).toHaveLength(2)
  })

  it('shown_at присутній лише в чернетці (без timeToUnderstandingSec), зникає після фіналізації', () => {
    const draft = { ...quizState, timeToUnderstandingSec: undefined, shownAt: '2026-08-09T10:00:00.000Z' }
    const draftText = formatQuizFile(draft)
    expect(draftText).toMatch(SHOWN_AT_VALUE_RE)
    expect(parseQuizFile(draftText).shownAt).toBe('2026-08-09T10:00:00.000Z')

    const finalText = formatQuizFile(quizState)
    expect(finalText).not.toMatch(SHOWN_AT_FIELD_RE)
  })
})
