import { createSystemPrompt, runAgent } from './llm.js'
import { classify, scopedManifest } from './scope.js'

// Agent-gateway handlers — start / resume / approve the agent loop on behalf of a
// caller (human via UI or agent via MCP). They own the journal lifecycle and
// return a structured result contract.
//
// The `journal` store is injected (FS-in-Rust): node MCP bin spawns the Rust
// `journal` binary; the webview calls Tauri journal_* commands.
//
// Trust: destructive tool calls from an agent pause as `needs_approval` (the
// loop never executes them); a human approves later via handleApprove.

const QUESTION_RE = /\?\s*$/

/**
 * @param {string} text candidate text
 * @returns {boolean} true when text ends with a question mark
 */
function isQuestion(text) {
  return typeof text === 'string' && QUESTION_RE.test(text.trim())
}

/**
 * Derive the structured result fields from a runAgent result.
 * @param {object} result runAgent result
 * @returns {{ status: string, summary: string|null, question: string|null, pendingApproval: object|null }} fields
 */
function finalize(result) {
  const question = isQuestion(result.content) ? result.content : null
  let status = 'done'
  if (result.stopped === 'needs_approval') status = 'needs_approval'
  else if (result.stopped === 'max_steps') status = 'partial'
  else if (question) status = 'needs_clarification'
  return {
    status,
    summary: question ? null : (result.content || null),
    question,
    pendingApproval: result.pendingApproval ?? null,
  }
}

/**
 * Run the loop (fresh or resumed), persist to the journal, return the envelope.
 * @param {{ requestId: string, runArgs: object, baseActions: object[], journal: object }} ctx run context
 * @returns {Promise<object>} structured result envelope
 */
async function runAndJournal({ requestId, runArgs, baseActions, journal }) {
  let result
  try {
    result = await runAgent(runArgs)
  }
  catch (error) {
    await journal.update(requestId, { status: 'failed', error: String(error?.message ?? error) })
    return { requestId, status: 'failed', summary: null, actions: baseActions, question: null, pendingApproval: null }
  }

  const fields = finalize(result)
  const actions = [...baseActions, ...result.trace]
  await journal.update(requestId, { ...fields, messages: result.messages, actions })
  return { requestId, ...fields, actions }
}

/**
 * Start a new agent request.
 * @param {{ intent: string, actor: {kind:string,id:string}, chat: Function, dispatch: Function, journal: object }} opts request parameters
 * @returns {Promise<object>} structured result envelope
 */
export async function handleRequest({ intent, actor, chat, dispatch, journal }) {
  const id = await journal.create({ intent, actor })
  await journal.update(id, { status: 'running' })
  return runAndJournal({
    requestId: id,
    baseActions: [],
    journal,
    runArgs: { system: createSystemPrompt(), prompt: intent, chat, dispatch, tools: scopedManifest(actor), gate: name => classify(actor, name) },
  })
}

/**
 * Resume a conversation with a follow-up / clarification answer.
 * @param {{ requestId: string, message: string, actor: {kind:string,id:string}, chat: Function, dispatch: Function, journal: object }} opts resume parameters
 * @returns {Promise<object>} updated result envelope
 */
export async function handleRespond({ requestId, message, actor, chat, dispatch, journal }) {
  let record
  try {
    record = await journal.load(requestId)
  }
  catch {
    return { requestId, status: 'failed', summary: null, actions: [], question: 'Request not found.', pendingApproval: null }
  }

  if (record.status === 'running' || !Array.isArray(record.messages) || record.messages.length === 0) {
    return { requestId, status: record.status, summary: record.summary, actions: record.actions, question: null, pendingApproval: record.pendingApproval ?? null }
  }

  await journal.update(requestId, { status: 'running' })
  return runAndJournal({
    requestId,
    baseActions: record.actions ?? [],
    journal,
    runArgs: { messages: [...record.messages, { role: 'user', content: message }], chat, dispatch, tools: scopedManifest(actor), gate: name => classify(actor, name) },
  })
}

/**
 * Approve (or reject) a pending destructive action. Executes with the approver's
 * (human) authority via the injected dispatch — no gate.
 * @param {{ requestId: string, approve: boolean, dispatch: Function, journal: object }} opts approval parameters
 * @returns {Promise<object>} updated result envelope
 */
export async function handleApprove({ requestId, approve, dispatch, journal }) {
  let record
  try {
    record = await journal.load(requestId)
  }
  catch {
    return { requestId, status: 'failed', summary: null, actions: [], question: 'Request not found.', pendingApproval: null }
  }

  if (record.status !== 'needs_approval' || !record.pendingApproval) {
    return { requestId, status: record.status, summary: record.summary, actions: record.actions ?? [], question: null, pendingApproval: null }
  }

  if (!approve) {
    const fields = { status: 'rejected', summary: 'Rejected by human.', pendingApproval: null }
    await journal.update(requestId, fields)
    return { requestId, ...fields, actions: record.actions ?? [], question: null }
  }

  const { tool, input } = record.pendingApproval
  await journal.update(requestId, { status: 'running' })
  const envelope = await dispatch(tool, input)
  const actions = [...(record.actions ?? []), { tool, input, envelope }]
  const status = envelope.ok ? 'done' : 'failed'
  const summary = envelope.ok ? `Approved: ${tool} executed.` : null
  await journal.update(requestId, { status, actions, summary, error: envelope.ok ? null : (envelope.error?.message ?? 'failed'), pendingApproval: null })
  return { requestId, status, summary, actions, question: null, pendingApproval: null }
}
