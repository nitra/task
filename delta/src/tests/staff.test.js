import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseDecisionRequest } from '../decisions.js'
import { buildStaffBriefPrompt, callLlmStaffBrief, decisionBrief, defaultStaffLlmConfig, fallbackStaffBrief } from '../staff.js'

const DR_TEXT = readFileSync(
  join(import.meta.dirname, 'fixtures/runs/demo-1/decisions/0001-decision-request.md'),
  'utf8'
)
const decisionRequest = parseDecisionRequest(DR_TEXT, { path: 'x', nnnn: '0001' })

const REJECTING_FETCH = vi.fn().mockRejectedValue(new Error('no network in tests'))

const CONTEXT_RE = /MandateCard\.vue/
const RECOMMENDATION_HEADING_RE = /Рекомендація агента/
const DELAY_HEADING_RE = /Ціна затримки/
const DESIGN_REVIEW_RE = /design-review/
const STAFF_BRIEF_PREFIX_RE = /^staff-brief-/

const VALID_BRIEF_PAYLOAD = {
  contextSummary: 'Речення 1. Речення 2. Речення 3.',
  options: [
    { label: 'A', priceLine: 'Новий файл, чистіші тести.' },
    { label: 'B', priceLine: 'Без нового файлу, логіка в JS.' }
  ],
  recommendationSummary: 'Composable лишає верстку локальною.',
  strongestObjection: 'Composable без типів гірше документується, ніж окремий компонент.',
  delaySummary: 'Блокує вихід design-review вузла.'
}

describe('defaultStaffLlmConfig', () => {
  it('той самий дефолт, що quiz.js', () => {
    expect(defaultStaffLlmConfig()).toEqual({ baseUrl: 'http://127.0.0.1:8080', model: 'gemma-4-26b-a4b-it' })
  })
})

describe('buildStaffBriefPrompt', () => {
  it('включає контекст, варіанти, рекомендацію, ціну затримки', () => {
    const prompt = buildStaffBriefPrompt(decisionRequest)
    expect(prompt).toMatch(CONTEXT_RE)
    expect(prompt).toMatch(RECOMMENDATION_HEADING_RE)
    expect(prompt).toMatch(DELAY_HEADING_RE)
    expect(prompt).toMatch(DESIGN_REVIEW_RE)
  })
})

describe('callLlmStaffBrief', () => {
  it('валідна відповідь — generatedBy: staff-brief-<model>', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ choices: [{ message: { content: JSON.stringify(VALID_BRIEF_PAYLOAD) } }] })
    })
    const result = await callLlmStaffBrief(defaultStaffLlmConfig(), decisionRequest, fetchImpl)
    expect(result.generatedBy).toBe('staff-brief-gemma-4-26b-a4b-it')
    expect(result.options).toHaveLength(2)
    expect(result.strongestObjection).toBe(VALID_BRIEF_PAYLOAD.strongestObjection)
  })

  it('мережева помилка — null, не кидає', async () => {
    const result = await callLlmStaffBrief(defaultStaffLlmConfig(), decisionRequest, REJECTING_FETCH)
    expect(result).toBeNull()
  })

  it('не-2xx відповідь — null', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false })
    expect(await callLlmStaffBrief(defaultStaffLlmConfig(), decisionRequest, fetchImpl)).toBeNull()
  })

  it('невалідна форма (без strongestObjection) — null', async () => {
    const { strongestObjection: _drop, ...rest } = VALID_BRIEF_PAYLOAD
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content: JSON.stringify(rest) } }] }) })
    expect(await callLlmStaffBrief(defaultStaffLlmConfig(), decisionRequest, fetchImpl)).toBeNull()
  })

  it('битий JSON у content — null, не кидає', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => ({ choices: [{ message: { content: 'not json' } }] }) })
    expect(await callLlmStaffBrief(defaultStaffLlmConfig(), decisionRequest, fetchImpl)).toBeNull()
  })
})

describe('fallbackStaffBrief', () => {
  it('структурний витяг БЕЗ стискання — generatedBy: staff-brief-fallback, немає strongestObjection', () => {
    const brief = fallbackStaffBrief(decisionRequest)
    expect(brief.generatedBy).toBe('staff-brief-fallback')
    expect(brief.strongestObjection).toBeNull()
    expect(brief.contextSummary).toBe(decisionRequest.context)
    expect(brief.options).toHaveLength(decisionRequest.options.length)
    expect(brief.options[0]).toMatchObject({ label: decisionRequest.options[0].label })
  })
})

describe('decisionBrief', () => {
  it('LLM доступний — compressed: true', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => ({ choices: [{ message: { content: JSON.stringify(VALID_BRIEF_PAYLOAD) } }] })
    })
    const brief = await decisionBrief({ decisionRequest, fetchImpl })
    expect(brief.compressed).toBe(true)
    expect(brief.generatedBy).toMatch(STAFF_BRIEF_PREFIX_RE)
  })

  it('LLM недоступний — фолбек, compressed: false, чесно позначений', async () => {
    const brief = await decisionBrief({ decisionRequest, fetchImpl: REJECTING_FETCH })
    expect(brief.compressed).toBe(false)
    expect(brief.generatedBy).toBe('staff-brief-fallback')
    expect(brief.strongestObjection).toBeNull()
  })
})
