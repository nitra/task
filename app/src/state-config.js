// Single source of truth for task-state visuals (icon, accent color, label).
// Shared by TaskGraph summary chips and TaskNodeItem rows so the palette
// stays consistent across the whole view. Colors track the Apple-system
// accents defined in quasar-variables.sass.

export const STATE_CONFIG = {
  unassigned:    { icon: 'sym_o_person_off',             color: '#8e8e93', label: 'unassigned' },
  pending:       { icon: 'sym_o_schedule',               color: '#ff9f0a', label: 'pending' },
  human_pending: { icon: 'sym_o_schedule',               color: '#ff9f0a', label: 'human-pending' },
  waiting:       { icon: 'sym_o_radio_button_unchecked', color: '#98989d', label: 'waiting' },
  blocked:       { icon: 'sym_o_do_not_disturb_on',      color: '#ff6b35', label: 'blocked' },
  plan_review:   { icon: 'sym_o_rate_review',            color: '#64d2ff', label: 'plan-review' },
  spawned:       { icon: 'sym_o_account_tree',           color: '#30c8c0', label: 'spawned' },
  running:       { icon: 'sym_o_radio_button_checked',   color: '#0a84ff', label: 'running' },
  pending_audit: { icon: 'sym_o_pending',                color: '#5e5ce6', label: 'pending-audit' },
  resolved:      { icon: 'sym_o_check_circle',           color: '#30d158', label: 'resolved' },
  failed:        { icon: 'sym_o_cancel',                 color: '#ff453a', label: 'failed' },
  invalidated:   { icon: 'sym_o_block',                  color: '#636366', label: 'invalidated' },
  unresolvable:  { icon: 'sym_o_error',                  color: '#636366', label: 'unresolvable' },
}

export const FALLBACK_STATE = STATE_CONFIG.waiting

/**
 * Resolve the visual config for a task state, falling back to `waiting`.
 * @param {string} state task state key
 * @returns {{ icon: string, color: string, label: string }} visual config
 */
export function stateConfig(state) {
  return STATE_CONFIG[state] ?? FALLBACK_STATE
}
