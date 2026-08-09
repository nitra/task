// Композабл вкладки «Незручна правда» (M6 UI-догон M5, docs/specs/
// 260809-delta-app.md, «Обсяг M6», п.1): диспатчить `candor_show`/
// `candor_mark_read` — той самий inbox `.mt/candor/{handle}.jsonl`, що CLI
// (`bin/delta.mjs`), ВІДДІЛЕНИЙ від черги «Вирішую» (конституція п.6).

import { computed, ref } from 'vue'
import { dispatch } from '../tool/index.js'

/**
 * @returns {object} реактивний стан вкладки «Незручна правда» + дія markRead
 */
export function useCandor() {
  const identity = ref(null)
  const mandatesDir = ref(null)
  const inbox = ref([])
  const loading = ref(false)
  const error = ref(null)

  const unreadCount = computed(() => inbox.value.filter(r => !r.read).length)

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
   * Перечитує мій inbox «незручна правда».
   * @returns {Promise<void>}
   */
  async function rescan() {
    if (!mandatesDir.value || !identity.value) {
      inbox.value = []
      return
    }
    loading.value = true
    const res = await dispatch('candor_show', { mandatesDir: mandatesDir.value, handle: identity.value })
    loading.value = false
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    error.value = null
    inbox.value = res.output
  }

  /**
   * Позначає один запис прочитаним — ЛОКАЛЬНО, цим пристроєм.
   * @param {string} id `id` кандор-запису
   * @returns {Promise<void>}
   */
  async function markRead(id) {
    const res = await dispatch('candor_mark_read', { id })
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    const entry = inbox.value.find(r => r.id === id)
    if (entry) entry.read = true
  }

  return { identity, mandatesDir, inbox, unreadCount, loading, error, refreshConfig, rescan, markRead }
}
