import { describe, expect, it } from 'vitest'
import { buildCreateOpts, mtDirFor, validateTaskName } from '../task-create.js'

describe('validateTaskName', () => {
  it('accepts a simple lower-case id', () => {
    expect(validateTaskName('collect-data')).toBeNull()
  })

  it('accepts nested segments', () => {
    expect(validateTaskName('research/collect-data')).toBeNull()
  })

  it('accepts digits and hyphens', () => {
    expect(validateTaskName('step-2/run-01')).toBeNull()
  })

  it('rejects an empty name', () => {
    expect(validateTaskName('')).toBe('Вкажіть назву задачі')
  })

  it('rejects empty segments (leading, trailing, doubled slash)', () => {
    const err = 'Порожній сегмент — приберіть зайвий «/»'
    expect(validateTaskName('/a')).toBe(err)
    expect(validateTaskName('a/')).toBe(err)
    expect(validateTaskName('a//b')).toBe(err)
  })

  it('rejects upper-case, underscore, spaces and dots', () => {
    const err = 'Лише a-z, 0-9, «-»; сегменти через «/»'
    expect(validateTaskName('Foo')).toBe(err)
    expect(validateTaskName('a_b')).toBe(err)
    expect(validateTaskName('a b')).toBe(err)
    expect(validateTaskName('..')).toBe(err)
    expect(validateTaskName('a/../b')).toBe(err)
  })
})

describe('mtDirFor', () => {
  it('appends /mt to the project root', () => {
    expect(mtDirFor('/Users/vitalii/www/abie/k8s')).toBe('/Users/vitalii/www/abie/k8s/mt')
  })

  it('normalizes trailing slashes', () => {
    expect(mtDirFor('/Users/vitalii/www/abie/k8s/')).toBe('/Users/vitalii/www/abie/k8s/mt')
    expect(mtDirFor('/root//')).toBe('/root/mt')
  })
})

describe('buildCreateOpts', () => {
  it('keeps only set fields and uses snake_case keys', () => {
    const opts = buildCreateOpts({
      mode: 'agent',
      modelTier: 'CLOUD_MAX',
      budgetSec: 1800,
      hint: 'atomic',
      deps: ['upstream'],
      skills: ['bash', 'write-files']
    })
    expect(opts).toEqual({
      mode: 'agent',
      model_tier: 'CLOUD_MAX',
      budget_sec: 1800,
      hint: 'atomic',
      deps: ['upstream'],
      skills: ['bash', 'write-files']
    })
  })

  it('drops empty optional fields so .mt.json defaults apply', () => {
    expect(
      buildCreateOpts({ mode: 'agent', modelTier: '', budgetSec: '', hint: ' '.repeat(3), deps: [], skills: [] })
    ).toEqual({ mode: 'agent' })
  })

  it('omits agent-only fields for human mode', () => {
    const opts = buildCreateOpts({ mode: 'human', modelTier: 'CLOUD_AVG', skills: ['bash'], deps: ['x'] })
    expect(opts).toEqual({ mode: 'human', deps: ['x'] })
  })

  it('ignores non-positive or non-numeric budget', () => {
    expect(buildCreateOpts({ mode: 'agent', budgetSec: 0 }).budget_sec).toBeUndefined()
    expect(buildCreateOpts({ mode: 'agent', budgetSec: -5 }).budget_sec).toBeUndefined()
    expect(buildCreateOpts({ mode: 'agent', budgetSec: 'abc' }).budget_sec).toBeUndefined()
  })

  it('trims the hint', () => {
    expect(buildCreateOpts({ mode: 'human', hint: '  atomic  ' }).hint).toBe('atomic')
  })
})
