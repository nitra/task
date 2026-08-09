// Композабл вкладки «Знання» (M2): диспатчить `knowledge_show` — той самий
// tool, що й CLI (`bin/delta.mjs knowledge_show`), тож обидві поверхні
// бачать однаковий конспект/тренд з однакової особистої бази знань
// (поза git — «що про мене знає система» бачить лише власник, п.9 конституції).

import { ref } from 'vue'
import { dispatch } from '../tool/index.js'

/**
 * @returns {object} реактивний стан вкладки «Знання» + дія rescan
 */
export function useKnowledge() {
  const digest = ref([])
  const trend = ref([])
  const entryCount = ref(0)
  const loading = ref(false)
  const error = ref(null)

  /**
   * Перечитує особисту базу знань (`knowledge.json`, поза git).
   * @returns {Promise<void>}
   */
  async function rescan() {
    loading.value = true
    const res = await dispatch('knowledge_show', {})
    loading.value = false
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    error.value = null
    digest.value = res.output.digest
    trend.value = res.output.trend
    entryCount.value = res.output.entryCount
  }

  return { digest, trend, entryCount, loading, error, rescan }
}
