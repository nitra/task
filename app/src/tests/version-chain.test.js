import { describe, expect, it } from 'vitest'
import { artifactConfig, chainSections } from '../version-chain.js'

const chain = [
  { file: 'task.md', kind: 'task', nnn: null },
  { file: 'plan_001.md', kind: 'plan', nnn: 1 },
  { file: 'run_001.md', kind: 'run', nnn: 1, result: 'failed' },
  { file: 'run_002.md', kind: 'run', nnn: 2, result: 'success' },
  { file: 'fact_002.md', kind: 'fact', nnn: 2 },
  { file: 'unresolvable.md', kind: 'unresolvable', nnn: null }
]

describe('chainSections', () => {
  it('групує mission → attempt NNN → terminal', () => {
    const sections = chainSections(chain)
    expect(sections.map(s => s.key)).toEqual(['mission', 'attempt 001', 'attempt 002', 'terminal'])
    expect(sections[1].items.map(a => a.file)).toEqual(['plan_001.md', 'run_001.md'])
    expect(sections[2].items.map(a => a.file)).toEqual(['run_002.md', 'fact_002.md'])
  })

  it('порожній список → без секцій', () => {
    expect(chainSections([])).toEqual([])
  })
})

describe('artifactConfig', () => {
  it('failure-результат перефарбовує у червоний', () => {
    expect(artifactConfig({ kind: 'run', result: 'budget-exceeded' }).color).toBe('#ff453a')
    expect(artifactConfig({ kind: 'audit-result', result: 'failed' }).color).toBe('#ff453a')
  })

  it('success лишає базовий колір; decomposed → spawned-бірюзовий', () => {
    expect(artifactConfig({ kind: 'run', result: 'success' }).color).toBe('#0a84ff')
    expect(artifactConfig({ kind: 'run', result: 'decomposed' }).color).toBe('#30c8c0')
  })

  it('невідомий kind → fallback task', () => {
    expect(artifactConfig({ kind: 'whatever' }).label).toBe('task')
  })
})
