import { toolManifest } from './manifest.js'

/**
 * Build a domain-aware system prompt for the gateway agent.
 * @param {string[]} [workspaces] known mt workspace paths — shown to the model for grounding
 * @returns {string} system prompt string
 */
export function createSystemPrompt(workspaces = []) {
  const wsLines = workspaces.map(w => '  - ' + w).join('\n')
  const wsSection = workspaces.length ? 'Known mt workspaces:\n' + wsLines : 'Call the "workspaces" tool to discover mt task directories before acting.'

  return [
    'You are the task-app agent. Manage mt task graphs on behalf of the user.',
    'Use the provided tools to discover workspaces, scan task trees, and create tasks.',
    wsSection,
    'Call one tool at a time; wait for its result before the next.',
    'If the request is ambiguous (e.g. which project?), reply with a clarifying question and NO tool call.',
    'When satisfied, reply with a plain-text summary and no tool call.',
  ].join('\n')
}

const DEFAULT_SYSTEM = createSystemPrompt()

/**
 * Run the tool-calling loop until the model answers without a tool call.
 * Accepts either a fresh prompt or an existing messages[] for sessional resume.
 * @param {object} params loop parameters
 * @param {string} [params.prompt] user request (fresh start)
 * @param {object[]} [params.messages] existing conversation to resume (takes priority over prompt)
 * @param {(name: string, input: object) => Promise<object>} params.dispatch tool dispatcher returning an envelope
 * @param {(req: {messages: object[], tools: object[]}) => Promise<object>} params.chat model call returning an assistant message
 * @param {number} [params.maxSteps] safety cap on loop iterations
 * @param {string} [params.system] system prompt override (only used when building fresh from prompt)
 * @param {object[]} [params.tools] LLM tool manifest (default: all; pass a scoped manifest to restrict)
 * @returns {Promise<{content: string, steps: number, trace: object[], messages: object[], stopped?: string}>} loop result
 */
export async function runAgent({ prompt, messages: initialMessages, dispatch, chat, maxSteps = 6, system = DEFAULT_SYSTEM, tools = toolManifest() }) {
  const messages = initialMessages
    ? [...initialMessages]
    : [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ]
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
