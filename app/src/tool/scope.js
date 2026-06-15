import { getTool, TOOLS } from './catalog.js'
import { toolManifest } from './manifest.js'

// Trust scope (n-tool-surface D-E1): each tool has a tier; each actor has a max
// tier. Humans (UI, at the keyboard) get everything; agents (MCP) get read+write
// but not destructive. Enforced twice: the manifest shown to the model is
// filtered, and dispatch guards the call (defense in depth).

const TIER_RANK = { read: 0, write: 1, destructive: 2 }
const ACTOR_MAX_TIER = { human: 'destructive', agent: 'write' }

/**
 * @param {{ kind?: string }} actor caller identity
 * @param {string} tier tool tier
 * @returns {boolean} whether the actor may use a tool of this tier
 */
export function allowsTier(actor, tier) {
  const max = ACTOR_MAX_TIER[actor?.kind] ?? 'read'
  return (TIER_RANK[tier] ?? Number.POSITIVE_INFINITY) <= TIER_RANK[max]
}

/**
 * LLM tool manifest filtered to what the actor may call.
 * @param {{ kind?: string }} actor caller identity
 * @returns {object[]} OpenAI tools array
 */
export function scopedManifest(actor) {
  return toolManifest(tool => allowsTier(actor, tool.tier))
}

/**
 * Tool names allowed for the actor.
 * @param {{ kind?: string }} actor caller identity
 * @returns {string[]} allowed tool names
 */
export function scopedToolNames(actor) {
  return TOOLS.filter(tool => allowsTier(actor, tool.tier)).map(tool => tool.name)
}

/**
 * Wrap a dispatch so out-of-scope tool calls return a forbidden envelope.
 * @param {(name: string, input: object) => Promise<object>} dispatch underlying dispatch
 * @param {{ kind?: string }} actor caller identity
 * @returns {(name: string, input: object) => Promise<object>} guarded dispatch
 */
export function guardDispatch(dispatch, actor) {
  return (name, input) => {
    const tool = getTool(name)
    if (tool && !allowsTier(actor, tool.tier)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'forbidden', message: `Tool "${name}" (tier ${tool.tier}) is not allowed for actor "${actor?.kind}"` },
      })
    }
    return dispatch(name, input)
  }
}
