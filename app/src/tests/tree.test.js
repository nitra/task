import { describe, expect, it } from 'vitest'
import { findNodeByPath } from '../tree.js'

const tree = [
  {
    id: 'root',
    path: 'root',
    children: [
      { id: 'a', path: 'root/a', children: [] },
      { id: 'b', path: 'root/b', children: [{ id: 'c', path: 'root/b/c', children: [] }] }
    ]
  }
]

describe('findNodeByPath', () => {
  it('знаходить кореневий, вкладений і глибоко вкладений вузол', () => {
    expect(findNodeByPath(tree, 'root')?.id).toBe('root')
    expect(findNodeByPath(tree, 'root/b')?.id).toBe('b')
    expect(findNodeByPath(tree, 'root/b/c')?.id).toBe('c')
  })

  it('відсутній шлях → null', () => {
    expect(findNodeByPath(tree, 'root/x')).toBeNull()
  })

  it('порожнє/undefined дерево → null', () => {
    expect(findNodeByPath([], 'root')).toBeNull()
    expect(findNodeByPath(undefined, 'root')).toBeNull()
  })
})
