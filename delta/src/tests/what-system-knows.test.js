import { describe, expect, it } from 'vitest'
import { buildWhatSystemKnows } from '../what-system-knows.js'

const KNOWLEDGE_ENTRIES = [
  {
    decisionRef: '0001-decision-request.md',
    domain: 'architecture',
    question: 'q1',
    microlesson: 'm1',
    timeToUnderstandingSec: 60,
    completedAt: '2026-08-01T00:00:00.000Z'
  },
  {
    decisionRef: '0002-decision-request.md',
    domain: 'architecture',
    question: 'q2',
    microlesson: 'm2',
    timeToUnderstandingSec: 30,
    completedAt: '2026-08-05T00:00:00.000Z'
  }
]

const NOTIFICATIONS = [
  { kind: 'sla-ping-executor', to: 'olena', nnnn: '0001', message: 'ping' },
  { kind: 'sla-escalated-notice', to: 'olena', nnnn: '0001', escalatedTo: 'vitalii', message: 'escalated' },
  { kind: 'sla-escalate-owner', to: 'vitalii', nnnn: '0001', executorHandle: 'olena', message: 'stuck' }, // адресовано ІНШОМУ handle — не потрапляє в зріз olena
  { kind: 'sla-ping-executor', to: 'olena', nnnn: '0002', message: 'ping2', batched: true }
]

const DEVICE_REGISTRY = [
  { handle: 'olena', role: 'human', pubkeyBase64: 'pk-olena', registeredAt: '2026-08-01T00:00:00.000Z' },
  { handle: 'fable-5', role: 'model', pubkeyBase64: 'pk-fable-5', registeredAt: '2026-08-01T00:00:00.000Z' }
]

describe('buildWhatSystemKnows', () => {
  it('чистий агрегатор — БЕЗ вхідних даних лишається порожнім, не кидає', () => {
    const result = buildWhatSystemKnows({ handle: 'olena' })
    expect(result.handle).toBe('olena')
    expect(result.knowledge.entryCount).toBe(0)
    expect(result.notifications.total).toBe(0)
    expect(result.registry.pubkeyBase64).toBeNull()
  })

  it('база знань — digest/trend деривовані через ту саму knowledge.js-логіку, entryCount', () => {
    const result = buildWhatSystemKnows({ handle: 'olena', knowledgeEntries: KNOWLEDGE_ENTRIES })
    expect(result.knowledge.entryCount).toBe(2)
    expect(result.knowledge.digest).toHaveLength(1)
    expect(result.knowledge.digest[0].domain).toBe('architecture')
    expect(result.knowledge.trend[0].trend).toBe('down') // 60s → 30s
  })

  it('нотифікації — лише МОЇ (фільтр за to), розбиті на pingsToMe/escalatedFromMe/batchedNow', () => {
    const result = buildWhatSystemKnows({ handle: 'olena', notifications: NOTIFICATIONS })
    expect(result.notifications.total).toBe(3) // без запису для vitalii
    expect(result.notifications.pingsToMe).toHaveLength(2)
    expect(result.notifications.escalatedFromMe).toHaveLength(1)
    expect(result.notifications.escalatedFromMe[0].escalatedTo).toBe('vitalii')
    expect(result.notifications.batchedNow).toHaveLength(1)
  })

  it('чужі нотифікації (to: vitalii) НІКОЛИ не просочуються у зріз olena', () => {
    const result = buildWhatSystemKnows({ handle: 'olena', notifications: NOTIFICATIONS })
    expect(result.notifications.pingsToMe.every(n => n.to === 'olena')).toBe(true)
    expect(result.notifications.escalatedFromMe.every(n => n.to === 'olena')).toBe(true)
  })

  it('реєстр — pubkey/role МОГО handle з device-registry.js, чужий запис не просочується', () => {
    const olena = buildWhatSystemKnows({ handle: 'olena', deviceRegistry: DEVICE_REGISTRY })
    expect(olena.registry).toEqual({
      role: 'human',
      pubkeyBase64: 'pk-olena',
      registeredAt: '2026-08-01T00:00:00.000Z'
    })
    const unknown = buildWhatSystemKnows({ handle: 'someone-else', deviceRegistry: DEVICE_REGISTRY })
    expect(unknown.registry).toEqual({ role: null, pubkeyBase64: null, registeredAt: null })
  })

  it('handle відсутній — handle: null, решта полів все одно безпечно порожні', () => {
    const result = buildWhatSystemKnows({ handle: null, notifications: NOTIFICATIONS })
    expect(result.handle).toBeNull()
    expect(result.notifications.total).toBe(0)
  })
})
