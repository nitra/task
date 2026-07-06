import { describe, expect, it } from 'vitest'
import { computeDagLayout } from '../dag-layout.js'

describe('computeDagLayout', () => {
  it('розкладає лінійний ланцюг deps по зростаючих шарах', () => {
    const tree = [
      { path: 'collect', id: 'collect', state: 'resolved', deps: [], children: [] },
      { path: 'analyze', id: 'analyze', state: 'waiting', deps: ['collect'], children: [] },
      { path: 'report', id: 'report', state: 'waiting', deps: ['analyze'], children: [] }
    ]
    const layout = computeDagLayout(tree)
    const byPath = Object.fromEntries(layout.nodes.map(n => [n.path, n]))
    expect(byPath.collect.x).toBe(0)
    expect(byPath.analyze.x).toBe(200)
    expect(byPath.report.x).toBe(400)
    expect(layout.edges).toEqual(
      expect.arrayContaining([
        { from: 'collect', to: 'analyze' },
        { from: 'analyze', to: 'report' }
      ])
    )
  })

  it('вузол без deps і вузол з невалідним dep — обидва шар 0', () => {
    const tree = [
      { path: 'a', id: 'a', state: 'waiting', deps: [], children: [] },
      { path: 'b', id: 'b', state: 'waiting', deps: ['ghost'], children: [] }
    ]
    const layout = computeDagLayout(tree)
    expect(layout.nodes.every(n => n.x === 0)).toBe(true)
    expect(layout.edges).toEqual([])
  })

  it('множинні deps → шар = max(шарів deps) + 1', () => {
    const tree = [
      { path: 'a', id: 'a', state: 'resolved', deps: [], children: [] },
      { path: 'b', id: 'b', state: 'resolved', deps: [], children: [] },
      { path: 'c', id: 'c', state: 'waiting', deps: ['a'], children: [] },
      { path: 'd', id: 'd', state: 'waiting', deps: ['a', 'c'], children: [] }
    ]
    const layout = computeDagLayout(tree)
    const byPath = Object.fromEntries(layout.nodes.map(n => [n.path, n]))
    expect(byPath.a.x).toBe(0)
    expect(byPath.b.x).toBe(0)
    expect(byPath.c.x).toBe(200)
    expect(byPath.d.x).toBe(400)
  })

  it('рекурсивно розгортає composite children в один плаский граф', () => {
    const tree = [
      {
        path: 'root',
        id: 'root',
        state: 'spawned',
        deps: [],
        children: [
          { path: 'root/a', id: 'a', state: 'resolved', deps: [], children: [] },
          { path: 'root/b', id: 'b', state: 'waiting', deps: ['root/a'], children: [] }
        ]
      }
    ]
    const layout = computeDagLayout(tree)
    expect(layout.nodes.map(n => n.path).toSorted()).toEqual(['root', 'root/a', 'root/b'])
    expect(layout.edges).toEqual([{ from: 'root/a', to: 'root/b' }])
  })

  it('захищається від циклу (гіпотетично зіпсоване дерево) — не зависає', () => {
    const tree = [
      { path: 'a', id: 'a', state: 'waiting', deps: ['b'], children: [] },
      { path: 'b', id: 'b', state: 'waiting', deps: ['a'], children: [] }
    ]
    const layout = computeDagLayout(tree)
    expect(layout.nodes).toHaveLength(2)
  })

  it('порожнє дерево → порожній layout', () => {
    expect(computeDagLayout([])).toEqual({ nodes: [], edges: [], width: 200, height: 64 })
  })
})
