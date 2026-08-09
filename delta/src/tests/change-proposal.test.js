import { describe, expect, it, vi } from 'vitest'
import { applyMandateChangeProposal, applyMandateNarrow, changeProposalDecisionsDir, changeProposalRunId, describeMandateDiffLines, readChangeProposal, writeChangeProposal } from '../change-proposal.js'
import { decisionApprove, decisionQuiz } from '../decision-flow.js'
import { parseDecisionRequest } from '../decisions.js'
import { parseMandatesFile, validateMandateChange } from '../mandate-change.js'
import { generateDeviceKeypair } from '../signing.js'

const MANDATES_DIR = '/root'
const REJECTING_FETCH = vi.fn().mockRejectedValue(new Error('no network in tests'))
const DIFF_AUDACITY_RE = /thresholds\.audacity: low → high/
const OVERRIDE_TEXT_RE = /100% без override/
const OPTION_LINE_RE = /^- [A-Z]\.\s(.*)$/gm
const ANSWER_SECTION_RE = /### Відповідь\n([\s\S]*?)\n\n### Мікроурок/
const HUMAN_ONLY_RE = /людський/
const QUESTION_BLOCK_SPLIT_RE = /\n(?=## Питання)/

/**
 * @param {object} [seed] початковий вміст сховища
 * @returns {{store: Map<string,string>, readFile: (path:string) => Promise<string|null>, writeFile: (path:string, content:string) => Promise<void>}} in-memory io
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
 * @param {number} generation `generation` файлу
 * @returns {{generation: number, mandates: object[]}} базовий файл — olena (розширюється) escalates_to vitalii (делегатор), vitalii — корінь
 */
function baseFile(generation) {
  return {
    generation,
    mandates: [
      {
        owner: 'fable-5',
        kind: 'model',
        scope: { refs: ['refs/mt/tasks/routine/**'], decisionTypes: ['ops'] },
        thresholds: { budgetEur: 200, risk: 'low', irreversible: false, audacity: 'low' },
        escalatesTo: 'olena'
      },
      {
        owner: 'olena',
        kind: 'person',
        scope: { refs: ['refs/mt/tasks/design/**'], decisionTypes: ['architecture'] },
        thresholds: { budgetEur: 2000, risk: 'medium', irreversible: false, audacity: null },
        escalatesTo: 'vitalii'
      },
      {
        owner: 'vitalii',
        kind: 'person',
        scope: { refs: ['refs/mt/**'], decisionTypes: ['*'] },
        thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null },
        escalatesTo: null
      }
    ]
  }
}

/**
 * @param {{generation: number, mandates: object[]}} file файл для клонування
 * @returns {{generation: number, mandates: object[]}} глибокий клон
 */
function clone(file) {
  return structuredClone(file)
}

describe('describeMandateDiffLines', () => {
  it('перелічує лише змінені осі', () => {
    const old = baseFile(1).mandates[0]
    const newer = { ...old, thresholds: { ...old.thresholds, audacity: 'high' } }
    expect(describeMandateDiffLines(old, newer)).toEqual(['thresholds.audacity: low → high'])
  })
})

describe('buildChangeProposalMarkdown / writeChangeProposal', () => {
  it('computed_owner === делегатор, decision_type: mandate-change, глибина форсується на standard', async () => {
    const old = baseFile(3)
    const newFile = clone(old)
    newFile.generation = 4
    newFile.mandates[0].thresholds.audacity = 'high'

    const io = memoryIo()
    const { decisionRequestPath, changeJsonPath } = await writeChangeProposal({
      io,
      mandatesDir: MANDATES_DIR,
      changeId: 'mc-1',
      old,
      new: newFile,
      ownerHandle: 'fable-5',
      delegatorHandle: 'olena',
      initiatedBy: 'ai-petition-fable-5',
      reasonText: 'Тестове обґрунтування.',
      evidenceText: '3 рішення, 100% без override.'
    })

    expect(decisionRequestPath).toBe(`${changeProposalDecisionsDir(MANDATES_DIR, 'mc-1')}/0001-decision-request.md`)
    const text = io.store.get(decisionRequestPath)
    const parsed = parseDecisionRequest(text, { path: decisionRequestPath, runId: changeProposalRunId('mc-1'), nnnn: '0001' })
    expect(parsed.computedOwner).toBe('olena')
    expect(parsed.decisionType).toBe('mandate-change')
    expect(parsed.leverageFacets).toEqual({ irreversible: false, blastRadius: 'subtree', divergence: 'high', estCostEur: null })
    expect(parsed.recommendedBy).toBe('ai-petition-fable-5')
    expect(parsed.options.map(o => o.label)).toEqual(['A', 'B'])
    expect(parsed.context).toMatch(DIFF_AUDACITY_RE)
    expect(parsed.context).toMatch(OVERRIDE_TEXT_RE)

    const roundTrip = await readChangeProposal(io, MANDATES_DIR, 'mc-1')
    expect(roundTrip).toEqual({ old, new: newFile })
    expect(io.store.has(changeJsonPath)).toBe(true)
  })

  it('readChangeProposal на неіснуючий changeId — null', async () => {
    const io = memoryIo()
    expect(await readChangeProposal(io, MANDATES_DIR, 'ghost')).toBeNull()
  })
})

/**
 * @param {object} params вхідні параметри сценарію
 * @param {string} params.chosenOption обраний варіант ('A' застосувати / 'B' відхилити)
 * @returns {Promise<object>} `{verdict, io, old, newFile, deviceKey}` — результат повного потоку
 */
async function runFullFlow({ chosenOption }) {
  const old = baseFile(3)
  const newFile = clone(old)
  newFile.generation = 4
  newFile.mandates[0].thresholds.audacity = 'high' // розширення model-мандата fable-5

  const io = memoryIo()
  const changeId = 'mc-2'
  await writeChangeProposal({
    io,
    mandatesDir: MANDATES_DIR,
    changeId,
    old,
    new: newFile,
    ownerHandle: 'fable-5',
    delegatorHandle: 'olena',
    initiatedBy: 'ai-petition-fable-5',
    reasonText: 'Обґрунтування.',
    evidenceText: 'evidence'
  })

  const decisionsDir = changeProposalDecisionsDir(MANDATES_DIR, changeId)
  const deviceKey = await generateDeviceKeypair()

  // Людина (делегатор olena) проходить ЗВИЧАЙНИЙ M1/M2-конвеєр — квіз
  // depth: standard (форсовано), 2 питання про саму розвилку.
  await decisionQuiz({ io, decisionsDir, nnnn: '0001', chosenOption, fetchImpl: REJECTING_FETCH })
  const draft1 = io.store.get(`${decisionsDir}/0001-quiz.md`)
  const options1 = draft1.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray().slice(0, 3)
  const correctAnswer1 = ANSWER_SECTION_RE.exec(draft1)[1].trim()
  const correctIndex1 = options1.indexOf(correctAnswer1)
  const afterFirst = await decisionApprove({
    io,
    decisionsDir,
    runId: changeProposalRunId(changeId),
    nnnn: '0001',
    chosenOption,
    answer: correctIndex1,
    deviceKey
  })
  expect(afterFirst.done).toBe(false) // depth standard — 2 питання, ще не фіналізовано

  const draft2 = io.store.get(`${decisionsDir}/0001-quiz.md`)
  const blocks2 = draft2.split(QUESTION_BLOCK_SPLIT_RE)
  const secondBlock = blocks2[2]
  const options2 = secondBlock.matchAll(OPTION_LINE_RE).map(m => m[1]).toArray()
  const correctAnswer2 = ANSWER_SECTION_RE.exec(secondBlock)[1].trim()
  const correctIndex2 = options2.indexOf(correctAnswer2)
  const approveResult = await decisionApprove({
    io,
    decisionsDir,
    runId: changeProposalRunId(changeId),
    nnnn: '0001',
    chosenOption,
    answer: correctIndex2,
    deviceKey
  })
  expect(approveResult.approved).toBe(true) // квіз ЗАВЖДИ підписується (approved = «квіз здано», не «застосувати»)
  expect(approveResult.approval.chosen_option).toBe(chosenOption)

  const verdict = await applyMandateChangeProposal({
    io,
    mandatesYamlPath: '/root/.mt/mandates.yaml',
    old,
    new: newFile,
    approval: approveResult.approval,
    handle: 'olena',
    role: 'human',
    deviceKey
  })
  return { verdict, io, old, newFile, deviceKey }
}

describe('applyMandateChangeProposal — міст квіз-гейт → validate_mandate_change', () => {
  it('chosenOption A (застосувати) — mandates.yaml оновлюється, generation++', async () => {
    const { verdict, io, newFile } = await runFullFlow({ chosenOption: 'A' })
    expect(verdict).toEqual({ valid: true })
    expect(io.store.has('/root/.mt/mandates.yaml')).toBe(true)
    expect(parseMandatesFile(io.store.get('/root/.mt/mandates.yaml'))).toEqual(newFile)
  })

  it('chosenOption B (відхилити) — mandates.yaml НЕ чіпається, навіть якщо квіз-гейт пройдено', async () => {
    const { verdict, io } = await runFullFlow({ chosenOption: 'B' })
    expect(verdict.valid).toBe(false)
    expect(io.store.has('/root/.mt/mandates.yaml')).toBe(false)
  })

  it('спроба застосувати підписом делегатора з роллю model (а не human) — validate_mandate_change відхиляє («остання константа»)', async () => {
    const old = baseFile(3)
    const newFile = clone(old)
    newFile.generation = 4
    newFile.mandates[0].thresholds.audacity = 'high'
    const deviceKey = await generateDeviceKeypair()
    const fakeApproval = { approved: true, chosen_option: 'A' }

    const verdict = await applyMandateChangeProposal({
      io: memoryIo(),
      mandatesYamlPath: '/root/.mt/mandates.yaml',
      old,
      new: newFile,
      approval: fakeApproval,
      handle: 'olena',
      role: 'model', // делегатор існує, але підписує МОДЕЛЬНИМ ключем
      deviceKey
    })
    expect(verdict.valid).toBe(false)
    expect(verdict.reason).toMatch(HUMAN_ONLY_RE)
  })
})

describe('applyMandateNarrow — звуження, без квізу, одразу', () => {
  it('самопідпис owner — застосовується без decision-request/квізу', async () => {
    const old = baseFile(3)
    const newFile = clone(old)
    newFile.generation = 4
    newFile.mandates[1].thresholds.budgetEur = 1000 // olena звужує собі бюджет

    const deviceKey = await generateDeviceKeypair()
    const io = memoryIo()
    const verdict = await applyMandateNarrow({ io, mandatesYamlPath: '/root/.mt/mandates.yaml', old, new: newFile, handle: 'olena', role: 'human', deviceKey })
    expect(verdict).toEqual({ valid: true })
    expect(parseMandatesFile(io.store.get('/root/.mt/mandates.yaml'))).toEqual(newFile)
  })

  it('validateMandateChange напряму бачить той самий вердикт (узгодженість з mandate-change.js)', async () => {
    const old = baseFile(3)
    const newFile = clone(old)
    newFile.generation = 4
    newFile.mandates[1].thresholds.budgetEur = 1000
    const deviceKey = await generateDeviceKeypair()
    const io = memoryIo()
    await applyMandateNarrow({ io, mandatesYamlPath: '/root/.mt/mandates.yaml', old, new: newFile, handle: 'olena', role: 'human', deviceKey })
    const direct = await validateMandateChange({ old, new: newFile, signatures: [] })
    expect(direct.valid).toBe(false) // без підпису напряму — звуження вимагає самопідпису
  })
})
