// Композабл вкладки «Довіряю» (M3): диспатчить `trust_show`/`mandate_narrow`/
// `mandate_widen_propose` — ті самі tools, що й CLI (`bin/delta.mjs`), тож
// обидві поверхні бачать однаковий зріз ШІ-мандатів з тих самих файлів
// (той самий інваріант, що `use-mandates.js`/`use-decisions.js`).

import { computed, ref } from 'vue'
import { dispatch } from '../tool/index.js'

/**
 * @returns {object} реактивний стан вкладки «Довіряю» + дії rescan/narrow/proposeWiden
 */
export function useTrust() {
  const identity = ref(null)
  const mandatesDir = ref(null)
  const generation = ref(null)
  const items = ref([])
  const loading = ref(false)
  const error = ref(null)
  const actionError = ref(null)
  const lastWidenProposal = ref(null)

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
   * Перечитує мої ШІ-мандати (`escalates_to === identity`) з трек-рекордом кожного.
   * @returns {Promise<void>}
   */
  async function rescan() {
    if (!mandatesDir.value) {
      generation.value = null
      items.value = []
      return
    }
    loading.value = true
    const res = await dispatch('trust_show', { mandatesDir: mandatesDir.value, handle: identity.value })
    loading.value = false
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    error.value = null
    generation.value = res.output.generation
    items.value = res.output.items
  }

  /**
   * Звужує один ШІ-мандат на один щабель — самопідпис, без квізу, миттєво
   * (mandates.md: звуження не потребує делегатора).
   * @param {string} ownerHandle owner мандата, що звужується
   * @returns {Promise<boolean>} true — застосовано
   */
  async function narrow(ownerHandle) {
    actionError.value = null
    const res = await dispatch('mandate_narrow', { mandatesDir: mandatesDir.value, ownerHandle })
    if (!res.ok) {
      actionError.value = res.error.message
      return false
    }
    if (!res.output.valid) {
      actionError.value = res.output.reason
      return false
    }
    await rescan()
    return true
  }

  /**
   * Драфтить розширення одного ШІ-мандата на один щабель і кладе
   * change-proposal decision-request у мою чергу «Вирішую» — «остання
   * константа»: далі ТІЛЬКИ звичайний квіз-гейт + людський підпис
   * (docs/specs/260809-delta-app.md, конституція п.4), ця дія mandates.yaml
   * НЕ чіпає напряму.
   * @param {string} ownerHandle owner мандата, що розширюється
   * @returns {Promise<object|null>} `{changeId, decisionRequestPath, ...}`, або null — помилка
   */
  async function proposeWiden(ownerHandle) {
    actionError.value = null
    const res = await dispatch('mandate_widen_propose', {
      mandatesDir: mandatesDir.value,
      ownerHandle,
      initiatedByHandle: identity.value
    })
    if (!res.ok) {
      actionError.value = res.error.message
      return null
    }
    lastWidenProposal.value = res.output
    return res.output
  }

  return {
    identity,
    mandatesDir,
    generation,
    items,
    loading,
    error,
    actionError,
    lastWidenProposal,
    configured,
    refreshConfig,
    rescan,
    narrow,
    proposeWiden
  }
}
