import { toolManifest } from './manifest.js'

// LLM adapter (n-tool-surface): the agent loop that lets an LLM drive the tool
// surface with no UI. Both `chat` (the model call) and `dispatch` (tool
// execution) are injected, so the same loop runs in-app (tauri-http + invoke
// transport) and in the orchestrator (node fetch + mt-scanner transport), and
// is unit-testable with mocks. Targets the OpenAI function-calling shape
// because the model is served via omlx (OpenAI-compatible MLX server).

const SYSTEM_PROMPT = [
  'You manage an mt task graph. Use the provided tools to scan, discover and create tasks.',
  'Call one tool at a time; wait for its result before the next.',
  'When the request is satisfied, reply with a short plain-text summary and no tool call.',
].join(' ')

/**
 * Run the tool-calling loop until the model answers without a tool call.
 * @param {object} params loop params
 * @param {string} params.prompt user request
 * @param {(name: string, input: object) => Promise<object>} params.dispatch tool dispatcher (returns envelope)
 * @param {(req: {messages: object[], tools: object[]}) => Promise<object>} params.chat model call → assistant message
 * @param {number} [params.maxSteps] safety cap on loop iterations
 * @param {string} [params.system] system prompt override
 * @returns {Promise<{content: string, steps: number, trace: object[], messages: object[], stopped?: string}>} result
 */
export async function runAgent({ prompt, dispatch, chat, maxSteps = 6, system = SYSTEM_PROMPT }) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
  ]
  const tools = toolManifest()
  const trace = []

  for (let step = 0; step < maxSteps; step++) {
    const reply = await chat({ messages, tools })
    messages.push(reply)

    const calls = reply.tool_calls ?? []
    if (calls.length === 0) {
      return { content: reply.content ?? '', steps: step + 1, trace, messages }
    }

    for (const call of calls) {
      let input = {}
      try {
        input = call.function.arguments ? JSON.parse(call.function.arguments) : {}
      }
      catch {
        // leave input empty — dispatch's schema validation reports the problem
      }
      const envelope = await dispatch(call.function.name, input)
      trace.push({ tool: call.function.name, input, envelope })
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(envelope) })
    }
  }

  return { content: '', steps: maxSteps, trace, messages, stopped: 'max_steps' }
}

/**
 * Build a `chat` function that calls an OpenAI-compatible endpoint (omlx).
 * @param {object} params config
 * @param {string} params.baseUrl base URL incl. /v1 (e.g. http://127.0.0.1:10240/v1)
 * @param {string} params.model served model id (e.g. a gemma-3n-e4b variant)
 * @param {string} [params.apiKey] optional bearer token
 * @param {typeof fetch} [params.fetchFn] fetch implementation (injectable for tests / tauri-http)
 * @returns {(req: {messages: object[], tools: object[]}) => Promise<object>} chat function
 */
export function createOpenAiChat({ baseUrl, model, apiKey, fetchFn = fetch }) {
  return async function chat({ messages, tools }) {
    const response = await fetchFn(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto' }),
    })
    if (!response.ok) {
      throw new Error(`omlx ${response.status}: ${await response.text()}`)
    }
    const data = await response.json()
    return data.choices[0].message
  }
}
