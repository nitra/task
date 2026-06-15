import { describe, expect, it, vi } from 'vitest'
import { handleApprove, handleRequest, handleRespond } from '../tool/agent-handler.js'

/**
 * In-memory journal store (same shape as the node/tauri stores).
 * @returns {object} journal store with create/load/update
 */
function memJournal() {
  const store = new Map()
  let n = 0
  return {
    store,
    create: ({ intent, actor }) => {
      const id = `r${++n}`
      store.set(id, { id, intent, actor, status: 'pending', messages: [], actions: [] })
      return id
    },
    load: id => structuredClone(store.get(id)),
    update: (id, patch) => { store.set(id, { ...store.get(id), ...patch }) },
  }
}

/**
 * @param {string} id tool_call id
 * @param {string} name tool name
 * @param {object} args arguments
 * @returns {object} assistant message requesting a tool call
 */
function toolCall(id, name, args) {
  return { role: 'assistant', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}

describe('handleRequest', () => {
  it('runs the loop, records actions, journals a done status', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce(toolCall('c1', 'create', { tasksDir: '/p/mt', name: 'x' }))
      .mockResolvedValueOnce({ role: 'assistant', content: 'Created x.' })
    const dispatch = vi.fn().mockResolvedValue({ ok: true, output: { created: true } })
    const journal = memJournal()

    const res = await handleRequest({ intent: 'create x', actor: { kind: 'agent', id: 't' }, chat, dispatch, journal })

    expect(res.status).toBe('done')
    expect(res.summary).toBe('Created x.')
    expect(res.actions).toHaveLength(1)
    const rec = journal.load(res.requestId)
    expect(rec.status).toBe('done')
    expect(rec.actor).toEqual({ kind: 'agent', id: 't' })
    expect(rec.messages.length).toBeGreaterThan(0)
  })

  it('returns needs_clarification when the model asks a question', async () => {
    const chat = vi.fn().mockResolvedValue({ role: 'assistant', content: 'Which project?' })
    const dispatch = vi.fn()
    const journal = memJournal()

    const res = await handleRequest({ intent: 'create x', actor: { kind: 'human', id: 'local' }, chat, dispatch, journal })

    expect(res.status).toBe('needs_clarification')
    expect(res.question).toBe('Which project?')
    expect(dispatch).not.toHaveBeenCalled()
    expect(journal.load(res.requestId).status).toBe('needs_clarification')
  })

  it('journals failed on a loop error', async () => {
    const chat = vi.fn().mockRejectedValue(new Error('omlx down'))
    const journal = memJournal()
    const res = await handleRequest({ intent: 'x', actor: { kind: 'agent', id: 't' }, chat, dispatch: vi.fn(), journal })
    expect(res.status).toBe('failed')
    expect(journal.load(res.requestId).error).toBe('omlx down')
  })
})

describe('handleRespond', () => {
  it('resumes a clarified request and completes it', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ role: 'assistant', content: 'Which project?' })
      .mockResolvedValueOnce(toolCall('c1', 'create', { tasksDir: '/p/mt', name: 'x' }))
      .mockResolvedValueOnce({ role: 'assistant', content: 'Created x in p.' })
    const dispatch = vi.fn().mockResolvedValue({ ok: true, output: { created: true } })
    const journal = memJournal()

    const first = await handleRequest({ intent: 'create x', actor: { kind: 'agent', id: 't' }, chat, dispatch, journal })
    expect(first.status).toBe('needs_clarification')

    const second = await handleRespond({ requestId: first.requestId, message: 'project p', actor: { kind: 'agent', id: 't' }, chat, dispatch, journal })
    expect(second.status).toBe('done')
    expect(second.summary).toBe('Created x in p.')
    expect(second.actions).toHaveLength(1)
    expect(journal.load(first.requestId).status).toBe('done')
  })

  it('is a no-op when the request is not awaiting clarification', async () => {
    const journal = memJournal()
    const id = journal.create({ intent: 'x', actor: { kind: 'agent', id: 't' } })
    journal.update(id, { status: 'done', summary: 'ok', actions: [] })
    const res = await handleRespond({ requestId: id, message: 'hi', actor: { kind: 'agent', id: 't' }, chat: vi.fn(), dispatch: vi.fn(), journal })
    expect(res.status).toBe('done')
  })
})

describe('destructive approval (D-E2)', () => {
  it('agent destructive request pauses as needs_approval without executing', async () => {
    const chat = vi.fn().mockResolvedValueOnce(toolCall('c1', 'delete', { tasksDir: '/p/mt', name: 'x' }))
    const dispatch = vi.fn()
    const journal = memJournal()

    const res = await handleRequest({ intent: 'delete x', actor: { kind: 'agent', id: 't' }, chat, dispatch, journal })

    expect(res.status).toBe('needs_approval')
    expect(res.pendingApproval).toEqual({ tool: 'delete', input: { tasksDir: '/p/mt', name: 'x' } })
    expect(dispatch).not.toHaveBeenCalled()
    expect(journal.load(res.requestId).pendingApproval.tool).toBe('delete')
  })

  it('handleApprove executes the pending action and marks done', async () => {
    const journal = memJournal()
    const id = journal.create({ intent: 'delete x', actor: { kind: 'agent', id: 't' } })
    journal.update(id, { status: 'needs_approval', pendingApproval: { tool: 'delete', input: { tasksDir: '/p/mt', name: 'x' } }, actions: [] })
    const dispatch = vi.fn().mockResolvedValue({ ok: true, output: {} })

    const res = await handleApprove({ requestId: id, approve: true, dispatch, journal })

    expect(dispatch).toHaveBeenCalledWith('delete', { tasksDir: '/p/mt', name: 'x' })
    expect(res.status).toBe('done')
    expect(res.actions).toHaveLength(1)
    expect(journal.load(id).pendingApproval).toBeNull()
  })

  it('handleApprove reject marks rejected without executing', async () => {
    const journal = memJournal()
    const id = journal.create({ intent: 'delete x', actor: { kind: 'agent', id: 't' } })
    journal.update(id, { status: 'needs_approval', pendingApproval: { tool: 'delete', input: {} } })
    const dispatch = vi.fn()

    const res = await handleApprove({ requestId: id, approve: false, dispatch, journal })

    expect(res.status).toBe('rejected')
    expect(dispatch).not.toHaveBeenCalled()
  })
})
