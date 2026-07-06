import { describe, expect, it } from 'vitest'
import { countRunning } from '../slots.js'

describe('countRunning', () => {
  it('рахує running рекурсивно по дереву', () => {
    const nodes = [
      {
        state: 'spawned',
        children: [
          { state: 'running', children: [] },
          { state: 'waiting', children: [{ state: 'running', children: [] }] }
        ]
      },
      { state: 'running', children: [] }
    ]
    expect(countRunning(nodes)).toBe(3)
  })

  it('без running-вузлів → 0', () => {
    expect(countRunning([{ state: 'resolved', children: [] }])).toBe(0)
  })

  it('порожнє/undefined дерево → 0', () => {
    expect(countRunning([])).toBe(0)
    expect(countRunning()).toBe(0)
  })
})
