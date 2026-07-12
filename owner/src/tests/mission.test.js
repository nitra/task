import { describe, expect, it } from 'vitest'
import { extractMission } from '../mission.js'

describe('extractMission', () => {
  it('бере текст після ## Task, прибирає коментарі й зайві пробіли', () => {
    const md = '---\nschema_version: 1\n---\n\n## Task\n\n<!-- підказка -->\nЗробити X.\n\n## Done when\n\nY.'
    expect(extractMission(md)).toBe('Зробити X. ## Done when Y.')
  })

  it('обрізає за лімітом символів', () => {
    const md = `## Task\n${'a'.repeat(500)}`
    expect(extractMission(md, 10)).toHaveLength(10)
  })

  it('порожній чи відсутній ## Task — не падає', () => {
    expect(extractMission('')).toBe('')
    expect(extractMission('просто текст без секцій')).toBe('просто текст без секцій')
  })
})
