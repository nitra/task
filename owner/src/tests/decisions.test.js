import { describe, expect, it } from 'vitest'
import { collectDecisions, collectPersonal } from '../decisions.js'

const WS = { label: 'demo', path: '/demo/mt' }

/**
 * Мінімальний вузол дерева scan.
 * @param {string} path шлях вузла
 * @param {string} state стан вузла
 * @param {object[]} [children] діти
 * @returns {object} вузол
 */
function node(path, state, children = []) {
  return { path, state, children }
}

describe('collectDecisions', () => {
  it('збирає лише стани-вердикти, рекурсивно по дереву', () => {
    const forest = {
      '/demo/mt': [node('a', 'waiting', [node('a/b', 'plan_review'), node('a/c', 'running')]), node('d', 'resolved')]
    }
    const rows = collectDecisions([WS], forest)
    expect(rows.map(r => r.node.path)).toEqual(['a/b'])
    expect(rows[0].actions).toEqual(['approve', 'reject'])
  })

  it('сортує за ціною помилки: unresolvable перед plan_review', () => {
    const forest = {
      '/demo/mt': [node('p', 'plan_review'), node('u', 'unresolvable'), node('f', 'failed')]
    }
    const rows = collectDecisions([WS], forest)
    expect(rows.map(r => r.node.path)).toEqual(['u', 'f', 'p'])
    expect(rows[0].stake).toBeLessThan(rows.at(-1).stake)
  })

  it('обʼєднує кілька воркспейсів лісу', () => {
    const other = { label: 'other', path: '/other/mt' }
    const forest = {
      '/demo/mt': [node('x', 'stalled')],
      '/other/mt': [node('y', 'unresolvable')]
    }
    const rows = collectDecisions([WS, other], forest)
    expect(rows.map(r => r.workspace.label)).toEqual(['other', 'demo'])
  })

  it('порожній ліс → порожня черга', () => {
    expect(collectDecisions([WS], {})).toEqual([])
  })
})

describe('collectPersonal', () => {
  it('повертає pending-вузли як особисті задачі, не рішення', () => {
    const forest = {
      '/demo/mt': [node('todo', 'pending', [node('todo/sub', 'pending')]), node('agent', 'waiting')]
    }
    const personal = collectPersonal([WS], forest)
    expect(personal.map(r => r.node.path)).toEqual(['todo', 'todo/sub'])
    const decisions = collectDecisions([WS], forest)
    expect(decisions).toEqual([])
  })
})

describe('скоуп власника (M5)', () => {
  const forest = {
    '/demo/mt': [
      node('mine', 'plan_review', [node('mine/todo', 'pending'), node('mine/delegated', 'unresolvable')]),
      node('stray', 'failed'),
      node('mine2', 'pending')
    ]
  }
  // mine* — мої, mine/delegated — делеговано, stray — «нічия земля»
  const scopes = {
    '/demo/mt': {
      marked: true,
      classify: path => {
        if (path === 'mine/delegated') return 'boundary'
        if (path === 'stray') return 'orphaned'
        return path.startsWith('mine') ? 'mine' : 'foreign'
      }
    }
  }

  it('черга — лише мій скоуп, «нічия земля» з прапорцем, межі без рішень', () => {
    const rows = collectDecisions([WS], forest, scopes)
    expect(rows.map(r => [r.node.path, r.orphaned ?? false])).toEqual([
      ['stray', true],
      ['mine', false]
    ])
  })

  it('особисті задачі — лише мої pending', () => {
    const forest2 = { '/demo/mt': [node('mine/todo', 'pending'), node('stray', 'pending')] }
    expect(collectPersonal([WS], forest2, scopes).map(r => r.node.path)).toEqual(['mine/todo'])
  })

  it('без scopes — легасі-поведінка: усе моє', () => {
    expect(collectDecisions([WS], forest).length).toBeGreaterThan(2)
  })
})
