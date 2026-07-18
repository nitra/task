import { describe, expect, it } from 'vitest'
import { collectDecisions, collectDelegations, collectEscalatedOut, collectPersonal } from '../decisions.js'

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

describe('маршрутизація ескалацій (M6)', () => {
  const forest = {
    '/demo/mt': [node('goal', 'waiting', [node('goal/api', 'unresolvable'), node('goal/ui', 'plan_review')])]
  }
  const open = { nnn: 1, from: 'olena', to: 'vkozlov', reason: 'бюджет вичерпано', resolved: false }
  const escalations = { '/demo/mt': { 'goal/api': [open] } }

  it('відкрита ескалація зʼявляється у черзі адресата картками stake 0', () => {
    const rows = collectDecisions([WS], forest, undefined, { escalations, me: 'vkozlov' })
    expect(rows[0].node.path).toBe('goal/api')
    expect(rows[0].escalation).toBe(open)
    expect(rows[0].stake).toBe(0)
    expect(rows[0].actions).toEqual(['resolve'])
    expect(rows[0].headline).toContain('olena')
  })

  it('у автора вузол зникає з черги, поки чекає вердикту', () => {
    const rows = collectDecisions([WS], forest, undefined, { escalations, me: 'olena' })
    expect(rows.map(r => r.node.path)).toEqual(['goal/ui'])
  })

  it('розвʼязана ескалація не маршрутизується — вердикти вузла повертаються', () => {
    const done = { '/demo/mt': { 'goal/api': [{ ...open, resolved: true }] } }
    const rows = collectDecisions([WS], forest, undefined, { escalations: done, me: 'vkozlov' })
    expect(rows.map(r => r.node.path)).toEqual(['goal/api', 'goal/ui'])
    expect(rows[0].escalation).toBeUndefined()
  })

  it('без ідентичності ескалації не маршрутизуються', () => {
    const rows = collectDecisions([WS], forest, undefined, { escalations, me: null })
    expect(rows.every(r => !r.escalation)).toBe(true)
  })
})

describe('collectDelegations і collectEscalatedOut (M6)', () => {
  const forest = {
    '/demo/mt': [
      node('goal', 'waiting', [
        node('goal/api', 'running', [node('goal/api/inner', 'pending')]),
        node('goal/todo', 'pending')
      ])
    ]
  }
  const scopes = {
    '/demo/mt': {
      marked: true,
      classify: path => {
        if (path === 'goal/api') return 'boundary'
        if (path.startsWith('goal/api/')) return 'foreign'
        return 'mine'
      }
    }
  }

  it('делегування — межові вузли з власником, без кухні', () => {
    const owners = { '/demo/mt': { 'goal/api': 'olena' } }
    const rows = collectDelegations([WS], forest, scopes, owners)
    expect(rows).toHaveLength(1)
    expect(rows[0].node.path).toBe('goal/api')
    expect(rows[0].owner).toBe('olena')
  })

  it('ескальовано мною — рядок «чекає вердикту», лише для моїх відкритих', () => {
    const escalations = {
      '/demo/mt': {
        'goal/todo': [{ nnn: 1, from: 'olena', to: 'vkozlov', resolved: false }],
        'goal/api': [{ nnn: 1, from: 'petro', to: 'olena', resolved: false }]
      }
    }
    const rows = collectEscalatedOut([WS], forest, escalations, 'olena')
    expect(rows.map(r => r.node.path)).toEqual(['goal/todo'])
    expect(collectEscalatedOut([WS], forest, escalations, null)).toEqual([])
  })
})
