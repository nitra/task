import { getTool, TOOLS } from './catalog.js'
import { toolManifest } from './manifest.js'

// Trust scope (n-tool-surface D-E1/D-E2). Each tool has a tier; each actor has a
// max tier it may EXECUTE directly. Above that:
//   - agent + destructive → 'approval' (request goes to the human via the journal);
//   - otherwise           → 'deny'.
// Humans (UI, at the keyboard) execute everything directly.

const TIER_RANK = { read: 0, write: 1, destructive: 2 }
const ACTOR_EXEC_MAX = { human: 2, agent: 1 }

/**
 * Classify a tool call for an actor.
 * @param {{ kind?: string }} actor caller identity
 * @param {string} toolName tool name
 * @returns {'allow'|'approval'|'deny'} decision
 */
export function classify(actor, toolName) {
  const tool = getTool(toolName)
  if (!tool) return 'deny'
  const rank = TIER_RANK[tool.tier] ?? Number.POSITIVE_INFINITY
  const max = ACTOR_EXEC_MAX[actor?.kind] ?? 0
  if (rank <= max) return 'allow'
  if (tool.tier === 'destructive' && actor?.kind === 'agent') return 'approval'
  return 'deny'
}

/**
 * LLM tool manifest visible to the actor (everything it may run OR request approval for).
 * @param {{ kind?: string }} actor caller identity
 * @returns {object[]} OpenAI tools array
 */
export function scopedManifest(actor) {
  return toolManifest(tool => classify(actor, tool.name) !== 'deny')
}

/**
 * Tool names visible to the actor.
 * @param {{ kind?: string }} actor caller identity
 * @returns {string[]} visible tool names
 */
export function scopedToolNames(actor) {
  return TOOLS.filter(tool => classify(actor, tool.name) !== 'deny').map(tool => tool.name)
}
