// Композабл карти мандатів (M0): читає конфіг (ідентичність, шлях до
// воркспейсу) і диспатчить `mandates_show` — той самий tool, що й CLI
// (bin/delta.mjs), тож обидві поверхні бачать однаковий результат з
// однакового `.mt/mandates.yaml`.

import { dispatch } from '../tool/index.js'

/**
 * @returns {object} реактивний стан карти мандатів + дії rescan/refreshConfig
 */
export function useMandates() {
  const identity = ref(null)
  const mandatesDir = ref(null)
  const mandates = ref([])
  const mine = ref([])
  const escalationChain = ref([])
  const models = ref([])
  const loading = ref(false)
  const error = ref(null)

  const configured = computed(() => Boolean(mandatesDir.value))

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
   * Перечитує `.mt/mandates.yaml` і деривує зріз поточної ідентичності.
   * Відсутній/порожній файл — порожній список, не помилка (empty state).
   * @returns {Promise<void>}
   */
  async function rescan() {
    if (!mandatesDir.value) {
      mandates.value = []
      mine.value = []
      escalationChain.value = []
      models.value = []
      return
    }
    loading.value = true
    const res = await dispatch('mandates_show', { mandatesDir: mandatesDir.value, handle: identity.value })
    loading.value = false
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    error.value = null
    mandates.value = res.output.mandates
    mine.value = res.output.mine
    escalationChain.value = res.output.escalationChain
    models.value = res.output.models
  }

  return {
    identity,
    mandatesDir,
    mandates,
    mine,
    escalationChain,
    models,
    loading,
    error,
    configured,
    refreshConfig,
    rescan
  }
}
