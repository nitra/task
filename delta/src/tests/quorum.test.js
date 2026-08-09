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

const REJECTING_FETCH = vi.fn().mockRejectedValue(new Error('no network in tests'))

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
      quorumQuiz({
        io,
        decisionsDir: DECISIONS_DIR,
        nnnn: '0001',
        signerHandle: 'olena',
        chosenOption: 'B',
        fetchImpl: REJECTING_FETCH
      })
    ).rejects.toThrow(NOT_IRREVERSIBLE_RE)
  })

  it('кидає, коли signerHandle не входить до approvers', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    await expect(
      quorumQuiz({
        io,
        decisionsDir: DECISIONS_DIR,
        nnnn: '0001',
        signerHandle: 'fable-5',
        chosenOption: 'A',
        fetchImpl: REJECTING_FETCH
      })
    ).rejects.toThrow(NOT_APPROVER_RE)
  })

  it('перший виклик генерує 2 standard-питання (форсована depth), пише ВЛАСНИЙ квіз-файл підписанта', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    const result = await quorumQuiz({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      signerHandle: 'olena',
      chosenOption: 'A',
      fetchImpl: REJECTING_FETCH
    })
    expect(result.depth).toBe('standard')
    expect(result.questionCount).toBe(2)
    expect(result.questionIndex).toBe(1)
    expect(result.signerHandle).toBe('olena')
    expect(io.store.has(`${DECISIONS_DIR}/0001-quiz-olena.md`)).toBe(true)
    // Vitalii — окремий підписант, окремий (ще не написаний) квіз-файл.
    expect(io.store.has(`${DECISIONS_DIR}/0001-quiz-vitalii.md`)).toBe(false)
  })

  it('повторний виклик показує ТЕ САМЕ активне питання, не регенерує', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    const first = await quorumQuiz({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      signerHandle: 'olena',
      chosenOption: 'A',
      fetchImpl: REJECTING_FETCH
    })
    const second = await quorumQuiz({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      signerHandle: 'olena',
      chosenOption: 'A',
      fetchImpl: REJECTING_FETCH
    })
    expect(second.question).toBe(first.question)
    expect(second.options).toEqual(first.options)
  })

  it('два підписанти отримують НЕЗАЛЕЖНІ квіз-файли одного decision-request', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    await quorumQuiz({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      signerHandle: 'olena',
      chosenOption: 'A',
      fetchImpl: REJECTING_FETCH
    })
    await quorumQuiz({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      signerHandle: 'vitalii',
      chosenOption: 'A',
      fetchImpl: REJECTING_FETCH
    })
    expect(io.store.has(`${DECISIONS_DIR}/0001-quiz-olena.md`)).toBe(true)
    expect(io.store.has(`${DECISIONS_DIR}/0001-quiz-vitalii.md`)).toBe(true)
  })

  it('кидає, якщо ЦЕЙ підписант уже підписав свою частину', async () => {
    const io = memoryIo({
      [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE,
      [`${DECISIONS_DIR}/0001-approval-olena.json`]: '{"chosen_option":"A"}'
    })
    await expect(
      quorumQuiz({
        io,
        decisionsDir: DECISIONS_DIR,
        nnnn: '0001',
        signerHandle: 'olena',
        chosenOption: 'A',
        fetchImpl: REJECTING_FETCH
      })
    ).rejects.toThrow(ALREADY_SIGNED_RE)
  })
})

describe('submitQuorumAnswer / quorumApprove — повний цикл одного підписанта', () => {
  it('кидає, якщо квіз ще не згенеровано', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    await expect(
      submitQuorumAnswer({ io, decisionsDir: DECISIONS_DIR, nnnn: '0001', signerHandle: 'olena', answer: 0 })
    ).rejects.toThrow(NOT_GENERATED_RE)
  })

  it('неправильна відповідь — iterations++, мікроурок, approval НЕ пишеться', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    await quorumQuiz({
      io,
      decisionsDir: DECISIONS_DIR,
      nnnn: '0001',
      signerHandle: 'olena',
      chosenOption: 'A',
      fetchImpl: REJECTING_FETCH
    })
    const result = await quorumApprove({
      io,
      decisionsDir: DECISIONS_DIR,
      runId: 'demo-5',
      nnnn: '0001',
      signerHandle: 'olena',
      chosenOption: 'A',
      answer: 'definitely not a real option',
      deviceKey: await generateDeviceKeypair(),
      fetchImpl: REJECTING_FETCH
    })
    expect(result.approved).toBe(false)
    expect(result.correct).toBe(false)
    expect(result.microlesson).toBeTruthy()
    expect(io.store.has(`${DECISIONS_DIR}/0001-approval-olena.json`)).toBe(false)
  })

  it('2/2 однаковий chosen_option — обидва підписи незалежно верифіковані, deriveQuorumStatus → closed', async () => {
    const io = memoryIo({ [`${DECISIONS_DIR}/0001-decision-request.md`]: DR_IRREVERSIBLE })
    const olenaKey = await generateDeviceKeypair()
    const vitaliiKey = await generateDeviceKeypair() // «другий пристрій» — незалежний keypair, той самий патерн, що mandate-change.test.js: signAs

    for (const { signerHandle, deviceKey } of [
      { signerHandle: 'olena', deviceKey: olenaKey },
      { signerHandle: 'vitalii', deviceKey: vitaliiKey }
    ]) {
      // Проводимо квіз до кінця — правильна відповідь виводиться з файлу
      // квізу самого підписанта (`### Відповідь` — quiz.js: parseQuizFile
      // уже дає correctAnswer через options.indexOf, тут простіше прочитати
      // сирий квіз-текст і знайти правильний варіант).
      await quorumQuiz({
        io,
        decisionsDir: DECISIONS_DIR,
        nnnn: '0001',
        signerHandle,
        chosenOption: 'A',
        fetchImpl: REJECTING_FETCH
      })
      const quizText = io.store.get(`${DECISIONS_DIR}/0001-quiz-${signerHandle}.md`)
      const correctAnswers = Array.from(quizText.matchAll(/### Відповідь\n(.+)/g), m => m[1])

      let result = await quorumApprove({
        io,
        decisionsDir: DECISIONS_DIR,
        runId: 'demo-5',
        nnnn: '0001',
        signerHandle,
        chosenOption: 'A',
        answer: correctAnswers[0],
        deviceKey,
        fetchImpl: REJECTING_FETCH
      })
      expect(result.done).toBe(false) // одне з двох питань standard-квізу
      result = await quorumApprove({
        io,
        decisionsDir: DECISIONS_DIR,
        runId: 'demo-5',
        nnnn: '0001',
        signerHandle,
        chosenOption: 'A',
        answer: correctAnswers[1],
        deviceKey,
        fetchImpl: REJECTING_FETCH
      })
      expect(result.approved).toBe(true)
      expect(result.done).toBe(true)
      expect(result.approval.signer_handle).toBe(signerHandle)
      expect(result.approval.chosen_option).toBe('A')

      expect(await verifyApproval(result.approval)).toBe(true)
    }

    // Обидва approval-файли незалежно записані під РІЗНИМИ pubkey.
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
      await quorumQuiz({
        io,
        decisionsDir: DECISIONS_DIR,
        nnnn: '0001',
        signerHandle,
        chosenOption,
        fetchImpl: REJECTING_FETCH
      })
      const quizText = io.store.get(`${DECISIONS_DIR}/0001-quiz-${signerHandle}.md`)
      const correctAnswers = Array.from(quizText.matchAll(/### Відповідь\n(.+)/g), m => m[1])
      await quorumApprove({
        io,
        decisionsDir: DECISIONS_DIR,
        runId: 'demo-5',
        nnnn: '0001',
        signerHandle,
        chosenOption,
        answer: correctAnswers[0],
        deviceKey,
        fetchImpl: REJECTING_FETCH
      })

      await quorumApprove({
        io,
        decisionsDir: DECISIONS_DIR,
        runId: 'demo-5',
        nnnn: '0001',
        signerHandle,
        chosenOption,
        answer: correctAnswers[1],
        deviceKey,
        fetchImpl: REJECTING_FETCH
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
