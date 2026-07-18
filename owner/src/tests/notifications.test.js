import { describe, expect, it } from 'vitest'
import { planNotifications } from '../notifications.js'

// Часи — локальні (без Z), щоб тести не залежали від таймзони машини.
const NOW = Date.parse('2026-07-17T09:00:00')

const decision = (path, headline = 'план декомпозиції чекає approve / reject') => ({
  workspace: { path: '/demo/mt' },
  node: { path },
  headline
})

const reminder = (id, path = 'goal') => ({ id, path, headline: 'дедлайн сьогодні' })

describe('planNotifications', () => {
  it('перший запуск: лише дайджест, без поштучного спаму всім лісом', () => {
    const { notes, seen } = planNotifications({
      decisions: [decision('a'), decision('b')],
      reminders: [reminder('r1')],
      now: NOW,
      seen: null
    })
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toContain('дайджест')
    expect(notes[0].body).toContain('2 рішень')
    expect(seen.day).toBe('2026-07-17')
    expect(seen.decisions).toHaveLength(2)
    expect(seen.reminders).toEqual(['r1'])
  })

  it('дайджест — один на календарний день, і тихо коли нема що казати', () => {
    const seenToday = { day: '2026-07-17', decisions: [], reminders: [] }
    const again = planNotifications({ decisions: [decision('a')], reminders: [], now: NOW, seen: seenToday })
    expect(again.notes.map(n => n.title)).toEqual(['Нове рішення у твоїй черзі'])

    const empty = planNotifications({ decisions: [], reminders: [], now: NOW, seen: null })
    expect(empty.notes).toEqual([])
  })

  it('нове рішення і новий дедлайн проти baseline породжують по нотифікації', () => {
    const first = planNotifications({ decisions: [decision('a')], reminders: [reminder('r1')], now: NOW, seen: null })
    const next = planNotifications({
      decisions: [decision('a'), decision('b', 'агент вичерпав retry — потрібне втручання')],
      reminders: [reminder('r1'), reminder('r2', 'late')],
      now: NOW,
      seen: first.seen
    })
    expect(next.notes.map(n => n.title)).toEqual(['Нове рішення у твоїй черзі', 'Дедлайн поруч'])
    expect(next.notes[0].body).toContain('b:')
    expect(next.notes[1].body).toContain('late:')
  })

  it('зникле з черги нотифікації не породжує, а повторний rescan — тихий', () => {
    const base = planNotifications({ decisions: [decision('a')], reminders: [], now: NOW, seen: null })
    const calm = planNotifications({ decisions: [decision('a')], reminders: [], now: NOW, seen: base.seen })
    expect(calm.notes).toEqual([])
    const gone = planNotifications({ decisions: [], reminders: [], now: NOW, seen: base.seen })
    expect(gone.notes).toEqual([])
  })

  it('лавина нових подій згортається в одну зведену нотифікацію', () => {
    const base = planNotifications({ decisions: [], reminders: [], now: NOW, seen: null })
    const burst = planNotifications({
      decisions: [decision('a'), decision('b'), decision('c')],
      reminders: [reminder('r1'), reminder('r2')],
      now: Date.parse('2026-07-18T09:00:00'),
      seen: base.seen
    })
    // 5 нових подій > ліміту — дайджест нового дня + одна зведена
    expect(burst.notes).toHaveLength(2)
    expect(burst.notes[1].body).toContain('5 нових подій')
  })
})
