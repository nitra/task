import { describe, expect, it, vi } from 'vitest'
import { allowsTier, guardDispatch, scopedManifest, scopedToolNames } from '../tool/scope.js'

describe('allowsTier', () => {
  it('humans may use every tier', () => {
    for (const tier of ['read', 'write', 'destructive']) {
      expect(allowsTier({ kind: 'human' }, tier)).toBe(true)
    }
  })

  it('agents may read and write but not destroy', () => {
    expect(allowsTier({ kind: 'agent' }, 'read')).toBe(true)
    expect(allowsTier({ kind: 'agent' }, 'write')).toBe(true)
    expect(allowsTier({ kind: 'agent' }, 'destructive')).toBe(false)
  })

  it('unknown actors get read-only', () => {
    expect(allowsTier({ kind: 'viewer' }, 'read')).toBe(true)
    expect(allowsTier({ kind: 'viewer' }, 'write')).toBe(false)
    expect(allowsTier(undefined, 'write')).toBe(false)
  })
})

describe('scopedManifest / scopedToolNames', () => {
  it('agents see read+write tools (scan/workspaces/create)', () => {
    const names = scopedToolNames({ kind: 'agent' })
    expect(names).toEqual(['scan', 'workspaces', 'create'])
    expect(scopedManifest({ kind: 'agent' }).map(t => t.function.name)).toEqual(names)
  })

  it('read-only actors do not see the write tool', () => {
    expect(scopedToolNames({ kind: 'viewer' })).toEqual(['scan', 'workspaces'])
  })
})

describe('guardDispatch', () => {
  it('passes allowed calls through to the underlying dispatch', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true, output: {} })
    const guarded = guardDispatch(dispatch, { kind: 'agent' })
    await guarded('create', { tasksDir: '/p/mt', name: 'x' })
    expect(dispatch).toHaveBeenCalledWith('create', { tasksDir: '/p/mt', name: 'x' })
  })

  it('blocks out-of-scope calls without touching dispatch', async () => {
    const dispatch = vi.fn()
    const guarded = guardDispatch(dispatch, { kind: 'viewer' })
    const res = await guarded('create', { tasksDir: '/p/mt', name: 'x' })
    expect(res).toEqual({ ok: false, error: { code: 'forbidden', message: expect.stringContaining('not allowed') } })
    expect(dispatch).not.toHaveBeenCalled()
  })
})
