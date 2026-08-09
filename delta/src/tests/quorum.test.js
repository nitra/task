import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { verifyApproval } from '../approval.js'
import { deriveQuorumStatus, parseDecisionRequest } from '../decisions.js'
import { loadQuorumStatus, quorumApprove, quorumQuiz, submitQuorumAnswer } from '../quorum.js'
import { generateDeviceKeypair } from '../signing.js'

const DECISIONS_DIR = '/root/runs/demo-5/decisions'
const DR_IRREVERSIBLE = readFileSync(
  join(import.meta.dirname, 'fixtures/runs/demo-5/decisions/0001-decision-request.md'),
  'utf8'
)
const DR_REVERSIBLE = readFileSync(
  join(import.meta.dirname, 'fixtures/runs/demo-1/decisions/0001-decision-request.md'),
  'utf8'
)

const NOT_IRREVERSIBLE_RE = /кворум-конвеєр/
const NOT_APPROVER_RE = /не входить до approvers/
const ALREADY_SIGNED_RE = /уже підписав/
const NOT_GENERATED_RE = /ще не згенеровано/
const TRANSCRIPT_REQUIRED_RE = /потрібен непорожній transcript/
const DEPTH_TEACHBACK_FIELD_RE = /depth: teach-back/
const UNAVAILABLE_MESSAGE_RE = /недоступний без локальної моделі/
const TEACHBACK_HEADING_RE = /## Переказ \(teach-back\)/

const REJECTING_FETCH = vi.fn().mockRejectedValue(new Error('no network in tests'))

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

describe('quorumQuiz', () => {
  it('кидає для НЕ-irreversible decision-request — кворум лише для irreversible', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_REVERSIBLE })
    await expect(
      quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena' })
    ).rejects.toThrow(NOT_IRREVERSIBLE_RE)
  })

  it('кидає, коли signerHandle не входить до approvers', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    await expect(
      quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'fable-5' })
    ).rejects.toThrow(NOT_APPROVER_RE)
  })

  it('перший виклик пише ВЛАСНИЙ teach-back-квіз-файл підписанта (depth: teach-back, M5)', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    const result = await quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena' })
    expect(result.depth).toBe('teach-back')
    expect(result.prompt).toBeTruthy()
    expect(result.signerHandle).toBe('olena')
    expect(result.iterations).toBe(0)
    expect(io.store.has(`${DECISIONS_DIR}/0001-quiz-olena.md`)).toBe(true)
    expect(io.store.get(`${DECISIONS_DIR}/0001-quiz-olena.md`)).toMatch(DEPTH_TEACHBACK_FIELD_RE)
    // Vitalii — окремий підписант, окремий (ще не написаний) квіз-файл.
    expect(io.store.has(`${DECISIONS_DIR}/0001-quiz-vitalii.md`)).toBe(false)
  })

  it('повторний виклик показує ТУ САМУ підказку без повторної генерації', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    const first = await quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena' })
    const second = await quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena' })
    expect(second.prompt).toBe(first.prompt)
    expect(second.iterations).toBe(0)
  })

  it('два підписанти отримують НЕЗАЛЕЖНІ teach-back-файли одного decision-request', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    await quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena' })
    await quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'vitalii' })
    expect(io.store.has(`${DECISIONS_DIR}/0001-quiz-olena.md`)).toBe(true)
    expect(io.store.has(`${DECISIONS_DIR}/0001-quiz-vitalii.md`)).toBe(true)
  })

  it('кидає, якщо ЦЕЙ підписант уже підписав свою частину', async () => {
    const io = memoryIo({
      [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE,
      [`${DECISIONS_DIR}/0001-approval-olena.json`]: '{"chosen_option":"A"}'
    })
    await expect(
      quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena' })
    ).rejects.toThrow(ALREADY_SIGNED_RE)
  })
})

describe('submitQuorumAnswer / quorumApprove — повний цикл одного підписанта (teach-back, M5)', () => {
  it('кидає, якщо квіз ще не згенеровано', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    await expect(
      submitQuorumAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena', transcript: 'x', chosenOption: 'A' })
    ).rejects.toThrow(NOT_GENERATED_RE)
  })

  it('кидає без transcript', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    await quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena' })
    await expect(
      submitQuorumAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena', chosenOption: 'A' })
    ).rejects.toThrow(TRANSCRIPT_REQUIRED_RE)
  })

  it('LLM недоступний — available: false, ЧЕСНА відмова, approval НЕ пишеться, спроба НЕ рахується', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    await quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena' })
    const result = await quorumApprove({
      io,
      decisionsDir: DECISIONS_DIR,
      runId: 'demo-5',
      nnnn: '0001',
      signerHandle: 'olena',
      chosenOption: 'A',
      transcript: 'Видаляємо базу постачальника без бекапу, незворотно.',
      deviceKey: await generateDeviceKeypair(),
      fetchImpl: REJECTING_FETCH
    })
    expect(result.approved).toBe(false)
    expect(result.available).toBe(false)
    expect(result.message).toMatch(UNAVAILABLE_MESSAGE_RE)
    expect(io.store.has(`${DECISIONS_DIR}/0001-approval-olena.json`)).toBe(false)
    expect(io.store.get(`${DECISIONS_DIR}/0001-quiz-olena.md`)).not.toMatch(TEACHBACK_HEADING_RE)
  })

  it('не зрозумів (understood: false) — iterations++, фідбек+missingAspects, approval НЕ пишеться', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    await quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena' })
    const result = await quorumApprove({
      io,
      decisionsDir: DECISIONS_DIR,
      runId: 'demo-5',
      nnnn: '0001',
      signerHandle: 'olena',
      chosenOption: 'A',
      transcript: 'щось коротке',
      deviceKey: await generateDeviceKeypair(),
      fetchImpl: teachBackFetch({ understood: false, missingAspects: ['головний ризик'], feedback: 'бракує ризику' })
    })
    expect(result.approved).toBe(false)
    expect(result.correct).toBe(false)
    expect(result.feedback).toBe('бракує ризику')
    expect(result.iterations).toBe(1)
    expect(io.store.has(`${DECISIONS_DIR}/0001-approval-olena.json`)).toBe(false)
    expect(io.store.get(`${DECISIONS_DIR}/0001-quiz-olena.md`)).toMatch(TEACHBACK_HEADING_RE)
  })

  it('2/2 однаковий chosen_option — обидва підписи незалежно верифіковані, deriveQuorumStatus → closed', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    const olenaKey = await generateDeviceKeypair()
    const vitaliiKey = await generateDeviceKeypair() // «другий пристрій» — незалежний keypair

    for (const { signerHandle, deviceKey } of [
      { signerHandle: 'olena', deviceKey: olenaKey },
      { signerHandle: 'vitalii', deviceKey: vitaliiKey }
    ]) {
      await quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle })
      const result = await quorumApprove({
        io,
        decisionsDir: DECISIONS_DIR,
        runId: 'demo-5',
        nnnn: '0001',
        signerHandle,
        chosenOption: 'A',
        transcript: 'Обираю A: видаляємо базу постачальника без бекапу — незворотно, головний ризик втратити дані.',
        deviceKey,
        fetchImpl: teachBackFetch({ understood: true })
      })
      expect(result.approved).toBe(true)
      expect(result.done).toBe(true)
      expect(result.approval.signer_handle).toBe(signerHandle)
      expect(result.approval.chosen_option).toBe('A')
      expect(await verifyApproval(result.approval)).toBe(true)
    }

    const olenaApproval = JSON.parse(io.store.get(`${DECISIONS_DIR}/0001-approval-olena.json`))
    const vitaliiApproval = JSON.parse(io.store.get(`${DECISIONS_DIR}/0001-approval-vitalii.json`))
    expect(olenaApproval.pubkey).not.toBe(vitaliiApproval.pubkey)

    const dr = parseDecisionRequest(DR_IRREVERSIBLE, { nnnn: '0001' })
    const filesByName = new Map([
      ['0001-approval-olena.json', io.store.get(`${DECISIONS_DIR}/0001-approval-olena.json`)],
      ['0001-approval-vitalii.json', io.store.get(`${DECISIONS_DIR}/0001-approval-vitalii.json`)]
    ])
    expect(deriveQuorumStatus(dr, filesByName).status).toBe('closed')
  })

  it('розбіжність chosen_option — deriveQuorumStatus → diverged, обидва approval-файли валідні окремо', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    const olenaKey = await generateDeviceKeypair()
    const vitaliiKey = await generateDeviceKeypair()

    for (const { signerHandle, deviceKey, chosenOption } of [
      { signerHandle: 'olena', deviceKey: olenaKey, chosenOption: 'A' },
      { signerHandle: 'vitalii', deviceKey: vitaliiKey, chosenOption: 'B' }
    ]) {
      await quorumQuiz({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle })
      await quorumApprove({
        io,
        decisionsDir: DECISIONS_DIR,
        runId: 'demo-5',
        nnnn: '0001',
        signerHandle,
        chosenOption,
        transcript: `Обираю ${chosenOption}, головний наслідок і головний ризик враховано.`,
        deviceKey,
        fetchImpl: teachBackFetch({ understood: true })
      })
    }

    const dr = parseDecisionRequest(DR_IRREVERSIBLE, { nnnn: '0001' })
    const filesByName = new Map([
      ['0001-approval-olena.json', io.store.get(`${DECISIONS_DIR}/0001-approval-olena.json`)],
      ['0001-approval-vitalii.json', io.store.get(`${DECISIONS_DIR}/0001-approval-vitalii.json`)]
    ])
    const status = deriveQuorumStatus(dr, filesByName)
    expect(status.status).toBe('diverged')
    expect(status.signed.map(s => s.chosenOption).toSorted()).toEqual(['A', 'B'])
  })
})

describe('loadQuorumStatus', () => {
  it('точковий запит стану — той самий результат, що deriveQuorumStatus зі сканованих файлів', async () => {
    const io = memoryIo({
      [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE,
      [`${DECISIONS_DIR}/0001-approval-olena.json`]: JSON.stringify({
        chosen_option: 'A',
        signed_at: '2026-08-02T00:00:00.000Z'
      })
    })
    const status = await loadQuorumStatus({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001' })
    expect(status.status).toBe('pending')
    expect(status.pending).toEqual(['vitalii'])
    expect(status.signed).toEqual([{ handle: 'olena', chosenOption: 'A', signedAt: '2026-08-02T00:00:00.000Z' }])
  })
})
