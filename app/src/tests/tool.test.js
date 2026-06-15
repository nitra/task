import { describe, expect, it, vi } from 'vitest'
import { getTool, TOOLS } from '../tool/catalog.js'
import { createDispatch, validateInput } from '../tool/dispatch.js'
import { listTools, toolManifest } from '../tool/manifest.js'

describe('catalog', () => {
  it('every tool has name, summary, input and a tauri command', () => {
    for (const tool of TOOLS) {
      expect(tool.name).toBeTruthy()
      expect(tool.summary).toBeTruthy()
      expect(tool.input).toBeTypeOf('object')
      expect(tool.tauri).toBeTruthy()
      // Non-destructive tools expose a headless CLI path; destructive ones are
      // in-app/approval-only (no orchestrator CLI).
      if (tool.tier !== 'destructive') expect(tool.cli).toBeTypeOf('function')
    }
  })

  it('getTool resolves known and unknown names', () => {
    expect(getTool('scan')?.name).toBe('scan')
    expect(getTool('nope')).toBeNull()
  })

  it('create cli builds mt-scanner argv with flags from opts', () => {
    const argv = getTool('create').cli({
      tasksDir: '/p/mt',
      name: 'research/collect',
      opts: { mode: 'agent', model_tier: 'MAX', budget_sec: 1800, hint: 'atomic', deps: ['a', 'b'] },
    })
    expect(argv).toEqual([
      'create', '/p/mt', 'research/collect',
      '--mode', 'agent', '--model-tier', 'MAX', '--budget-sec', '1800', '--hint', 'atomic',
      '--dep', 'a', '--dep', 'b',
    ])
  })

  it('create cli omits flags for empty opts', () => {
    expect(getTool('create').cli({ tasksDir: '/p/mt', name: 'x' })).toEqual(['create', '/p/mt', 'x'])
  })

  it('scan/workspaces cli build their verbs', () => {
    expect(getTool('scan').cli({ tasksDir: '/p/mt' })).toEqual(['scan', '/p/mt'])
    expect(getTool('workspaces').cli({})).toEqual(['workspaces'])
  })
})

describe('validateInput', () => {
  it('flags a missing required field', () => {
    expect(validateInput(getTool('scan'), {})).toBe('Missing required field: tasksDir')
  })

  it('flags a wrong type', () => {
    expect(validateInput(getTool('scan'), { tasksDir: 5 })).toBe('Field "tasksDir" must be a string')
    expect(validateInput(getTool('create'), { tasksDir: '/p/mt', name: 'x', opts: [] }))
      .toBe('Field "opts" must be an object')
  })

  it('runs the tool custom validator (task name)', () => {
    expect(validateInput(getTool('create'), { tasksDir: '/p/mt', name: 'Bad Name' })).toBeTruthy()
    expect(validateInput(getTool('create'), { tasksDir: '/p/mt', name: 'good-name' })).toBeNull()
  })

  it('passes when optional fields are absent', () => {
    expect(validateInput(getTool('workspaces'), {})).toBeNull()
  })
})

describe('dispatch', () => {
  it('returns an ok envelope from the transport output', async () => {
    const transport = vi.fn().mockResolvedValue([{ id: 'a' }])
    const dispatch = createDispatch(transport)
    const result = await dispatch('scan', { tasksDir: '/p/mt' })
    expect(result).toEqual({ ok: true, output: [{ id: 'a' }] })
    expect(transport).toHaveBeenCalledWith(getTool('scan'), { tasksDir: '/p/mt' })
  })

  it('rejects an unknown tool without calling the transport', async () => {
    const transport = vi.fn()
    const result = await createDispatch(transport)('nope', {})
    expect(result).toEqual({ ok: false, error: { code: 'not_found', message: 'Unknown tool: nope' } })
    expect(transport).not.toHaveBeenCalled()
  })

  it('rejects invalid input before the transport', async () => {
    const transport = vi.fn()
    const result = await createDispatch(transport)('scan', {})
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('validation')
    expect(transport).not.toHaveBeenCalled()
  })

  it('wraps a transport failure as an io error', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('boom'))
    const result = await createDispatch(transport)('scan', { tasksDir: '/p/mt' })
    expect(result).toEqual({ ok: false, error: { code: 'io', message: 'boom' } })
  })
})

describe('manifest', () => {
  it('emits OpenAI function-calling tools from the catalog', () => {
    const manifest = toolManifest()
    expect(manifest).toHaveLength(TOOLS.length)
    const scan = manifest.find(entry => entry.function.name === 'scan')
    expect(scan).toMatchObject({
      type: 'function',
      function: {
        name: 'scan',
        parameters: { type: 'object', required: ['tasksDir'] },
      },
    })
    expect(scan.function.parameters.properties.tasksDir.type).toBe('string')
  })

  it('lists tools as name + summary', () => {
    const list = listTools()
    expect(list).toHaveLength(TOOLS.length)
    expect(list.every(item => item.name && item.summary)).toBe(true)
  })
})
