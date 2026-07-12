import { describe, expect, it } from 'vitest'
import { applyClaims } from '../claims.js'

const tree = () => [
  {
    id: 'root',
    path: 'root',
    state: 'spawned',
    children: [
      { id: 'a', path: 'root/a', state: 'waiting', children: [] },
      { id: 'b', path: 'root/b', state: 'waiting', children: [] }
    ]
  }
]

/* eslint-disable unicorn/better-dom-traversing -- children тут — вузли task-дерева, не DOM */
describe('applyClaims', () => {
  it('активний claim → running, прострочений → stalled (рекурсивно)', () => {
    const nodes = applyClaims(tree(), [
      { path: 'root/a', expired: false, runner_id: 'srv-1/42' },
      { path: 'root/b', expired: true }
    ])
    expect(nodes[0].children[0].state).toBe('running')
    expect(nodes[0].children[0].claim.runner_id).toBe('srv-1/42')
    expect(nodes[0].children[1].state).toBe('stalled')
    expect(nodes[0].state).toBe('spawned')
  })

  it('без claims дерево не змінюється', () => {
    const nodes = applyClaims(tree(), [])
    expect(nodes[0].children[0].state).toBe('waiting')
    expect(nodes[0].children[0].claim).toBeUndefined()
  })
})
