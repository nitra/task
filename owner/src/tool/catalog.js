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
    name: 'project_paths',
    summary: 'Read the configured project search paths (roots where mt workspaces are discovered).',
    input: {},
    tauri: 'get_project_paths'
  },
  {
    tier: 'write',
    name: 'set_project_paths',
    summary: 'Persist the project search paths shared by the GUI and headless consumers.',
    input: {
      // type 'array' — dispatch-валідатор перевіряє лише required (масив не object)
      paths: { type: 'array', required: true, description: 'Array of absolute directory paths.' }
    },
    tauri: 'set_project_paths'
  },
  {
    tier: 'read',
    name: 'read_node',
    summary: 'Read the task.md contract of a node (digest source for the critic).',
    input: { tasksDir: TASKS_DIR, taskPath: TASK_PATH },
    tauri: 'read_task'
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
    tier: 'read',
    name: 'whoami',
    summary: "Read the configured owner identity handle (null — the 'who are you' step not done yet).",
    input: {},
    tauri: 'get_identity'
  },
  {
    tier: 'write',
    name: 'set_identity',
    summary: 'Persist the owner identity handle locally (PII stays out of git — mt directory policy).',
    input: {
      handle: { type: 'string', required: true, description: 'Owner handle, same format as h.md assignee.' }
    },
    tauri: 'set_identity'
  },
  {
    tier: 'read',
    name: 'snoozes',
    summary: 'Read the active reminder snoozes of the current identity (id -> until ISO; personal, not in git).',
    input: {},
    tauri: 'get_snoozes'
  },
  {
    tier: 'write',
    name: 'snooze_reminder',
    summary: 'Silence a reminder until the given moment — for the current identity only (deadline in git stays).',
    input: {
      id: { type: 'string', required: true, description: 'Stable reminder id (rule|workspace|path|anchor).' },
      until: { type: 'string', required: true, description: 'ISO 8601 moment when the reminder resurfaces.' }
    },
    tauri: 'snooze_reminder'
  },
  {
    tier: 'read',
    name: 'scan_owners',
    summary: 'Collect the owner: markup of a workspace (autonomy.yml files) — raw input for scope derivation.',
    input: { tasksDir: TASKS_DIR },
    tauri: 'scan_owners'
  },
  {
    tier: 'read',
    name: 'scan_escalations',
    summary: 'Collect escalation series of a workspace (escalation_NNN.md files) — raw input for queue routing.',
    input: { tasksDir: TASKS_DIR },
    tauri: 'scan_escalations'
  },
  {
    tier: 'write',
    name: 'escalate',
    summary:
      'Escalate a node to its customer with a mandatory note (fail-closed) — writes immutable escalation_NNN.md.',
    input: {
      tasksDir: TASKS_DIR,
      taskPath: TASK_PATH,
      to: { type: 'string', required: true, description: 'Addressee handle — effective owner of the parent node.' },
      reason: {
        type: 'string',
        required: true,
        description: 'The note: what happened / what was tried / what is asked / by when.'
      }
    },
    tauri: 'escalate'
  },
  {
    tier: 'write',
    name: 'resolve_escalation',
    summary: 'Resolve an open escalation with a verdict (addressee only) — writes escalation-resolved_NNN.md.',
    input: {
      tasksDir: TASKS_DIR,
      taskPath: TASK_PATH,
      nnn: { type: 'number', required: true, description: 'Escalation series number to resolve.' },
      verdict: { type: 'string', required: true, description: 'The customer verdict for the branch owner.' }
    },
    tauri: 'resolve_escalation'
  },
  {
    tier: 'write',
    name: 'delegate',
    summary: 'Delegate a node atomically: executor flag (h.md/a.md) plus autonomy.yml (owner: for a human) in one act.',
    input: {
      tasksDir: TASKS_DIR,
      taskPath: TASK_PATH,
      mode: { type: 'string', required: true, description: "Executor kind: 'human' or 'agent'." },
      owner: {
        type: 'string',
        required: false,
        description: 'Owner handle (required for human, forbidden meaning for agent).'
      },
      autonomyYaml: { type: 'string', required: false, description: 'Autonomy envelope lines `class: auto|approve`.' },
      qualification: { type: 'string', required: false, description: 'Required executor qualification (human).' }
    },
    tauri: 'delegate'
  },
  {
    tier: 'read',
    name: 'read_autonomy',
    summary: "Read a node's own autonomy policy (empty — no file, full inheritance from ancestors).",
    input: { tasksDir: TASKS_DIR, taskPath: TASK_PATH },
    tauri: 'read_autonomy'
  },
  {
    tier: 'write',
    name: 'write_autonomy',
    summary: "Write a node's own autonomy policy (autonomy.yml; validated fail-closed before write).",
    input: {
      tasksDir: TASKS_DIR,
      taskPath: TASK_PATH,
      yaml: {
        type: 'string',
        required: true,
        description: 'Flat `class: auto|approve` lines (own autonomy.js format).'
      }
    },
    tauri: 'write_autonomy'
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
