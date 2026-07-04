// Version chain вузла (вивід node_artifacts): візуальна конфігурація
// артефактів і секціонування для timeline. Чисті функції — рендер у
// компонентах (ArtifactChain).

const KIND_CONFIG = {
  task: { icon: 'sym_o_description', color: '#8e8e93', label: 'task' },
  plan: { icon: 'sym_o_architecture', color: '#64d2ff', label: 'plan' },
  'plan-approved': { icon: 'sym_o_thumb_up', color: '#30d158', label: 'plan approved' },
  'plan-rejected': { icon: 'sym_o_thumb_down', color: '#ff453a', label: 'plan rejected' },
  run: { icon: 'sym_o_play_circle', color: '#0a84ff', label: 'run' },
  fact: { icon: 'sym_o_task_alt', color: '#30d158', label: 'fact' },
  'pending-audit': { icon: 'sym_o_pending', color: '#5e5ce6', label: 'pending audit' },
  'audit-result': { icon: 'sym_o_verified', color: '#5e5ce6', label: 'audit result' },
  clarification: { icon: 'sym_o_contact_support', color: '#ff9f0a', label: 'clarification' },
  amended: { icon: 'sym_o_edit_note', color: '#ff9f0a', label: 'amended' },
  unresolvable: { icon: 'sym_o_error', color: '#636366', label: 'unresolvable' },
  'run-summary': { icon: 'sym_o_summarize', color: '#8e8e93', label: 'run summary' }
}

// Failure-сімейство run result (спека mt.md): усе ≠ success, крім decomposed.
const FAILURE_RESULTS = new Set(['failed', 'progress-timeout', 'budget-exceeded', 'claim-lost', 'merge-conflict'])

/**
 * Візуальна конфігурація артефакта; result перекриває базовий колір
 * (failure-сімейство → червоний, decomposed → бірюзовий spawned).
 * @param {{ kind: string, result?: string|null }} artifact артефакт вузла
 * @returns {{ icon: string, color: string, label: string }} візуальна конфігурація
 */
export function artifactConfig(artifact) {
  const base = KIND_CONFIG[artifact.kind] ?? KIND_CONFIG.task
  if (artifact.result && FAILURE_RESULTS.has(artifact.result)) return { ...base, color: '#ff453a' }
  if (artifact.result === 'decomposed') return { ...base, color: '#30c8c0' }
  return base
}

/**
 * Розбиває впорядкований (бекендом) список артефактів на секції timeline:
 * `mission` (task.md) → `attempt NNN` → `terminal` (unresolvable/run-summary).
 * @param {Array<{ file: string, kind: string, nnn?: number|null }>} artifacts вивід node_artifacts
 * @returns {Array<{ key: string, items: object[] }>} секції у порядку chain
 */
export function chainSections(artifacts) {
  const sections = []
  for (const artifact of artifacts) {
    let key = 'terminal'
    if (artifact.kind === 'task') key = 'mission'
    else if (artifact.nnn !== null && artifact.nnn !== undefined)
      key = `attempt ${String(artifact.nnn).padStart(3, '0')}`
    const last = sections.at(-1)
    if (last?.key === key) last.items.push(artifact)
    else sections.push({ key, items: [artifact] })
  }
  return sections
}
