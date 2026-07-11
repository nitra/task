import { describe, expect, it } from 'vitest'
import { diffForest, snapshotForest } from '../delta.js'

describe('snapshotForest', () => {
  it('розплющує дерево у мапу шлях → стан', () => {
    const forest = {
      '/ws/mt': [{ path: 'a', state: 'waiting', children: [{ path: 'a/b', state: 'running', children: [] }] }]
    }
    expect(snapshotForest(forest)).toEqual({ '/ws/mt': { a: 'waiting', 'a/b': 'running' } })
  })
})

describe('diffForest', () => {
  it('класифікує переходи: resolved, ескалацію, появу, зміну, зникнення', () => {
    const prev = { '/ws/mt': { a: 'running', b: 'waiting', c: 'running', gone: 'waiting' } }
    const next = { '/ws/mt': { a: 'resolved', b: 'failed', c: 'pending_audit', fresh: 'waiting' } }
    const rows = diffForest(prev, next)
    const byPath = Object.fromEntries(rows.map(r => [r.path, r.kind]))
    expect(byPath).toEqual({
      a: 'resolved',
      b: 'escalated',
      c: 'changed',
      gone: 'gone',
      fresh: 'appeared'
    })
  })

  it('ескалації йдуть першими, без змін — порожньо', () => {
    const prev = { '/ws/mt': { a: 'running', b: 'running' } }
    const next = { '/ws/mt': { a: 'resolved', b: 'unresolvable' } }
    expect(diffForest(prev, next).map(r => r.kind)).toEqual(['escalated', 'resolved'])
    expect(diffForest(next, next)).toEqual([])
  })

  it('новий вузол одразу в ескалації → kind escalated, не appeared', () => {
    const rows = diffForest({}, { '/ws/mt': { fresh: 'plan_review' } })
    expect(rows).toEqual([
      { workspace: '/ws/mt', path: 'fresh', kind: 'escalated', from: undefined, to: 'plan_review' }
    ])
  })
})
