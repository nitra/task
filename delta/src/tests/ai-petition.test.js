import { describe, expect, it } from 'vitest'
import { aiPetition, buildEvidenceText, formatPetitionFile, verifyPetition } from '../ai-petition.js'
import { changeProposalDecisionsDir, changeProposalRunId, readChangeProposal } from '../change-proposal.js'
import { parseDecisionRequest } from '../decisions.js'
import { generateDeviceKeypair, signPayload } from '../signing.js'

const MANDATES_DIR = '/root'

const NO_EVIDENCE_RE = /Немає підписаних рішень/
const FIVE_DECISIONS_RE = /5 підписаних рішень/
const OVERRIDE_FRACTION_RE = /4\/5 без наступного людського override/
const EIGHTY_PERCENT_RE = /80%/
const NOT_QUALITY_RE = /НЕ оцінка якості/
const THREE_DECISIONS_RE = /3 підписаних рішень/

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
 * @returns {{generation: number, mandates: object[]}} базовий файл fable-5/olena/vitalii
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

describe('buildEvidenceText — «активність і послідовність», не success rate', () => {
  it('нуль рішень — чесний текст про відсутність evidence', () => {
    const text = buildEvidenceText({ totalDecisions: 0, byDecisionType: [], overrideFreeCount: 0, overrideFreeRate: null })
    expect(text).toMatch(NO_EVIDENCE_RE)
  })

  it('є рішення — текст явно НЕ каже "success"/"якість", лише активність і override-частку', () => {
    const text = buildEvidenceText({
      totalDecisions: 5,
      byDecisionType: [{ decisionType: 'ops', count: 5 }],
      overrideFreeCount: 4,
      overrideFreeRate: 0.8
    })
    expect(text).toMatch(FIVE_DECISIONS_RE)
    expect(text).toMatch(OVERRIDE_FRACTION_RE)
    expect(text).toMatch(EIGHTY_PERCENT_RE)
    expect(text).toMatch(NOT_QUALITY_RE)
  })
})

describe('aiPetition', () => {
  it('пише петицію (підписану модельним ключем) і change-proposal decision-request у чергу делегатора', async () => {
    const old = baseFile(3)
    const newFile = structuredClone(old)
    newFile.generation = 4
    newFile.mandates[0].thresholds.audacity = 'medium'

    const modelDeviceKey = await generateDeviceKeypair()
    const io = memoryIo()
    const trackRecord = { totalDecisions: 3, byDecisionType: [{ decisionType: 'ops', count: 3 }], overrideFreeCount: 3, overrideFreeRate: 1 }

    const result = await aiPetition({
      io,
      mandatesDir: MANDATES_DIR,
      changeId: 'mc-petition-1',
      old,
      new: newFile,
      modelHandle: 'fable-5',
      delegatorHandle: 'olena',
      trackRecord,
      modelDeviceKey,
      now: () => new Date('2026-08-09T12:00:00.000Z')
    })

    expect(result.petitionPath).toBe(`${changeProposalDecisionsDir(MANDATES_DIR, 'mc-petition-1')}/0001-petition.json`)
    const petitionText = io.store.get(result.petitionPath)
    const petition = JSON.parse(petitionText)
    expect(petition.model_handle).toBe('fable-5')
    expect(petition.type).toBe('ai-petition')
    expect(await verifyPetition(petition)).toBe(true)

    const decisionText = io.store.get(result.decisionRequestPath)
    const parsed = parseDecisionRequest(decisionText, { path: result.decisionRequestPath, runId: changeProposalRunId('mc-petition-1'), nnnn: '0001' })
    expect(parsed.computedOwner).toBe('olena') // черга людини-делегатора, не моделі
    expect(parsed.recommendedBy).toBe('ai-petition-fable-5')
    expect(parsed.decisionType).toBe('mandate-change')
    expect(parsed.context).toMatch(THREE_DECISIONS_RE)

    const changeJson = await readChangeProposal(io, MANDATES_DIR, 'mc-petition-1')
    expect(changeJson).toEqual({ old, new: newFile })
  })

  it('петиція НЕ підписує саму зміну — decision-request лишається непідписаним approval.json', async () => {
    const old = baseFile(3)
    const newFile = structuredClone(old)
    newFile.generation = 4
    newFile.mandates[0].thresholds.audacity = 'medium'
    const modelDeviceKey = await generateDeviceKeypair()
    const io = memoryIo()

    const { decisionRequestPath } = await aiPetition({
      io,
      mandatesDir: MANDATES_DIR,
      changeId: 'mc-petition-2',
      old,
      new: newFile,
      modelHandle: 'fable-5',
      delegatorHandle: 'olena',
      trackRecord: { totalDecisions: 0, byDecisionType: [], overrideFreeCount: 0, overrideFreeRate: null },
      modelDeviceKey
    })
    const approvalPath = decisionRequestPath.replace('0001-decision-request.md', '0001-approval.json')
    expect(io.store.has(approvalPath)).toBe(false)
  })
})

describe('formatPetitionFile', () => {
  it('pretty-print JSON з кінцевим переносом рядка', async () => {
    const { privateKeyJwk, publicKeyBase64 } = await generateDeviceKeypair()
    const payload = { schema_version: 1, type: 'ai-petition', model_handle: 'fable-5' }
    const signature = await signPayload(privateKeyJwk, payload)
    const petition = { ...payload, pubkey: publicKeyBase64, signature }
    const text = formatPetitionFile(petition)
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(petition)
  })
})
