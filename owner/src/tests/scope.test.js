import { describe, expect, it } from 'vitest'
import { deriveScope, deriveScopes, effectiveOwnerOf, escalationAddressee } from '../scope.js'

describe('effectiveOwnerOf', () => {
  it('повертає власника вузла або найближчого розміченого предка', () => {
    const owners = { goal: 'olena', 'goal/api/deploy': 'vkozlov' }
    expect(effectiveOwnerOf(owners, 'goal')).toBe('olena')
    expect(effectiveOwnerOf(owners, 'goal/api')).toBe('olena')
    expect(effectiveOwnerOf(owners, 'goal/api/deploy')).toBe('vkozlov')
    expect(effectiveOwnerOf(owners, 'goal/api/deploy/tests')).toBe('vkozlov')
  })

  it('вузол поза розміченими піддеревами — без власника', () => {
    expect(effectiveOwnerOf({ goal: 'olena' }, 'other')).toBeNull()
    expect(effectiveOwnerOf({}, 'goal')).toBeNull()
  })
})

describe('deriveScope', () => {
  it('нерозмічений ліс — усе моє (single-owner виродження)', () => {
    const scope = deriveScope({}, null)
    expect(scope.marked).toBe(false)
    expect(scope.classify('anything/at/all')).toBe('mine')
  })

  it('розмічений ліс: mine / boundary / foreign / orphaned', () => {
    const owners = { goal: 'olena', 'goal/api': 'vkozlov' }
    const scope = deriveScope(owners, 'olena')
    expect(scope.marked).toBe(true)
    expect(scope.classify('goal')).toBe('mine')
    expect(scope.classify('goal/docs')).toBe('mine')
    // делегований вузол, чий батько мій — межа контракту
    expect(scope.classify('goal/api')).toBe('boundary')
    // кухня під межею — чужа
    expect(scope.classify('goal/api/impl')).toBe('foreign')
    // розмічений ліс, власник не резолвиться — «нічия земля»
    expect(scope.classify('orphan')).toBe('orphaned')
  })

  it('той самий ліс очима іншого власника', () => {
    const owners = { goal: 'olena', 'goal/api': 'vkozlov' }
    const scope = deriveScope(owners, 'vkozlov')
    expect(scope.classify('goal/api')).toBe('mine')
    expect(scope.classify('goal/api/impl')).toBe('mine')
    expect(scope.classify('goal')).toBe('foreign')
    expect(scope.classify('goal/docs')).toBe('foreign')
  })

  it('розмічений ліс без ідентичності — нічого мого, orphaned видно', () => {
    const scope = deriveScope({ goal: 'olena' }, null)
    expect(scope.classify('goal')).toBe('foreign')
    expect(scope.classify('stray')).toBe('orphaned')
  })

  it('чужий корінь без мого батька — foreign, не boundary', () => {
    const scope = deriveScope({ theirs: 'vkozlov' }, 'olena')
    expect(scope.classify('theirs')).toBe('foreign')
  })
})

describe('deriveScopes', () => {
  it('скоуп на кожен воркспейс лісу', () => {
    const scopes = deriveScopes({ '/a/mt': { goal: 'olena' }, '/b/mt': {} }, 'olena')
    expect(scopes['/a/mt'].marked).toBe(true)
    expect(scopes['/b/mt'].marked).toBe(false)
    expect(scopes['/b/mt'].classify('x')).toBe('mine')
  })
})

describe('escalationAddressee (M6)', () => {
  const owners = { goal: 'vkozlov', 'goal/api': 'olena', 'goal/api/deep': 'olena' }

  it('замовник — ефективний власник найближчого предка поза моєю ділянкою', () => {
    expect(escalationAddressee(owners, 'olena', 'goal/api')).toBe('vkozlov')
    expect(escalationAddressee(owners, 'olena', 'goal/api/deep/task')).toBe('vkozlov')
  })

  it('null — вузол не мій, я власник кореня або ідентичності немає', () => {
    expect(escalationAddressee(owners, 'olena', 'goal')).toBeNull()
    expect(escalationAddressee(owners, 'vkozlov', 'goal')).toBeNull()
    expect(escalationAddressee(owners, null, 'goal/api')).toBeNull()
  })

  it('null — предок «нічия земля» (спершу признач власника)', () => {
    expect(escalationAddressee({ 'goal/api': 'olena' }, 'olena', 'goal/api')).toBeNull()
  })
})
