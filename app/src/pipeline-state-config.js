// Single source of truth for CI run-status visuals (icon, accent color, label).
// Analog of state-config.js for pipeline/workflow runs (GitHub Actions +
// Azure Pipelines, normalized to the same `conclusion`/`status` vocabulary
// by the Rust backend). Colors reuse the exact accents already used for
// resolved/failed/running task states so red/green/blue read consistently.
export const PIPELINE_STATE_CONFIG = {
  success: { icon: 'sym_o_check_circle', color: '#30d158', label: 'success' },
  failure: { icon: 'sym_o_cancel', color: '#ff453a', label: 'failed' },
  cancelled: { icon: 'sym_o_do_not_disturb_on', color: '#8e8e93', label: 'cancelled' },
  skipped: { icon: 'sym_o_redo', color: '#98989d', label: 'skipped' },
  in_progress: { icon: 'sym_o_radio_button_checked', color: '#0a84ff', label: 'running' },
  queued: { icon: 'sym_o_schedule', color: '#ff9f0a', label: 'queued' },
  no_runs: { icon: 'sym_o_radio_button_unchecked', color: '#636366', label: 'no runs' }
}

export const FALLBACK_PIPELINE_STATE = PIPELINE_STATE_CONFIG.no_runs

/**
 * Resolve the visual config for a pipeline run, preferring `conclusion` (the
 * terminal result) and falling back to in-flight `status`.
 * @param {string} status raw status (e.g. 'completed', 'in_progress', 'no_runs')
 * @param {string|null} [conclusion] terminal conclusion (e.g. 'success', 'failure')
 * @returns {{ icon: string, color: string, label: string }} visual config
 */
export function pipelineStateConfig(status, conclusion) {
  const key = conclusion ?? status
  return PIPELINE_STATE_CONFIG[key] ?? FALLBACK_PIPELINE_STATE
}
