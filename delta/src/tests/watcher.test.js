import { describe, expect, it } from 'vitest'
import {
  appendNotifications,
  applyQuietHours,
  isQuietHours,
  notificationsLogPath,
  parseNotificationsLog,
  runWatcherScan,
  scanForNotifications
} from '../watcher.js'

/**
 * @param {object} [seed] початковий вміст сховища
 * @returns {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>, store: Map<string,string>}}
 *   in-memory fs-double, той самий контракт, що decision-flow.test.js/quorum.test.js
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
 * @param {object} [overrides] поля для заміни фронтматера
 * @returns {string} мінімальний decision-request-текст для watcher-тестів
 */
function soloDecisionRequest(overrides = {}) {
  const fm = {
    computed_owner: 'olena',
    escalation_chain: '[olena, vitalii]',
    leverage_facets: '{ irreversible: false, blast_radius: node }',
    opened_at: '2026-08-01T00:00:00.000Z',
    ...overrides
  }
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n\n## Контекст\nx\n\n## Варіанти\n\n### A. x\n\nНаслідки: x\n`
}

/**
 * @param {object} [overrides] поля для заміни фронтматера
 * @returns {string} irreversible decision-request-текст із approvers
 */
function quorumDecisionRequest(overrides = {}) {
  return soloDecisionRequest({
    leverage_facets: '{ irreversible: true, blast_radius: repo }',
    approvers: '[olena, vitalii]',
    escalation_chain: '[olena, oksana]', // «наступний власник вище» для olena — oksana (див. ownerAbove)
    ...overrides
  })
}

const NOW = new Date('2026-08-03T00:00:00.000Z') // +48h від opened_at 2026-08-01
const IN_QUIET_HOURS = () => new Date('2026-08-03T23:00:00')

describe('scanForNotifications — solo-рішення', () => {
  it('відкрите рішення молодше за SLA — жодної нотифікації', () => {
    const fresh = soloDecisionRequest({ opened_at: '2026-08-02T23:00:00.000Z' }) // 1h тому
    const decisionsDirs = [
      { dir: '/root/runs/demo/decisions', files: [{ name: '0001-decision-request.md', content: fresh }] }
    ]
    expect(scanForNotifications({ decisionsDirs, now: NOW })).toEqual([])
  })

  it('старше за SLA (24h), молодше за SLA+grace (48h) — пінг лише виконавцю', () => {
    const dr = soloDecisionRequest({ opened_at: '2026-08-02T00:00:00.000Z' }) // 24h тому
    const decisionsDirs = [
      { dir: '/root/runs/demo/decisions', files: [{ name: '0001-decision-request.md', content: dr }] }
    ]
    const notifications = scanForNotifications({ decisionsDirs, now: NOW })
    expect(notifications).toHaveLength(1)
    expect(notifications[0]).toMatchObject({ kind: 'sla-ping-executor', to: 'olena' })
  })

  it('старше за SLA+grace (48h) — ескалація власнику + прозора копія виконавцю, ОБИДВІ ПІСЛЯ пінгу', () => {
    const dr = soloDecisionRequest({ opened_at: '2026-08-01T00:00:00.000Z' }) // 48h тому, рівно на межі
    const decisionsDirs = [
      { dir: '/root/runs/demo/decisions', files: [{ name: '0001-decision-request.md', content: dr }] }
    ]
    const notifications = scanForNotifications({ decisionsDirs, now: NOW })
    expect(notifications.map(n => n.kind)).toEqual(['sla-ping-executor', 'sla-escalate-owner', 'sla-escalated-notice'])
    expect(notifications[0].to).toBe('olena') // виконавець пінгується ПЕРШИМ (mandates.md — порядок сигналізації)
    expect(notifications[1]).toMatchObject({ kind: 'sla-escalate-owner', to: 'vitalii', executorHandle: 'olena' })
    expect(notifications[2]).toMatchObject({ kind: 'sla-escalated-notice', to: 'olena', escalatedTo: 'vitalii' })
  })

  it('вже закрите рішення (сусідній approval.json) — жодної нотифікації', () => {
    const dr = soloDecisionRequest({ opened_at: '2026-08-01T00:00:00.000Z' })
    const decisionsDirs = [
      {
        dir: '/root/runs/demo/decisions',
        files: [
          { name: '0001-decision-request.md', content: dr },
          { name: '0001-approval.json', content: '{}' }
        ]
      }
    ]
    expect(scanForNotifications({ decisionsDirs, now: NOW })).toEqual([])
  })

  it('немає opened_at — вік невідомий, watcher свідомо НЕ пінгує (fail-safe)', () => {
    const dr = soloDecisionRequest({ opened_at: undefined })
    const decisionsDirs = [
      { dir: '/root/runs/demo/decisions', files: [{ name: '0001-decision-request.md', content: dr }] }
    ]
    expect(scanForNotifications({ decisionsDirs, now: NOW })).toEqual([])
  })

  it('config.slaHours/graceHours перевизначає дефолт', () => {
    const dr = soloDecisionRequest({ opened_at: '2026-08-02T23:00:00.000Z' }) // 1h тому
    const decisionsDirs = [
      { dir: '/root/runs/demo/decisions', files: [{ name: '0001-decision-request.md', content: dr }] }
    ]
    const notifications = scanForNotifications({ decisionsDirs, config: { slaHours: 0.5, graceHours: 24 }, now: NOW })
    expect(notifications).toHaveLength(1)
  })
})

describe('scanForNotifications — кворумні (irreversible) рішення', () => {
  it('SLA-пінг усім approvers, ще не підписали', () => {
    const dr = quorumDecisionRequest({ opened_at: '2026-08-02T00:00:00.000Z' }) // 24h
    const decisionsDirs = [
      { dir: '/root/runs/demo/decisions', files: [{ name: '0001-decision-request.md', content: dr }] }
    ]
    const notifications = scanForNotifications({ decisionsDirs, now: NOW })
    expect(notifications.map(n => n.to)).toEqual(['olena', 'vitalii'])
    expect(notifications.every(n => n.kind === 'sla-ping-executor')).toBe(true)
  })

  it('один approver уже підписав — пінг лише тому, хто лишився', () => {
    const dr = quorumDecisionRequest({ opened_at: '2026-08-02T00:00:00.000Z' })
    const decisionsDirs = [
      {
        dir: '/root/runs/demo/decisions',
        files: [
          { name: '0001-decision-request.md', content: dr },
          { name: '0001-approval-olena.json', content: '{"chosen_option":"A"}' }
        ]
      }
    ]
    const notifications = scanForNotifications({ decisionsDirs, now: NOW })
    expect(notifications).toHaveLength(1)
    expect(notifications[0].to).toBe('vitalii')
  })

  it('кворум уже закритий (2/2 однаковий chosen_option) — watcher більше не пінгує', () => {
    const dr = quorumDecisionRequest({ opened_at: '2026-08-01T00:00:00.000Z' })
    const decisionsDirs = [
      {
        dir: '/root/runs/demo/decisions',
        files: [
          { name: '0001-decision-request.md', content: dr },
          { name: '0001-approval-olena.json', content: '{"chosen_option":"A"}' },
          { name: '0001-approval-vitalii.json', content: '{"chosen_option":"A"}' }
        ]
      }
    ]
    expect(scanForNotifications({ decisionsDirs, now: NOW })).toEqual([])
  })

  it('кворум diverged (2/2 різний chosen_option) — теж термінальний, watcher не пінгує далі', () => {
    const dr = quorumDecisionRequest({ opened_at: '2026-08-01T00:00:00.000Z' })
    const decisionsDirs = [
      {
        dir: '/root/runs/demo/decisions',
        files: [
          { name: '0001-decision-request.md', content: dr },
          { name: '0001-approval-olena.json', content: '{"chosen_option":"A"}' },
          { name: '0001-approval-vitalii.json', content: '{"chosen_option":"B"}' }
        ]
      }
    ]
    expect(scanForNotifications({ decisionsDirs, now: NOW })).toEqual([])
  })
})

describe('isQuietHours', () => {
  it('без конфігу — ніколи не тиха година', () => {
    expect(isQuietHours(new Date('2026-08-03T22:00:00'), null)).toBe(false)
  })

  it('денне вікно (09:00–18:00) — усередині true, поза межами false', () => {
    const quietHours = { start: '09:00', end: '18:00' }
    expect(isQuietHours(new Date('2026-08-03T12:00:00'), quietHours)).toBe(true)
    expect(isQuietHours(new Date('2026-08-03T08:59:00'), quietHours)).toBe(false)
    expect(isQuietHours(new Date('2026-08-03T18:00:00'), quietHours)).toBe(false)
  })

  it('нічне вікно через північ (20:00–09:00) — обидва боки півночі true', () => {
    const quietHours = { start: '20:00', end: '09:00' }
    expect(isQuietHours(new Date('2026-08-03T23:00:00'), quietHours)).toBe(true)
    expect(isQuietHours(new Date('2026-08-03T05:00:00'), quietHours)).toBe(true)
    expect(isQuietHours(new Date('2026-08-03T12:00:00'), quietHours)).toBe(false)
  })
})

describe('applyQuietHours', () => {
  const quietHours = { start: '20:00', end: '09:00' }
  const inQuietHours = new Date('2026-08-03T23:00:00')

  it('поза тихою годиною — deliverAt === now, не batched', () => {
    const notifications = [{ kind: 'sla-ping-executor', to: 'olena', critical: false }]
    const [n] = applyQuietHours(notifications, { quietHours, now: new Date('2026-08-03T12:00:00') })
    expect(n.batched).toBe(false)
    expect(n.deliverAt).toBe(new Date('2026-08-03T12:00:00').toISOString())
  })

  it('у тиху годину, некритична — batched, deliverAt = кінець вікна (09:00 наступного дня)', () => {
    const notifications = [{ kind: 'sla-ping-executor', to: 'olena', critical: false }]
    const [n] = applyQuietHours(notifications, { quietHours, now: inQuietHours })
    expect(n.batched).toBe(true)
    expect(n.deliverAt).toBe(new Date('2026-08-04T09:00:00').toISOString())
  })

  it('у тиху годину, критична (irreversible + дедлайн) — доставляється негайно, ВИНЯТОК', () => {
    const notifications = [{ kind: 'sla-ping-executor', to: 'olena', critical: true }]
    const [n] = applyQuietHours(notifications, { quietHours, now: inQuietHours })
    expect(n.batched).toBe(false)
    expect(n.deliverAt).toBe(inQuietHours.toISOString())
  })
})

describe('parseNotificationsLog / appendNotifications — JSONL round-trip', () => {
  it('порожній/відсутній текст — порожній масив', () => {
    expect(parseNotificationsLog(null)).toEqual([])
    expect(parseNotificationsLog('')).toEqual([])
  })

  it('битий рядок пропускається, не валить решту логу', () => {
    expect(parseNotificationsLog('{"a":1}\nnot json\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('appendNotifications дописує до існуючого логу (read-append-write)', async () => {
    const path = '/root/.mt/notifications/olena.jsonl'
    const io = memoryIo({ [path]: '{"a":1}\n' })
    await appendNotifications(io, path, [{ b: 2 }, { c: 3 }])
    expect(parseNotificationsLog(io.store.get(path))).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it('порожній масив нотифікацій — no-op, не пише файл', async () => {
    const io = memoryIo()
    await appendNotifications(io, '/x.jsonl', [])
    expect(io.store.has('/x.jsonl')).toBe(false)
  })
})

describe('notificationsLogPath', () => {
  it('шлях у .mt/notifications/{handle}.jsonl mandatesDir', () => {
    expect(notificationsLogPath('/root', 'olena')).toBe('/root/.mt/notifications/olena.jsonl')
  })
})

describe('runWatcherScan — повний прогін: скан → тиха година → дописування в лог КОЖНОГО адресата', () => {
  it('пінг виконавцю пишеться РАНІШЕ за ескалацію власнику (той самий порядок, що scanForNotifications)', async () => {
    const dr = soloDecisionRequest({ opened_at: '2026-08-01T00:00:00.000Z' }) // 48h — SLA+grace вичерпано
    const decisionsDirs = [
      { dir: '/root/runs/demo/decisions', files: [{ name: '0001-decision-request.md', content: dr }] }
    ]
    const io = memoryIo()
    const summary = await runWatcherScan({ io, mandatesDir: '/root', decisionsDirs, now: () => NOW })

    expect(summary.delivered).toBe(3)
    expect(summary.batched).toBe(0)

    const olenaLog = parseNotificationsLog(io.store.get(notificationsLogPath('/root', 'olena')))
    const vitaliiLog = parseNotificationsLog(io.store.get(notificationsLogPath('/root', 'vitalii')))
    // Виконавець (olena) бачить у своєму лозі і пінг, і прозору копію ескалації.
    expect(olenaLog.map(n => n.kind)).toEqual(['sla-ping-executor', 'sla-escalated-notice'])
    // Власник (vitalii) бачить лише ескалацію.
    expect(vitaliiLog.map(n => n.kind)).toEqual(['sla-escalate-owner'])
  })

  it('тиха година батчить некритичні нотифікації — deliverAt у майбутньому, delivered/batched підсумовує правильно', async () => {
    const dr = soloDecisionRequest({ opened_at: '2026-08-02T00:00:00.000Z' }) // лише SLA-пінг (24h)
    const decisionsDirs = [
      { dir: '/root/runs/demo/decisions', files: [{ name: '0001-decision-request.md', content: dr }] }
    ]
    const io = memoryIo()
    const quietHours = { start: '20:00', end: '09:00' }
    const summary = await runWatcherScan({ io, mandatesDir: '/root', decisionsDirs, quietHours, now: IN_QUIET_HOURS })

    expect(summary.delivered).toBe(0)
    expect(summary.batched).toBe(1)
    const olenaLog = parseNotificationsLog(io.store.get(notificationsLogPath('/root', 'olena')))
    expect(olenaLog[0].batched).toBe(true)
  })

  it('irreversible З дедлайном у тиху годину — виняток, доставляється негайно', async () => {
    const dr = quorumDecisionRequest({ opened_at: '2026-08-02T00:00:00.000Z', deadline_cost: '"постачальник чекає"' })
    const decisionsDirs = [
      { dir: '/root/runs/demo/decisions', files: [{ name: '0001-decision-request.md', content: dr }] }
    ]
    const io = memoryIo()
    const quietHours = { start: '20:00', end: '09:00' }
    const summary = await runWatcherScan({ io, mandatesDir: '/root', decisionsDirs, quietHours, now: IN_QUIET_HOURS })

    expect(summary.delivered).toBe(2) // обидва approvers, критично — не батчиться
    expect(summary.batched).toBe(0)
  })
})
