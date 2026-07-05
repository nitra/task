import { describe, expect, it } from 'vitest'
import { validateInput } from '@7n/tauri-components'
import { getTool, TOOLS } from '../tool/catalog.js'

// Domain tests for the local tool catalog. The generic agent machinery
// (dispatch, manifest, scope, the loop) is tested in @7n/tauri-components; here
// we only cover what's task-specific: the catalog shape, the mt-scanner CLI argv
// builders, and the per-tool validators.

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
      opts: { mode: 'agent', model_tier: 'MAX', budget_sec: 1800, hint: 'atomic', deps: ['a', 'b'] }
    })
    expect(argv).toEqual([
      'create',
      '/p/mt',
      'research/collect',
      '--mode',
      'agent',
      '--model-tier',
      'MAX',
      '--budget-sec',
      '1800',
      '--hint',
      'atomic',
      '--dep',
      'a',
      '--dep',
      'b'
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

describe('validateInput against catalog tools', () => {
  it('flags a missing required field', () => {
    expect(validateInput(getTool('scan'), {})).toBe('Missing required field: tasksDir')
  })

  it('flags a wrong type', () => {
    expect(validateInput(getTool('scan'), { tasksDir: 5 })).toBe('Field "tasksDir" must be a string')
    expect(validateInput(getTool('create'), { tasksDir: '/p/mt', name: 'x', opts: [] })).toBe(
      'Field "opts" must be an object'
    )
  })

  it('runs the tool custom validator (task name)', () => {
    expect(validateInput(getTool('create'), { tasksDir: '/p/mt', name: 'Bad Name' })).toBeTruthy()
    expect(validateInput(getTool('create'), { tasksDir: '/p/mt', name: 'good-name' })).toBeNull()
  })

  it('passes when optional fields are absent', () => {
    expect(validateInput(getTool('workspaces'), {})).toBeNull()
  })
})
