import { useAgent as useAgentBase } from '@7n/tauri-components/vue'
import { TOOLS } from '../tool/catalog.js'
import { createSystemPrompt } from '../tool/prompt.js'

// In-app agent gateway: binds the shared @7n/tauri-components agent to this app's
// tool catalog + domain prompt. Everything Tauri-specific (omlx over tauri-http,
// tools/journal via the tauri-plugin-agent commands) is wired inside the base
// composable. Requests are grounded with the workspace list (label → mt path).

/**
 * @returns {object} the in-app agent gateway (baseUrl/model/apiKey refs, journal, request/respond/approve)
 */
export function useAgent() {
  return useAgentBase({
    catalog: TOOLS,
    systemPrompt: ctx => createSystemPrompt(ctx.workspaces),
    grounding: { tool: 'workspaces', key: 'workspaces' },
    omlx: { storagePrefix: 'task', defaultModel: 'gemma-4-e4b-it-OptiQ-4bit' }
  })
}
