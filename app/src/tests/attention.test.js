import { describe, expect, it } from 'vitest'
import { collectAttention } from '../attention.js'

const workspaces = [
  { label: 'alpha', path: '/a/mt' },
  { label: 'beta', path: '/b/mt' }
]

const nodes = {
  '/a/mt': [
    {
      id: 'root',
      state: 'spawned',
      children: [
        { id: 'design', state: 'plan_review', children: [] },
        { id: 'impl', state: 'running', children: [] }
      ]
    }
  ],
  '/b/mt': [
    { id: 'stuck', state: 'unresolvable', children: [] },
    { id: 'review', state: 'pending', children: [] }
  ]
}

describe('collectAttention', () => {
  it('збирає лише людські стани, рекурсивно, за терміновістю', () => {
    const rows = collectAttention(workspaces, nodes)
    expect(rows.map(r => r.node.id)).toEqual(['stuck', 'design', 'review'])
    expect(rows[0].reason).toContain('attempts exhausted')
    expect(rows[1].workspace.label).toBe('alpha')
  })

  it('running/spawned/resolved не потрапляють в inbox', () => {
    const rows = collectAttention(workspaces, nodes)
    expect(rows.some(r => ['impl', 'root'].includes(r.node.id))).toBe(false)
  })

  it('воркспейс без вузлів → порожньо', () => {
    expect(collectAttention([{ label: 'x', path: '/x' }], {})).toEqual([])
  })
})
