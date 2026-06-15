import { describe, expect, it } from 'vitest'
import { classify, scopedManifest, scopedToolNames } from '../tool/scope.js'

describe('classify', () => {
  it('humans execute every tier directly', () => {
    expect(classify({ kind: 'human' }, 'scan')).toBe('allow') // read
    expect(classify({ kind: 'human' }, 'create')).toBe('allow') // write
    expect(classify({ kind: 'human' }, 'delete')).toBe('allow') // destructive
  })

  it('agents execute read+write, but destructive needs approval', () => {
    expect(classify({ kind: 'agent' }, 'scan')).toBe('allow')
    expect(classify({ kind: 'agent' }, 'create')).toBe('allow')
    expect(classify({ kind: 'agent' }, 'delete')).toBe('approval')
  })

  it('unknown actors are read-only; everything else denied', () => {
    expect(classify({ kind: 'viewer' }, 'scan')).toBe('allow')
    expect(classify({ kind: 'viewer' }, 'create')).toBe('deny')
    expect(classify({ kind: 'viewer' }, 'delete')).toBe('deny')
  })

  it('denies unknown tools', () => {
    expect(classify({ kind: 'human' }, 'nope')).toBe('deny')
  })
})

describe('scopedManifest / scopedToolNames', () => {
  it('agents see all tools (destructive visible to request approval)', () => {
    expect(scopedToolNames({ kind: 'agent' })).toEqual(['scan', 'workspaces', 'create', 'delete'])
    expect(scopedManifest({ kind: 'agent' }).map(t => t.function.name)).toEqual(['scan', 'workspaces', 'create', 'delete'])
  })

  it('read-only actors see only read tools', () => {
    expect(scopedToolNames({ kind: 'viewer' })).toEqual(['scan', 'workspaces'])
  })
})
