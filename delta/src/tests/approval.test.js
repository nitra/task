import { describe, expect, it } from 'vitest'
import {
  buildAndSignApproval,
  buildRequestId,
  formatApprovalFile,
  quizIsComplete,
  validateApprovalPreconditions,
  verifyApproval
} from '../approval.js'
import { generateDeviceKeypair } from '../signing.js'

const COMPLETED_QUIZ = { decisionRef: '0001-decision-request.md', iterations: 1, timeToUnderstandingSec: 47 }
const INCOMPLETE_QUIZ = { decisionRef: '0001-decision-request.md', iterations: null, timeToUnderstandingSec: null }
const QUIZ_REF_ERROR_RE = /quiz_ref/
const NOT_COMPLETE_ERROR_RE = /не завершено/
const MISMATCH_ERROR_RE = /не відповідає/

describe('quizIsComplete', () => {
  it('iterations + timeToUnderstandingSec присутні — завершено', () => {
    expect(quizIsComplete(COMPLETED_QUIZ)).toBe(true)
  })

  it('null/відсутні поля — не завершено', () => {
    expect(quizIsComplete(INCOMPLETE_QUIZ)).toBe(false)
    expect(quizIsComplete(null)).toBe(false)
    expect(quizIsComplete()).toBe(false)
  })

  it('iterations: 0 — не завершено (жодного заходу ще не було)', () => {
    expect(quizIsComplete({ iterations: 0, timeToUnderstandingSec: 5 })).toBe(false)
  })
})

describe('buildRequestId', () => {
  it('складає request_id як runId/nnnn', () => {
    expect(buildRequestId({ runId: 'demo-1', nnnn: '0001' })).toBe('demo-1/0001')
  })
})

describe('validateApprovalPreconditions', () => {
  it('без quiz_ref — кидає', () => {
    expect(() =>
      validateApprovalPreconditions({ quiz: COMPLETED_QUIZ, quizRef: null, decisionRef: '0001-decision-request.md' })
    ).toThrow(QUIZ_REF_ERROR_RE)
  })

  it('незавершений квіз — кидає', () => {
    expect(() =>
      validateApprovalPreconditions({
        quiz: INCOMPLETE_QUIZ,
        quizRef: 'decisions/0001-quiz.md',
        decisionRef: '0001-decision-request.md'
      })
    ).toThrow(NOT_COMPLETE_ERROR_RE)
  })

  it('quiz.decisionRef не відповідає decisionRef — кидає', () => {
    expect(() =>
      validateApprovalPreconditions({
        quiz: COMPLETED_QUIZ,
        quizRef: 'decisions/0001-quiz.md',
        decisionRef: '0002-decision-request.md'
      })
    ).toThrow(MISMATCH_ERROR_RE)
  })

  it('завершений квіз + узгоджений decisionRef + quizRef — не кидає', () => {
    expect(() =>
      validateApprovalPreconditions({
        quiz: COMPLETED_QUIZ,
        quizRef: 'decisions/0001-quiz.md',
        decisionRef: '0001-decision-request.md'
      })
    ).not.toThrow()
  })
})

describe('buildAndSignApproval / verifyApproval — інваріант «без квізу підпис неможливий»', () => {
  it('завершений квіз — підписує й повертає валідний за структурою ApprovalResponse', async () => {
    const { privateKeyJwk, publicKeyBase64 } = await generateDeviceKeypair()
    const approval = await buildAndSignApproval({
      requestId: 'demo-1/0001',
      chosenOption: 'B',
      quizRef: 'decisions/0001-quiz.md',
      quiz: COMPLETED_QUIZ,
      decisionRef: '0001-decision-request.md',
      privateKeyJwk,
      publicKeyBase64
    })
    expect(approval).toMatchObject({
      schema_version: 1,
      request_id: 'demo-1/0001',
      approved: true,
      chosen_option: 'B',
      quiz_ref: 'decisions/0001-quiz.md',
      pubkey: publicKeyBase64
    })
    expect(typeof approval.signed_at).toBe('string')
    expect(typeof approval.signature).toBe('string')
  })

  it('підписаний approval проходить verifyApproval', async () => {
    const { privateKeyJwk, publicKeyBase64 } = await generateDeviceKeypair()
    const approval = await buildAndSignApproval({
      requestId: 'demo-1/0001',
      chosenOption: 'B',
      quizRef: 'decisions/0001-quiz.md',
      quiz: COMPLETED_QUIZ,
      decisionRef: '0001-decision-request.md',
      privateKeyJwk,
      publicKeyBase64
    })
    expect(await verifyApproval(approval)).toBe(true)
  })

  it('незавершений квіз — buildAndSignApproval кидає ДО підпису (жодного підпису не потрапляє в git без квізу)', async () => {
    const { privateKeyJwk, publicKeyBase64 } = await generateDeviceKeypair()
    await expect(
      buildAndSignApproval({
        requestId: 'demo-1/0001',
        chosenOption: 'B',
        quizRef: 'decisions/0001-quiz.md',
        quiz: INCOMPLETE_QUIZ,
        decisionRef: '0001-decision-request.md',
        privateKeyJwk,
        publicKeyBase64
      })
    ).rejects.toThrow(NOT_COMPLETE_ERROR_RE)
  })

  it('відсутній quiz_ref — buildAndSignApproval кидає ДО підпису', async () => {
    const { privateKeyJwk, publicKeyBase64 } = await generateDeviceKeypair()
    await expect(
      buildAndSignApproval({
        requestId: 'demo-1/0001',
        chosenOption: 'B',
        quizRef: null,
        quiz: COMPLETED_QUIZ,
        decisionRef: '0001-decision-request.md',
        privateKeyJwk,
        publicKeyBase64
      })
    ).rejects.toThrow(QUIZ_REF_ERROR_RE)
  })

  it('підроблений approval (чужий pubkey) не проходить verifyApproval', async () => {
    const legit = await generateDeviceKeypair()
    const impostor = await generateDeviceKeypair()
    const approval = await buildAndSignApproval({
      requestId: 'demo-1/0001',
      chosenOption: 'B',
      quizRef: 'decisions/0001-quiz.md',
      quiz: COMPLETED_QUIZ,
      decisionRef: '0001-decision-request.md',
      privateKeyJwk: legit.privateKeyJwk,
      publicKeyBase64: legit.publicKeyBase64
    })
    const tampered = { ...approval, pubkey: impostor.publicKeyBase64 }
    expect(await verifyApproval(tampered)).toBe(false)
  })
})

describe('formatApprovalFile', () => {
  it('серіалізує у pretty-print JSON з кінцевим переносом рядка', () => {
    const text = formatApprovalFile({ schema_version: 1, request_id: 'demo-1/0001' })
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual({ schema_version: 1, request_id: 'demo-1/0001' })
  })
})
