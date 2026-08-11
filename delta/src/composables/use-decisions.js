// Композабл черги «Вирішую» (M1): читає конфіг (ідентичність, шлях до
// воркспейсу) і диспатчить `decisions_show` — той самий tool, що й CLI
// (bin/delta.mjs decisions_show), тож обидві поверхні бачать однакову чергу
// з однакового `runs/*/decisions/`.

import { dispatch } from '../tool/index.js'

/**
 * @returns {object} реактивний стан черги «Вирішую» + дії rescan/refreshConfig
 */
export function useDecisions() {
  const identity = ref(null)
  const mandatesDir = ref(null)
  const queue = ref([])
  const loading = ref(false)
  const error = ref(null)

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
   * Перечитує `runs/{run-id}/decisions/` для кожного run-а й деривує чергу поточної ідентичності.
   * Без ідентичності/шляху — порожня черга, не помилка.
   * @returns {Promise<void>}
   */
  async function rescan() {
    if (!mandatesDir.value || !identity.value) {
      queue.value = []
      return
    }
    loading.value = true
    const res = await dispatch('decisions_show', { mandatesDir: mandatesDir.value, handle: identity.value })
    loading.value = false
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    error.value = null
    queue.value = res.output
  }

  /**
   * Прибирає з локальної черги щойно підписану розвилку (без повного rescan) —
   * миттєвий відгук UI на approval, реальний стан і так у файлі на диску.
   * @param {string} runId run-id закритої розвилки
   * @param {string} nnnn номер закритої розвилки
   * @returns {void}
   */
  function removeFromQueue(runId, nnnn) {
    queue.value = queue.value.filter(item => !(item.runId === runId && item.nnnn === nnnn))
  }

  return { identity, mandatesDir, queue, loading, error, refreshConfig, rescan, removeFromQueue }
}
