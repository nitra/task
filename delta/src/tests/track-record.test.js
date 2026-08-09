import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDeviceRegistry } from '../device-registry.js'
import { deriveTrackRecord } from '../track-record.js'

const FIXTURES_ROOT = join(import.meta.dirname, 'fixtures')
const DEVICE_REGISTRY = parseDeviceRegistry(readFileSync(join(FIXTURES_ROOT, 'device-registry.json'), 'utf8'))

/**
 * @param {string} runId ім'я run-директорії (`fixtures/runs/{runId}`)
 * @returns {{dir: string, files: {name: string, content: string}[]}} скановані файли одного run-у у форматі `deriveQueue`/`deriveTrackRecord`
 */
function loadRunDir(runId) {
  const dir = join(FIXTURES_ROOT, 'runs', runId, 'decisions')
  const names = ['0001-decision-request.md', '0001-approval.json', '0002-decision-request.md', '0002-approval.json']
  const files = []
  for (const name of names) {
    try {
      files.push({ name, content: readFileSync(join(dir, name), 'utf8') })
    } catch {
      // не всі run-и мають 0002 — штатно пропускаємо відсутні
    }
  }
  return { dir, files }
}

const DEMO_3 = loadRunDir('demo-3')
const DEMO_4 = loadRunDir('demo-4')

describe('deriveTrackRecord', () => {
  it('без decisionsDirs — порожній трек-рекорд, overrideFreeRate null (не вигадана 0/0)', () => {
    const result = deriveTrackRecord({ decisionsDirs: [], deviceRegistry: DEVICE_REGISTRY, handle: 'fable-5' })
    expect(result).toEqual({
      handle: 'fable-5',
      totalDecisions: 0,
      byDecisionType: [],
      recent: [],
      overrideCount: 0,
      overrideFreeCount: 0,
      overrideFreeRate: null
    })
  })

  it('run без override — 1 рішення, override: false, overrideFreeRate: 1', () => {
    const result = deriveTrackRecord({ decisionsDirs: [DEMO_3], deviceRegistry: DEVICE_REGISTRY, handle: 'fable-5' })
    expect(result.totalDecisions).toBe(1)
    expect(result.recent).toHaveLength(1)
    expect(result.recent[0]).toMatchObject({ runId: 'demo-3', nnnn: '0001', decisionType: 'ops', chosenOption: 'A', override: false })
    expect(result.overrideCount).toBe(0)
    expect(result.overrideFreeRate).toBe(1)
  })

  it('run з пізнішою людською незгодною відповіддю — model-рішення позначене override: true', () => {
    const result = deriveTrackRecord({ decisionsDirs: [DEMO_4], deviceRegistry: DEVICE_REGISTRY, handle: 'fable-5' })
    expect(result.totalDecisions).toBe(1) // лише 0001 підписаний моделлю — 0002 підписаний olena (людина), не входить у трек-рекорд fable-5
    expect(result.recent[0]).toMatchObject({ runId: 'demo-4', nnnn: '0001', override: true })
    expect(result.overrideCount).toBe(1)
    expect(result.overrideFreeCount).toBe(0)
    expect(result.overrideFreeRate).toBe(0)
  })

  it('людське рішення (olena) НЕ потрапляє у трек-рекорд моделі — атрибуція за реєстром, не за computed_owner', () => {
    const result = deriveTrackRecord({ decisionsDirs: [DEMO_4], deviceRegistry: DEVICE_REGISTRY, handle: 'olena' })
    expect(result.totalDecisions).toBe(0)
  })

  it('обидва run-и разом — 2 рішення, лише одне override', () => {
    const result = deriveTrackRecord({ decisionsDirs: [DEMO_3, DEMO_4], deviceRegistry: DEVICE_REGISTRY, handle: 'fable-5' })
    expect(result.totalDecisions).toBe(2)
    expect(result.overrideCount).toBe(1)
    expect(result.overrideFreeCount).toBe(1)
    expect(result.overrideFreeRate).toBe(0.5)
    expect(result.byDecisionType).toEqual([{ decisionType: 'ops', count: 2 }])
  })

  it('recent сортує за signedAt спадно й обрізає до recentLimit', () => {
    const result = deriveTrackRecord({ decisionsDirs: [DEMO_3, DEMO_4], deviceRegistry: DEVICE_REGISTRY, handle: 'fable-5', recentLimit: 1 })
    expect(result.recent).toHaveLength(1)
    expect(result.recent[0].runId).toBe('demo-4') // 2026-08-03 пізніше за 2026-08-02
  })

  it('незареєстрований pubkey (немає в device-registry) — рішення не зараховується жодному handle', () => {
    const ghostRegistry = []
    const result = deriveTrackRecord({ decisionsDirs: [DEMO_3], deviceRegistry: ghostRegistry, handle: 'fable-5' })
    expect(result.totalDecisions).toBe(0)
  })

  it('невідомий handle — порожній трек-рекорд, не помилка', () => {
    const result = deriveTrackRecord({ decisionsDirs: [DEMO_3, DEMO_4], deviceRegistry: DEVICE_REGISTRY, handle: 'ghost-model' })
    expect(result.totalDecisions).toBe(0)
    expect(result.overrideFreeRate).toBeNull()
  })
})
