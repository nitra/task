import { describe, expect, it } from 'vitest'
import { deriveScope } from '../scope.js'
import { applySnoozes, bucketPersonal, deriveReminders, nextMidnight, reminderRibbon } from '../reminders.js'

// Часи — локальні (без Z), щоб тести не залежали від таймзони машини.
const NOW = Date.parse('2026-07-17T12:00:00')
const WS = { label: 'demo', path: '/demo/mt' }

/**
 * Ліс одного воркспейсу для тестів.
 * @param {object[]} nodes дерево вузлів
 * @returns {{ workspaces: object[], forest: Record<string, object[]> }} вхід deriveReminders
 */
function forestOf(nodes) {
  return { workspaces: [WS], forest: { [WS.path]: nodes } }
}

describe('deriveReminders', () => {
  it('deadline_due: нерозвʼязаний вузол з дедлайном у горизонті 24 год або простроченим', () => {
    const rows = deriveReminders({
      ...forestOf([
        { path: 'goal', state: 'waiting', deadline: '2026-07-17T18:00:00', children: [] },
        { path: 'late', state: 'blocked', deadline: '2026-07-16T10:00:00', children: [] },
        { path: 'far', state: 'waiting', deadline: '2026-07-25T10:00:00', children: [] },
        { path: 'done', state: 'resolved', deadline: '2026-07-16T10:00:00', children: [] },
        { path: 'no-date', state: 'waiting', children: [] }
      ]),
      now: NOW
    })
    expect(rows.map(r => [r.path, r.rule, r.overdue])).toEqual([
      ['late', 'deadline_due', true],
      ['goal', 'deadline_due', false]
    ])
    // прострочене — дорожче, тож перше
    expect(rows[0].stake).toBeLessThan(rows[1].stake)
  })

  it('personal_today: мій pending із дедлайном сьогодні (прострочений pending — теж моя задача)', () => {
    const rows = deriveReminders({
      ...forestOf([
        { path: 'mine', state: 'pending', deadline: '2026-07-17T17:00:00', children: [] },
        { path: 'stale', state: 'pending', deadline: '2026-07-15T09:00:00', children: [] }
      ]),
      now: NOW
    })
    expect(rows.map(r => [r.path, r.rule, r.overdue])).toEqual([
      ['stale', 'personal_today', true],
      ['mine', 'personal_today', false]
    ])
  })

  it('чужі й межові вузли нагадувань не породжують — лише мій скоуп', () => {
    const owners = { goal: 'olena', 'goal/api': 'vkozlov' }
    const scopes = { [WS.path]: deriveScope(owners, 'olena') }
    const rows = deriveReminders({
      ...forestOf([
        {
          path: 'goal',
          state: 'waiting',
          deadline: '2026-07-16T10:00:00',
          children: [
            { path: 'goal/api', state: 'waiting', deadline: '2026-07-16T10:00:00', children: [] },
            { path: 'goal/docs', state: 'pending', deadline: '2026-07-17T15:00:00', children: [] }
          ]
        }
      ]),
      scopes,
      now: NOW
    })
    expect(rows.map(r => r.path)).toEqual(['goal', 'goal/docs'])
  })

  it('escalation_stale: відкрита ескалація до мене без реакції понад поріг', () => {
    const escalations = {
      [WS.path]: {
        goal: [{ from: 'olena', to: 'vkozlov', created_at: '2026-07-13T09:00:00', resolved: false }],
        fresh: [{ from: 'olena', to: 'vkozlov', created_at: '2026-07-16T09:00:00', resolved: false }],
        closed: [{ from: 'olena', to: 'vkozlov', created_at: '2026-07-01T09:00:00', resolved: true }],
        'not-mine': [{ from: 'olena', to: 'petro', created_at: '2026-07-01T09:00:00', resolved: false }]
      }
    }
    const rows = deriveReminders({ ...forestOf([]), escalations, me: 'vkozlov', now: NOW })
    expect(rows).toHaveLength(1)
    expect(rows[0].rule).toBe('escalation_stale')
    expect(rows[0].path).toBe('goal')
    expect(rows[0].headline).toContain('4 дн.')
  })
})

describe('applySnoozes', () => {
  const reminder = { id: 'r1', rule: 'deadline_due' }

  it('глушить нагадування, доки until у майбутньому', () => {
    expect(applySnoozes([reminder], { r1: '2026-07-18T00:00:00' }, NOW)).toEqual([])
    expect(applySnoozes([reminder], { r1: '2026-07-17T09:00:00' }, NOW)).toEqual([reminder])
    expect(applySnoozes([reminder], {}, NOW)).toEqual([reminder])
    expect(applySnoozes([reminder], { r1: 'сміття' }, NOW)).toEqual([reminder])
  })
})

/**
 * Рядок особистої задачі з дедлайном для тестів кошиків.
 * @param {string} [deadline] ISO-дедлайн вузла
 * @returns {{ node: { path: string, deadline?: string } }} рядок collectPersonal
 */
function personalRow(deadline) {
  return { node: { path: `n-${deadline ?? 'none'}`, deadline } }
}

describe('bucketPersonal', () => {
  it('розкладає задачі по кошиках у фіксованому порядку, порожні опускає', () => {
    const buckets = bucketPersonal(
      [
        personalRow('2026-07-16T10:00:00'), // прострочено
        personalRow('2026-07-17T18:00:00'), // сьогодні
        personalRow('2026-07-20T10:00:00'), // цього тижня
        personalRow('2026-08-01T10:00:00'), // пізніше
        personalRow() // без дедлайну
      ],
      NOW
    )
    expect(buckets.map(b => [b.key, b.rows.length])).toEqual([
      ['overdue', 1],
      ['today', 1],
      ['week', 1],
      ['later', 1],
      ['none', 1]
    ])
    expect(bucketPersonal([], NOW)).toEqual([])
  })
})

describe('reminderRibbon', () => {
  it('рахує дедлайнові нагадування і прострочення; ескалації — не «задачі на сьогодні»', () => {
    const ribbon = reminderRibbon([
      { rule: 'personal_today', overdue: true },
      { rule: 'deadline_due', overdue: false },
      { rule: 'escalation_stale' }
    ])
    expect(ribbon).toEqual({ count: 2, overdue: 1, headline: 'сьогодні: 2 задачі, з них 1 прострочено' })
  })

  it('без дедлайнових нагадувань стрічки немає', () => {
    expect(reminderRibbon([{ rule: 'escalation_stale' }])).toBeNull()
    expect(reminderRibbon([])).toBeNull()
  })
})

describe('nextMidnight', () => {
  it('повертає північ наступної локальної доби', () => {
    const until = Date.parse(nextMidnight(NOW))
    expect(until).toBeGreaterThan(NOW)
    expect(until - NOW).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
    expect(new Date(until).getHours()).toBe(0)
  })
})
