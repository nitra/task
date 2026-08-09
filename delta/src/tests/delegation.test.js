import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildAndSignDelegation, delegateDecision, delegationQuiz, findEligibleModel, formatDelegationFile, submitDelegationAnswer } from '../delegation.js'
import { deriveQueue } from '../decisions.js'
import { parseMandatesFile } from '../mandate-change.js'
import { generateDeviceKeypair, verifyPayload } from '../signing.js'

const MANDATES_TEXT = readFileSync(join(import.meta.dirname, 'fixtures/mandates.yaml'), 'utf8')
const { mandates } = parseMandatesFile(MANDATES_TEXT) // fable-5: kind: model, scope.decision_types: [ops], escalates_to: olena

const DECISIONS_DIR = '/root/runs/demo-1/decisions'
const DR_OPS_TEXT = readFileSync(join(import.meta.dirname, 'fixtures/runs/demo-1/decisions/0004-decision-request.md'), 'utf8')

const DEPTH_ONE_TAP_RE = /depth: one-tap/
const OPTION_LINE_RE = /^- [A-Z]\.\s(.*)$/gm
const ANSWER_SECTION_RE = /### Відповідь\n(.+)/
const NOT_GENERATED_RE = /ще не згенеровано/
const ALREADY_DELEGATED_RE = /уже делеговано/
const ALREADY_CLOSED_RE = /вже закрите/
const NOW = () => new Date('2026-08-09T10:00:00.000Z')

/**
 * @param {object} [seed] початковий вміст сховища
 * @returns {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>, store: Map<string,string>}}
 *   in-memory fs-double, той самий контракт, що decision-flow.test.js
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

describe('findEligibleModel', () => {
  it('модель з мандатом під тим самим делегатором, чий scope покриває decisionType', () => {
    const model = findEligibleModel(mandates, 'ops', 'olena')
    expect(model?.owner).toBe('fable-5')
  })

  it('немає покриття (decisionType поза scope) — null', () => {
    expect(findEligibleModel(mandates, 'architecture', 'olena')).toBeNull()
  })

  it('модель під ІНШИМ делегатором не повертається (директорська відповідальність — лише СВОЯ модель)', () => {
    expect(findEligibleModel(mandates, 'ops', 'vitalii')).toBeNull()
  })
})

describe('delegationQuiz / submitDelegationAnswer — one-tap мета-квіз, детермінований (без LLM)', () => {
  it('перший виклик пише one-tap квіз-файл (depth: one-tap)', async () => {
    const io = memoryIo()
    const result = await delegationQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0004', modelHandle: 'fable-5', decisionRequestText: DR_OPS_TEXT })
    expect(result.options).toHaveLength(3)
    expect(io.store.get(`${DECISIONS_DIR}/0004-delegation-quiz.md`)).toMatch(DEPTH_ONE_TAP_RE)
  })

  it('повторний виклик показує ТЕ САМЕ питання без регенерації', async () => {
    const io = memoryIo()
    const first = await delegationQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0004', modelHandle: 'fable-5', decisionRequestText: DR_OPS_TEXT })
    const second = await delegationQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0004', modelHandle: 'fable-5', decisionRequestText: DR_OPS_TEXT })
    expect(second.question).toBe(first.question)
    expect(second.options).toEqual(first.options)
  })

  it('неправильна відповідь — iterations++, квіз лишається', async () => {
    const io = memoryIo()
    await delegationQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0004', modelHandle: 'fable-5', decisionRequestText: DR_OPS_TEXT })
    const quizText = io.store.get(`${DECISIONS_DIR}/0004-delegation-quiz.md`)
    const options = Array.from(quizText.matchAll(OPTION_LINE_RE), m => m[1])
    const correctAnswer = ANSWER_SECTION_RE.exec(quizText)[1].trim()
    const wrongIndex = options.findIndex(o => o !== correctAnswer)

    const result = await submitDelegationAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0004', answer: wrongIndex })
    expect(result.correct).toBe(false)
    expect(result.iterations).toBe(2)
  })

  it('кидає, якщо квіз ще не згенеровано', async () => {
    const io = memoryIo()
    await expect(submitDelegationAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0004', answer: 0 })).rejects.toThrow(NOT_GENERATED_RE)
  })
})

describe('buildAndSignDelegation', () => {
  it('канонікалізований payload, {delegated_to, delegated_by, signed_at, pubkey, signature, quiz_ref}', async () => {
    const { privateKeyJwk, publicKeyBase64 } = await generateDeviceKeypair()
    const record = await buildAndSignDelegation({
      requestId: 'demo-1/0004',
      decisionRef: '0004-decision-request.md',
      delegatedTo: 'fable-5',
      delegatedBy: 'olena',
      quizRef: 'decisions/0004-delegation-quiz.md',
      privateKeyJwk,
      publicKeyBase64,
      now: NOW
    })
    expect(record).toMatchObject({
      delegated_to: 'fable-5',
      delegated_by: 'olena',
      quiz_ref: 'decisions/0004-delegation-quiz.md',
      signed_at: '2026-08-09T10:00:00.000Z',
      pubkey: publicKeyBase64
    })
    const { pubkey, signature, ...payload } = record
    expect(await verifyPayload(pubkey, payload, signature)).toBe(true)
  })
})

describe('delegateDecision — повний потік decision_delegate', () => {
  it('правильна відповідь — пише підписаний NNNN-delegation.json, decision-request НЕ мутується', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0004-decision-request.md`]: DR_OPS_TEXT })
    await delegationQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0004', modelHandle: 'fable-5', decisionRequestText: DR_OPS_TEXT })
    const quizText = io.store.get(`${DECISIONS_DIR}/0004-delegation-quiz.md`)
    const correctAnswer = ANSWER_SECTION_RE.exec(quizText)[1].trim()

    const deviceKey = await generateDeviceKeypair()
    const result = await delegateDecision({
      io,
      decisionsDir: DECISIONS_DIR,
      runId: 'demo-1',
      nnnn: '0004',
      modelHandle: 'fable-5',
      delegatedByHandle: 'olena',
      answer: correctAnswer,
      deviceKey
    })
    expect(result.delegated).toBe(true)
    expect(result.delegation.delegated_to).toBe('fable-5')
    expect(io.store.get(`${DECISIONS_DIR}/0004-decision-request.md`)).toBe(DR_OPS_TEXT) // незмінний — деривація, не мутація
  })

  it('декоративна перевірка деривації: deriveQueue переносить розвилку з черги olena в чергу fable-5', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0004-decision-request.md`]: DR_OPS_TEXT })
    await delegationQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0004', modelHandle: 'fable-5', decisionRequestText: DR_OPS_TEXT })
    const quizText = io.store.get(`${DECISIONS_DIR}/0004-delegation-quiz.md`)
    const correctAnswer = ANSWER_SECTION_RE.exec(quizText)[1].trim()
    await delegateDecision({
      io,
      decisionsDir: DECISIONS_DIR,
      runId: 'demo-1',
      nnnn: '0004',
      modelHandle: 'fable-5',
      delegatedByHandle: 'olena',
      answer: correctAnswer,
      deviceKey: await generateDeviceKeypair()
    })

    const decisionsDirs = [
      {
        dir: DECISIONS_DIR,
        files: [
          { name: '0004-decision-request.md', content: io.store.get(`${DECISIONS_DIR}/0004-decision-request.md`) },
          { name: '0004-delegation.json', content: io.store.get(`${DECISIONS_DIR}/0004-delegation.json`) }
        ]
      }
    ]
    expect(deriveQueue(decisionsDirs, 'olena')).toEqual([])
    const [item] = deriveQueue(decisionsDirs, 'fable-5')
    expect(item.nnnn).toBe('0004')
    expect(item.delegatedTo).toBe('fable-5')
    expect(item.delegatedBy).toBe('olena')
  })

  it('уже делеговано — повторне делегування кидає', async () => {
    const io = memoryIo({
      [`${DECISIONS_DIR}/0004-decision-request.md`]: DR_OPS_TEXT,
      [`${DECISIONS_DIR}/0004-delegation.json`]: formatDelegationFile({ delegated_to: 'fable-5' })
    })
    await expect(
      delegateDecision({ io, decisionsDir: DECISIONS_DIR, runId: 'demo-1', nnnn: '0004', modelHandle: 'fable-5', delegatedByHandle: 'olena', answer: 0, deviceKey: await generateDeviceKeypair() })
    ).rejects.toThrow(ALREADY_DELEGATED_RE)
  })

  it('рішення вже закрите (approval) — кидає', async () => {
    const io = memoryIo({
      [`${DECISIONS_DIR}/0004-decision-request.md`]: DR_OPS_TEXT,
      [`${DECISIONS_DIR}/0004-approval.json`]: '{"approved":true}'
    })
    await expect(
      delegateDecision({ io, decisionsDir: DECISIONS_DIR, runId: 'demo-1', nnnn: '0004', modelHandle: 'fable-5', delegatedByHandle: 'olena', answer: 0, deviceKey: await generateDeviceKeypair() })
    ).rejects.toThrow(ALREADY_CLOSED_RE)
  })
})
