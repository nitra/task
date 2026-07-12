import { describe, expect, it } from 'vitest'
import { mergeAutonomy, parseAutonomy, resolveAction, serializeAutonomy } from '../autonomy.js'

describe('parseAutonomy', () => {
  it('розбирає рядки клас: гейт, ігнорує коментарі й порожні рядки', () => {
    const text = '# коментар\ndeploy: approve\n\nworktree_edit: auto\n'
    expect(parseAutonomy(text)).toEqual({ deploy: 'approve', worktree_edit: 'auto' })
  })

  it('порожній текст → порожня політика', () => {
    expect(parseAutonomy('')).toEqual({})
    expect(parseAutonomy('   \n')).toEqual({})
  })

  it('відхиляє невідомий гейт і рядок без двокрапки', () => {
    expect(() => parseAutonomy('deploy: sometimes')).toThrow('невідомий гейт')
    expect(() => parseAutonomy('deploy approve')).toThrow('невалідний рядок')
  })
})

describe('serializeAutonomy', () => {
  it('серіалізує у формат, який читає parseAutonomy (roundtrip)', () => {
    const policy = { deploy: 'approve', worktree_edit: 'auto' }
    expect(serializeAutonomy(policy)).toBe('deploy: approve\nworktree_edit: auto\n')
    expect(parseAutonomy(serializeAutonomy(policy))).toEqual(policy)
  })

  it('порожня політика → порожній рядок', () => {
    expect(serializeAutonomy({})).toBe('')
  })
})

describe('mergeAutonomy (ratchet)', () => {
  it('дитина може посилити auto → approve', () => {
    expect(mergeAutonomy({ deploy: 'auto' }, { deploy: 'approve' })).toEqual({ deploy: 'approve' })
  })

  it('дитина НЕ може послабити approve → auto — предок перемагає', () => {
    expect(mergeAutonomy({ deploy: 'approve' }, { deploy: 'auto' })).toEqual({ deploy: 'approve' })
  })

  it('клас, не зачеплений дитиною, успадковується без змін', () => {
    expect(mergeAutonomy({ worktree_edit: 'auto', deploy: 'approve' }, {})).toEqual({
      worktree_edit: 'auto',
      deploy: 'approve'
    })
  })

  it('новий клас від дитини додається як є', () => {
    expect(mergeAutonomy({}, { spend: 'approve' })).toEqual({ spend: 'approve' })
  })
})

describe('resolveAction', () => {
  it('явний клас переважає над default', () => {
    expect(resolveAction({ deploy: 'approve', default: 'auto' }, 'deploy')).toBe('approve')
  })

  it('нездекларований клас падає на default', () => {
    expect(resolveAction({ default: 'auto' }, 'spend')).toBe('auto')
  })

  it('нічого не декларовано → fail-closed approve', () => {
    expect(resolveAction({}, 'spend')).toBe('approve')
  })
})
