import { validateTaskName } from '../task-create.js'

// Single source of truth for the headless tool surface (n-tool-surface).
// Each tool is a named, schema-described callable reachable identically by the
// UI, a script orchestrator (bin/task.mjs) and an LLM. Handlers delegate to the
// native backend: a Tauri command in-app (`tauri`), the mt-scanner binary in
// the orchestrator (`cli` → argv). The catalog stays the only place a tool is
// declared; manifests and clients derive from it.

/**
 * Build mt-scanner `create` argv from a create tool input.
 * @param {{ tasksDir: string, name: string, opts?: object }} input create input
 * @returns {string[]} argv after the binary name
 */
function createArgv(input) {
  const argv = ['create', input.tasksDir, input.name]
  const opts = input.opts ?? {}
  if (opts.mode) argv.push('--mode', opts.mode)
  if (opts.model_tier) argv.push('--model-tier', opts.model_tier)
  if (opts.budget_sec !== undefined && opts.budget_sec !== null) argv.push('--budget-sec', String(opts.budget_sec))
  if (opts.hint) argv.push('--hint', opts.hint)
  for (const dep of opts.deps ?? []) argv.push('--dep', dep)
  // NB: skills pass via Tauri invoke only; the binary ignores unknown flags.
  return argv
}

export const TOOLS = [
  {
    name: 'scan',
    summary: 'Scan an mt tasks directory and return its task graph as a nested tree.',
    input: {
      tasksDir: { type: 'string', required: true, description: 'Absolute path to the mt/ tasks directory.' },
    },
    tauri: 'scan_tasks',
    cli: input => ['scan', input.tasksDir],
  },
  {
    name: 'workspaces',
    summary: 'Discover all mt workspaces (tasks dirs) under the current git repo.',
    input: {},
    tauri: 'find_all_tasks_dirs',
    cli: () => ['workspaces'],
  },
  {
    name: 'create',
    summary: 'Create a new mt task node (task.md + a.md/h.md flag + optional deps).',
    input: {
      tasksDir: { type: 'string', required: true, description: 'Absolute path to the mt/ tasks directory.' },
      name: { type: 'string', required: true, description: 'Node id; "/" separates nested segments, e.g. research/collect-data.' },
      opts: { type: 'object', required: false, description: 'Optional { mode, model_tier, budget_sec, hint, deps, skills }; empty fields fall back to .mt.json.' },
    },
    validate: input => validateTaskName(input.name),
    tauri: 'create_task',
    cli: createArgv,
  },
]

/**
 * Look up a tool by name.
 * @param {string} name tool name
 * @returns {object|null} the tool definition, or null if unknown
 */
export function getTool(name) {
  return TOOLS.find(tool => tool.name === name) ?? null
}
