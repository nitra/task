import { describe, expect, it } from 'vitest'
import { createDispatch } from '@7n/tauri-components'
import { TOOLS } from '../tool/catalog.js'

describe('owner tool catalog', () => {
  it('кожен tool має tier, summary, схему входу і tauri-команду', () => {
    for (const tool of TOOLS) {
      expect(['read', 'write', 'destructive']).toContain(tool.tier)
      expect(tool.summary.length).toBeGreaterThan(10)
      expect(tool.input).toBeTypeOf('object')
      expect(tool.tauri).toBeTypeOf('string')
    }
  })

  it('вердикти (write) — in-app only: без cli-шляху', () => {
    const writeTools = TOOLS.filter(t => t.tier === 'write')
    expect(writeTools.map(t => t.name).toSorted()).toEqual(['approve_plan', 'mark_done', 'reject_plan'])
    for (const tool of writeTools) expect(tool.cli).toBeUndefined()
  })

  it('cli-мапінг read-тулів будує argv mt-scanner', () => {
    const scan = TOOLS.find(t => t.name === 'scan')
    expect(scan.cli({ tasksDir: '/x/mt' })).toEqual(['scan', '/x/mt'])
  })

  it('dispatch валідує обовʼязкові поля до транспорту', async () => {
    const dispatch = createDispatch(TOOLS, () => {
      throw new Error('transport must not be reached')
    })
    const envelope = await dispatch('reject_plan', { tasksDir: '/x/mt', taskPath: 'a' })
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('validation')
    expect(envelope.error.message).toContain('reason')
  })

  it('dispatch загортає результат транспорту в конверт', async () => {
    const calls = []
    const dispatch = createDispatch(TOOLS, (tool, input) => {
      calls.push([tool.tauri, input])
      return { approved_file: 'plan-approved_001.md', children: ['a/b'] }
    })
    const envelope = await dispatch('approve_plan', { tasksDir: '/x/mt', taskPath: 'a' })
    expect(envelope).toEqual({
      ok: true,
      output: { approved_file: 'plan-approved_001.md', children: ['a/b'] }
    })
    expect(calls).toEqual([['spawn_approve', { tasksDir: '/x/mt', taskPath: 'a' }]])
  })
})
