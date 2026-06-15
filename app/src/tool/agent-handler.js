import { runAgent, createSystemPrompt } from './llm.js'

// Agent-gateway handlers — the entry points that start or resume the agent
// loop on behalf of a caller (human via UI or agent via MCP). They own the
// journal lifecycle and return a structured result contract.
//
// The `journal` store is injected (FS-in-Rust): node MCP bin spawns the Rust
// `journal` binary; the webview calls Tauri journal_* commands. Same shape:
// { create({intent,actor}) → id, load(id) → record, update(id, patch) }.
//
// Needs_clarification detection: final reply has no tool_calls and content
// ends with '?' or contains a known question marker.

const QUESTION_RE = /\?\s*$/

/**
 * @param {string} text candidate text
 * @returns {boolean} true when text ends with a question mark
 */
function isQuestion(text) {
  return typeof text === 'string' && QUESTION_RE.test(text.trim())
}

/**
 * Start a new agent request.
 * @param {{ intent: string, actor: {kind:string,id:string}, chat: (r:object)=>Promise<object>, dispatch: (n:string,i:object)=>Promise<object>, journal: object }} opts request parameters
 * @returns {Promise<object>} structured result envelope
 */
export async function handleRequest({ intent, actor, chat, dispatch, journal }) {
  const id = await journal.create({ intent, actor })
  await journal.update(id, { status: 'running' })

  let result
  try {
    result = await runAgent({
      system: createSystemPrompt(),
      prompt: intent,
      chat,
      dispatch,
    })
  }
  catch (error) {
    await journal.update(id, { status: 'failed', error: String(error?.message ?? error) })
    return { requestId: id, status: 'failed', summary: null, actions: [], question: null }
  }

  const question = isQuestion(result.content) ? result.content : null
  let status = 'done'
  if (result.stopped === 'max_steps') status = 'partial'
  else if (question) status = 'needs_clarification'

  await journal.update(id, {
    status,
    messages: result.messages,
    actions: result.trace,
    summary: question ? null : (result.content || null),
    question,
  })

  return {
    requestId: id,
    status,
    summary: question ? null : (result.content || null),
    actions: result.trace,
    question,
  }
}

/**
 * Resume a suspended (needs_clarification) request with a user reply.
 * @param {{ requestId: string, message: string, actor: {kind:string,id:string}, chat: (r:object)=>Promise<object>, dispatch: (n:string,i:object)=>Promise<object>, journal: object }} opts resume parameters
 * @returns {Promise<object>} updated result envelope
 */
export async function handleRespond({ requestId, message, actor: _actor, chat, dispatch, journal }) {
  let record
  try {
    record = await journal.load(requestId)
  }
  catch {
    return { requestId, status: 'failed', summary: null, actions: [], question: 'Request not found.' }
  }

  if (!['needs_clarification', 'needs_confirmation'].includes(record.status)) {
    return { requestId, status: record.status, summary: record.summary, actions: record.actions, question: null }
  }

  const resumeMessages = [...record.messages, { role: 'user', content: message }]
  await journal.update(requestId, { status: 'running' })

  let result
  try {
    result = await runAgent({ messages: resumeMessages, chat, dispatch })
  }
  catch (error) {
    await journal.update(requestId, { status: 'failed', error: String(error?.message ?? error) })
    return { requestId, status: 'failed', summary: null, actions: record.actions, question: null }
  }

  const question = isQuestion(result.content) ? result.content : null
  let status = 'done'
  if (result.stopped === 'max_steps') status = 'partial'
  else if (question) status = 'needs_clarification'
  const allActions = [...record.actions, ...result.trace]

  await journal.update(requestId, {
    status,
    messages: result.messages,
    actions: allActions,
    summary: question ? null : (result.content || null),
    question,
  })

  return {
    requestId,
    status,
    summary: question ? null : (result.content || null),
    actions: allActions,
    question,
  }
}
