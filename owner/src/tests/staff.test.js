import { describe, expect, it } from 'vitest'
import { briefingPrompt, buildDecisionDigest, objectionPrompt, parseBriefing, parseObjection } from '../staff.js'

const DECISION = {
  node: { path: 'goal', state: 'plan_review' },
  headline: 'план декомпозиції чекає approve / reject',
  stake: 3,
  actions: ['approve', 'reject']
}

describe('buildDecisionDigest', () => {
  it('вузол + причина + контракт, без children — без секції плану', () => {
    const digest = buildDecisionDigest({ decision: DECISION, mission: 'Зробити X' })
    expect(digest).toBe(
      'Вузол: goal [plan_review]\nПричина в черзі: план декомпозиції чекає approve / reject\nКонтракт: Зробити X'
    )
  })

  it('з children — додає перелік підзадач', () => {
    const digest = buildDecisionDigest({
      decision: DECISION,
      mission: 'Зробити X',
      children: [{ id: 'a', mode: 'agent', task: 'Крок A' }]
    })
    expect(digest).toContain('План — 1 підзадач:')
    expect(digest).toContain('- a [agent]: Крок A')
  })

  it('порожня місія — рядок контракту пропущено', () => {
    expect(buildDecisionDigest({ decision: DECISION, mission: '' })).not.toContain('Контракт:')
  })
})

describe('briefingPrompt / parseBriefing', () => {
  it('система вимагає JSON із чотирма полями', () => {
    const { system, user } = briefingPrompt('дайджест')
    expect(system).toContain('JSON')
    expect(user).toBe('дайджест')
  })

  it('розбирає валідну відповідь (у markdown-обгортці)', () => {
    const reply = '```json\n{"context":"x","options":["a","b"],"recommendation":"y","if_declined":"z"}\n```'
    expect(parseBriefing(reply)).toEqual({ context: 'x', options: ['a', 'b'], recommendation: 'y', ifDeclined: 'z' })
  })

  it('options опційні — дефолт порожній масив', () => {
    const reply = '{"context":"x","recommendation":"y","if_declined":"z"}'
    expect(parseBriefing(reply).options).toEqual([])
  })

  it('відхиляє відповідь без обовʼязкового поля чи без JSON', () => {
    expect(() => parseBriefing('{"context":"x"}')).toThrow('recommendation')
    expect(() => parseBriefing('нічого')).toThrow('без JSON')
  })
})

describe('objectionPrompt / parseObjection', () => {
  it('система вимагає найсильніше заперечення одним JSON-полем', () => {
    const { system } = objectionPrompt('дайджест')
    expect(system).toContain('НАЙСИЛЬНІШЕ')
    expect(system).toContain('JSON')
  })

  it('розбирає валідну відповідь', () => {
    expect(parseObjection('{"objection": "ризик X"}')).toBe('ризик X')
  })

  it('відхиляє порожнє заперечення чи биту відповідь', () => {
    expect(() => parseObjection('{"objection": ""}')).toThrow('порожнє')
    expect(() => parseObjection('не json')).toThrow('без JSON')
  })
})
