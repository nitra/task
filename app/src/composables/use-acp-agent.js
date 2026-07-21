import { CODEX_ACP_AGENT_PRESET } from '@7n/tauri-components'
import { useAcpAgent as useAcpAgentBase } from '@7n/tauri-components/vue'
import { homeDir } from '@tauri-apps/api/path'
import { TOOLS } from '../tool/catalog.js'

// In-app ACP agent gateway — replaces the removed omlx/runAgent useAgent()
// (see @7n/tauri-components CHANGELOG 0.11.0). systemPrompt/grounding no
// longer apply: the ACP agent reads project context itself (AGENTS.md/
// CLAUDE.md under cwd, plus the "workspaces" tool via the domain MCP bridge)
// instead of an injected system prompt — see npm/SPEC.md §3.2 of the package.
//
// task manages mt task graphs across multiple, independently-discovered
// workspaces (see TOOLS' "workspaces" tool) — there's no single "project
// root" the way a normal repo-scoped app has one, so cwd is just a sane
// default for the spawned agent CLI, not a meaningful workspace root; the
// actual tasksDir for every catalog action comes from tool input, resolved
// by the agent via the workspaces/scan tools. Falls back to "." outside a
// real Tauri runtime (e.g. browser dev preview) so an unavailable home dir
// can't crash the whole module graph via an unhandled top-level await
// rejection.
let cwd
try {
  cwd = await homeDir()
} catch {
  cwd = '.'
}

/**
 * @returns {object} the in-app ACP agent gateway (agentKind/modelTier refs, journal, loadEnv/request/respond/approve)
 */
export function useAcpAgent() {
  return useAcpAgentBase({
    catalog: TOOLS,
    cwd,
    agents: {
      codex: CODEX_ACP_AGENT_PRESET,
      cursor: {
        command: 'cursor',
        args: ['agent', 'acp'],
        tiers: {
          MIN: { label: 'GPT-5 Mini', args: ['--model', 'gpt-5-mini'] },
          AVG: { label: 'Grok 4.5', args: ['--model', 'cursor-grok-4.5-high'] },
          MAX: { label: 'Auto', args: ['--model', 'auto'] }
        }
      },
      pi: {
        // pi-acp hardcodes its own spawn args (`pi --mode rpc --no-themes`) and
        // has no model/provider passthrough — model comes from pi's own
        // ~/.pi/agent/settings.json, so no per-tier override is possible here.
        command: 'npx',
        args: ['-y', 'pi-acp']
      }
    }
  })
}
