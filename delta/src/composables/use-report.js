// Композабл вкладки «Звіт» (M6, docs/specs/260809-delta-app.md, «Обсяг
// M6», п.2): диспатчить `delta_report` (`src/report.js`) — детермінований
// дельта-звіт директору, той самий tool-шар, що CLI (`bin/delta.mjs`).

import { ref } from 'vue'
import { dispatch } from '../tool/index.js'

/**
 * @returns {object} реактивний стан вкладки «Звіт» + дія generate
 */
export function useReport() {
  const identity = ref(null)
  const mandatesDir = ref(null)
  const report = ref(null)
  const loading = ref(false)
  const error = ref(null)
  const periodDays = ref(7)

  /**
   * Перечитує конфіг (ідентичність + шлях воркспейсу) з бекенду.
   * @returns {Promise<void>}
   */
  async function refreshConfig() {
    const [identityRes, dirRes] = await Promise.all([dispatch('whoami'), dispatch('mandates_dir')])
    identity.value = identityRes.ok ? (identityRes.output ?? null) : null
    mandatesDir.value = dirRes.ok ? (dirRes.output ?? null) : null
  }

  /**
   * Генерує (і перезаписує `.mt/reports/YYYY-MM-DD-delta.md`) дельта-звіт
   * за вікно `periodDays.value`.
   * @returns {Promise<void>}
   */
  async function generate() {
    if (!mandatesDir.value) return
    loading.value = true
    const res = await dispatch('delta_report', { mandatesDir: mandatesDir.value, periodDays: periodDays.value })
    loading.value = false
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    error.value = null
    report.value = res.output
  }

  return { identity, mandatesDir, report, loading, error, periodDays, refreshConfig, generate }
}
