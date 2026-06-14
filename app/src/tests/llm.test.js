import { describe, expect, it, vi } from 'vitest'
import { createOpenAiChat, runAgent } from '../tool/llm.js'

/**
 * Build an assistant message that requests one tool call.
 * @param {string} id tool_call id
 * @param {string} name tool name
 * @param {object} args tool arguments
 * @returns {object} assistant message
 */
function toolCallMsg(id, name, args) {
  return { role: 'assistant', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}

describe('runAgent', () => {
  it('executes a tool call, feeds the result back, then returns the final answer', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce(toolCallMsg('c1', 'create', { tasksDir: '/p/mt', name: 'x' }))
      .mockResolvedValueOnce({ role: 'assistant', content: 'Created x.' })
    const dispatch = vi.fn().mockResolvedValue({ ok: true, output: { created: true } })

    const result = await runAgent({ prompt: 'create x', dispatch, chat })

    expect(dispatch).toHaveBeenCalledWith('create', { tasksDir: '/p/mt', name: 'x' })
    expect(result.content).toBe('Created x.')
    expect(result.steps).toBe(2)
    expect(result.trace).toEqual([{ tool: 'create', input: { tasksDir: '/p/mt', name: 'x' }, envelope: { ok: true, output: { created: true } } }])
    // assistant tool_call + tool result are threaded into the conversation
    const toolMsg = result.messages.find(m => m.role === 'tool')
    expect(toolMsg).toMatchObject({ tool_call_id: 'c1' })
    expect(JSON.parse(toolMsg.content)).toEqual({ ok: true, output: { created: true } })
  })

  it('returns immediately when the model makes no tool call', async () => {
    const chat = vi.fn().mockResolvedValue({ role: 'assistant', content: 'hi' })
    const dispatch = vi.fn()
    const result = await runAgent({ prompt: 'hello', dispatch, chat })
    expect(result.content).toBe('hi')
    expect(result.steps).toBe(1)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('stops at maxSteps when the model keeps calling tools', async () => {
    const chat = vi.fn().mockResolvedValue(toolCallMsg('c', 'scan', { tasksDir: '/p/mt' }))
    const dispatch = vi.fn().mockResolvedValue({ ok: true, output: [] })
    const result = await runAgent({ prompt: 'loop', dispatch, chat, maxSteps: 2 })
    expect(result.stopped).toBe('max_steps')
    expect(result.steps).toBe(2)
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it('dispatches with empty input when tool arguments are invalid JSON', async () => {
    const chat = vi.fn()
      .mockResolvedValueOnce({ role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'scan', arguments: '{bad' } }] })
      .mockResolvedValueOnce({ role: 'assistant', content: 'done' })
    const dispatch = vi.fn().mockResolvedValue({ ok: false, error: { code: 'validation', message: 'x' } })
    await runAgent({ prompt: 'p', dispatch, chat })
    expect(dispatch).toHaveBeenCalledWith('scan', {})
  })
})

describe('createOpenAiChat', () => {
  it('posts chat completions and returns the assistant message', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { role: 'assistant', content: 'hi' } }] }),
    })
    const chat = createOpenAiChat({ baseUrl: "https://x/v1", model: 'm', fetchFn })
    const message = await chat({ messages: [{ role: 'user', content: 'q' }], tools: [] })

    expect(message.content).toBe('hi')
    const [url, opts] = fetchFn.mock.calls[0]
    expect(url).toBe("https://x/v1/chat/completions")
    expect(JSON.parse(opts.body)).toMatchObject({ model: 'm', tool_choice: 'auto' })
  })

  it('throws on a non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') })
    const chat = createOpenAiChat({ baseUrl: "https://x/v1", model: 'm', fetchFn })
    await expect(chat({ messages: [], tools: [] })).rejects.toThrow('omlx 500: boom')
  })
})
