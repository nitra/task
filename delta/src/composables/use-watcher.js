// Композабл вкладки «Стежу» (M4): нотифікації watcher-а
// (`notifications_show`), ручний прогін (`watcher_scan`), тиха година
// (`quiet_hours`/`set_quiet_hours`) і профспілковий агрегатор
// (`what_system_knows`, конституція п.9) — ті самі tools, що й CLI/headless
// `bin/delta-watcher.mjs`, тож усі поверхні бачать той самий
// `.mt/notifications/{handle}.jsonl`.

import { dispatch } from '../tool/index.js'

/**
 * @returns {object} реактивний стан вкладки «Стежу» + дії rescan/runScan/saveQuietHours
 */
export function useWatcher() {
  const identity = ref(null)
  const mandatesDir = ref(null)
  const notifications = ref([])
  const quietHours = ref(null)
  const whatSystemKnows = ref(null)
  const loading = ref(false)
  const scanning = ref(false)
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
   * Перечитує мій лог нотифікацій, тиху годину й профспілковий зріз.
   * @returns {Promise<void>}
   */
  async function rescan() {
    if (!mandatesDir.value || !identity.value) {
      notifications.value = []
      whatSystemKnows.value = null
      return
    }
    loading.value = true
    const [notificationsRes, quietHoursRes, knowsRes] = await Promise.all([
      dispatch('notifications_show', { mandatesDir: mandatesDir.value, handle: identity.value }),
      dispatch('quiet_hours', {}),
      dispatch('what_system_knows', { mandatesDir: mandatesDir.value, handle: identity.value })
    ])
    loading.value = false
    error.value = notificationsRes.ok ? null : notificationsRes.error.message
    notifications.value = notificationsRes.ok ? notificationsRes.output : []
    quietHours.value = quietHoursRes.ok ? quietHoursRes.output : null
    whatSystemKnows.value = knowsRes.ok ? knowsRes.output : null
  }

  /**
   * Ручний прогін watcher-а (той самий `runWatcherScan`, що крон
   * `bin/delta-watcher.mjs`) — пінгує виконавців/ескалює власникам за
   * SLA/grace, дописує нотифікації в лог; після прогону перечитує стан.
   * @returns {Promise<void>}
   */
  async function runScan() {
    if (!mandatesDir.value) return
    scanning.value = true
    const res = await dispatch('watcher_scan', { mandatesDir: mandatesDir.value })
    scanning.value = false
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    error.value = null
    await rescan()
  }

  /**
   * Зберігає вікно тихої години пристрою.
   * @param {string} start "HH:MM"
   * @param {string} end "HH:MM"
   * @returns {Promise<void>}
   */
  async function saveQuietHours(start, end) {
    const res = await dispatch('set_quiet_hours', { start, end })
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    quietHours.value = { start, end }
  }

  return {
    identity,
    mandatesDir,
    notifications,
    quietHours,
    whatSystemKnows,
    loading,
    scanning,
    error,
    refreshConfig,
    rescan,
    runScan,
    saveQuietHours
  }
}
