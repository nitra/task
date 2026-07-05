// Domain system prompt for the task-app agent. Lives locally (not in
// @7n/tauri-components) because it is task-specific: it talks about mt task
// graphs and grounds conversational project names against the workspace list.

/**
 * Build a domain-aware system prompt for the gateway agent.
 * @param {{label: string, path: string}[]} [workspaces] known mt workspaces (label = relative project name, path = mt dir) — injected for conversational grounding
 * @returns {string} system prompt string
 */
export function createSystemPrompt(workspaces = []) {
  const wsLines = workspaces.map(w => `  - ${w.label} → ${w.path}`).join('\n')
  const wsSection = workspaces.length
    ? [
        'Available projects (label → mt path):',
        wsLines,
        'When the user names a project conversationally (e.g. "abie k8s", "abie/k8s", "the k8s project"), match it — case-insensitively, ignoring separators — against the labels above and use that project\'s path as `tasksDir`. If several match, ask which one.'
      ].join('\n')
    : 'Call the "workspaces" tool to discover projects before acting.'

  return [
    'You are the task-app agent. Manage mt task graphs on behalf of the user.',
    'Use the provided tools to discover projects, scan task trees, and create tasks.',
    wsSection,
    'Call one tool at a time; wait for its result before the next.',
    'If the request is ambiguous (e.g. which project?), reply with a clarifying question and NO tool call.',
    'When satisfied, reply with a plain-text summary and no tool call.'
  ].join('\n')
}
