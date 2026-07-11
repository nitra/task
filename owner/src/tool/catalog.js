// Єдине джерело правди tool-поверхні owner-застосунку (n-tool-surface).
// Кожна дія власника — approve/reject плану, прийняття роботи — іменований
// tool зі схемою, досяжний однаково з UI, оркестратора (bin/owner.mjs) і LLM.
// Read-тули мають cli-шлях (mt-scanner); вердикти — in-app only (деструктивна
// довіра, як delete в app): їх виконує людина власноруч у GUI.

const TASKS_DIR = {
  type: 'string',
  required: true,
  description: 'Absolute path to the mt/ tasks directory.'
}

const TASK_PATH = {
  type: 'string',
  required: true,
  description: 'Node id relative to the tasks dir, e.g. research/collect-data.'
}

// Trust tier per tool (n-tool-surface D-E1): read < write < destructive.
export const TOOLS = [
  {
    tier: 'read',
    name: 'workspaces',
    summary: 'Discover all mt workspaces (tasks dirs) under the configured project paths.',
    input: {},
    tauri: 'find_all_tasks_dirs',
    cli: () => ['workspaces']
  },
  {
    tier: 'read',
    name: 'scan',
    summary: 'Scan an mt tasks directory and return its task graph as a nested tree.',
    input: { tasksDir: TASKS_DIR },
    tauri: 'scan_tasks',
    cli: input => ['scan', input.tasksDir]
  },
  {
    tier: 'read',
    name: 'plan_review',
    summary: 'Read the current plan of a composite node: children specs and decision state.',
    input: { tasksDir: TASKS_DIR, taskPath: TASK_PATH },
    tauri: 'plan_review_info'
  },
  {
    tier: 'write',
    name: 'create_goal',
    summary: 'Create a goal node (templated mt contract) to be decomposed by the planner.',
    input: {
      tasksDir: TASKS_DIR,
      name: { type: 'string', required: true, description: 'New node id, kebab-case latin.' },
      opts: { type: 'object', required: false, description: 'Optional { mode, budget_sec, hint }.' }
    },
    tauri: 'create_task'
  },
  {
    tier: 'write',
    name: 'draft_plan',
    summary: 'Write the next immutable plan_NNN.md (Context/Children/Risks) — node enters plan-review.',
    input: {
      tasksDir: TASKS_DIR,
      taskPath: TASK_PATH,
      context: { type: 'string', required: true, description: 'Owner intent / plan context.' },
      childrenYaml: { type: 'string', required: true, description: 'YAML `children:` block (mt plan format).' },
      risks: { type: 'string', required: false, description: 'Plan risks, free text.' }
    },
    tauri: 'draft_plan'
  },
  {
    tier: 'write',
    name: 'approve_plan',
    summary: 'Approve a composite plan: validates it and materializes the child nodes.',
    input: { tasksDir: TASKS_DIR, taskPath: TASK_PATH },
    tauri: 'spawn_approve'
  },
  {
    tier: 'write',
    name: 'reject_plan',
    summary: 'Reject a composite plan with a reason (writes plan-rejected_NNN.md).',
    input: {
      tasksDir: TASKS_DIR,
      taskPath: TASK_PATH,
      reason: { type: 'string', required: true, description: 'Why the plan is rejected.' }
    },
    tauri: 'spawn_reject'
  },
  {
    tier: 'write',
    name: 'mark_done',
    summary: 'Accept a node as done by the human owner: writes the fact, runs ## Check.',
    input: {
      tasksDir: TASKS_DIR,
      taskPath: TASK_PATH,
      summary: { type: 'string', required: true, description: 'Fact summary — what was achieved.' }
    },
    tauri: 'human_done'
  }
]
