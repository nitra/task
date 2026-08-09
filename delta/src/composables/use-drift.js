// Композабл секції «Дрейф» на вкладці «Стежу» (M6 UI-догон M5, docs/specs/
// 260809-delta-app.md, «Обсяг M6», п.1): диспатчить `drift_show`/`drift_scan`
// (приватне дзеркало «мета vs комфорт», `src/drift.js`) і додає GUI-шлях
// делегування одним квізом (`delegation_quiz`/`decision_delegate`,
// `src/delegation.js`) — та сама модель вибору, що CLI-демо M5, лише з
// картки дрейфу замість ручного виклику.

import { computed, ref } from 'vue'
import { dispatch } from '../tool/index.js'

/**
 * Моделі МОГО делегатора (`escalates_to === identity`), чий scope покриває
 * `decisionType` — дзеркалить `delegation.js: findEligibleModel` над уже
 * завантаженою картою мандатів (composable не імпортує серверний модуль
 * напряму — той самий інваріант, що решта `use-*`: лише `dispatch`).
 * @param {object[]} models усі ШІ-мандати карти (`mandates_show().models`)
 * @param {string} decisionType клас рішень дрейф-картки
 * @param {string} identity мій handle
 * @returns {object|null} перший придатний мандат моделі, або null
 */
function eligibleModelFor(models, decisionType, identity) {
  const mine = models.filter(m => m.escalatesTo === identity)
  return mine.find(m => m.scope.decisionTypes.includes(decisionType) || m.scope.decisionTypes.includes('*')) ?? null
}

/**
 * @returns {object} реактивний стан секції «Дрейф» + дії rescan/startDelegate/submitDelegate
 */
export function useDrift() {
  const identity = ref(null)
  const mandatesDir = ref(null)
  const cards = ref([])
  const models = ref([])
  const loading = ref(false)
  const scanning = ref(false)
  const error = ref(null)
  // key = `${runId}/${nnnn}` -> {modelHandle, quizPath, question, options, delegated}
  const delegateState = ref({})

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
   * Перечитує ШІ-мандати карти (для добору моделі під делегування).
   * @returns {Promise<void>}
   */
  async function loadModels() {
    if (!mandatesDir.value) return
    const res = await dispatch('mandates_show', { mandatesDir: mandatesDir.value, handle: identity.value })
    models.value = res.ok ? res.output.models : []
  }

  /**
   * Читає останній збережений локальний скан дрейфу (без перерахунку).
   * @returns {Promise<void>}
   */
  async function rescan() {
    if (!mandatesDir.value || !identity.value) {
      cards.value = []
      return
    }
    loading.value = true
    const [driftRes] = await Promise.all([dispatch('drift_show', {}), loadModels()])
    loading.value = false
    if (!driftRes.ok) {
      error.value = driftRes.error.message
      return
    }
    error.value = null
    cards.value = driftRes.output
    delegateState.value = {}
  }

  /**
   * Перераховує дрейф-картки заново (`drift_scan` — перезаписує локальний файл).
   * @returns {Promise<void>}
   */
  async function runScan() {
    if (!mandatesDir.value || !identity.value) return
    scanning.value = true
    const res = await dispatch('drift_scan', { mandatesDir: mandatesDir.value, handle: identity.value })
    scanning.value = false
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    error.value = null
    cards.value = res.output
    delegateState.value = {}
  }

  /**
   * @param {string} decisionType клас рішень дрейф-картки
   * @returns {object|null} придатна моя модель, або null — немає покриття
   */
  function eligibleModel(decisionType) {
    return eligibleModelFor(models.value, decisionType, identity.value)
  }

  /**
   * Запускає one-tap квіз делегування для одного item-а дрейф-картки —
   * генерує/показує ЄДИНЕ детерміноване мета-питання (`delegation.js`).
   * @param {{runId: string, nnnn: string}} item item дрейф-картки
   * @param {string} modelHandle handle обраної моделі
   * @returns {Promise<void>}
   */
  async function startDelegate(item, modelHandle) {
    const key = `${item.runId}/${item.nnnn}`
    const res = await dispatch('delegation_quiz', {
      mandatesDir: mandatesDir.value,
      runId: item.runId,
      nnnn: item.nnnn,
      modelHandle
    })
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    error.value = null
    delegateState.value = {
      ...delegateState.value,
      [key]: { modelHandle, question: res.output.question, options: res.output.options, delegated: false }
    }
  }

  /**
   * Подає відповідь мета-квізу — правильна відповідь підписує й пише
   * `NNNN-delegation.json`, картка позначається делегованою (delegatedTo).
   * @param {{runId: string, nnnn: string}} item item дрейф-картки
   * @param {number} answerIndex 0-based індекс обраного варіанта
   * @returns {Promise<boolean>} true — делеговано
   */
  async function submitDelegate(item, answerIndex) {
    const key = `${item.runId}/${item.nnnn}`
    const state = delegateState.value[key]
    if (!state) return false
    const res = await dispatch('decision_delegate', {
      mandatesDir: mandatesDir.value,
      runId: item.runId,
      nnnn: item.nnnn,
      modelHandle: state.modelHandle,
      delegatedByHandle: identity.value,
      answer: answerIndex
    })
    if (!res.ok) {
      error.value = res.error.message
      return false
    }
    if (!res.output.delegated) {
      // Невірна відповідь — новий квіз-текст уже дописано у файл, показуємо оновлене питання/спробу.
      delegateState.value = { ...delegateState.value, [key]: { ...state, iterations: res.output.iterations } }
      return false
    }
    delegateState.value = { ...delegateState.value, [key]: { ...state, delegated: true } }
    return true
  }

  const hasCards = computed(() => cards.value.some(c => c.count > 0))

  return {
    identity,
    mandatesDir,
    cards,
    hasCards,
    models,
    loading,
    scanning,
    error,
    delegateState,
    refreshConfig,
    rescan,
    runScan,
    eligibleModel,
    startDelegate,
    submitDelegate
  }
}
