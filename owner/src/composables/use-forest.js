import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { diffForest, readSnapshot, snapshotForest, writeSnapshot } from '../delta.js'
import { deriveScopes } from '../scope.js'
import { dispatch } from '../tool/index.js'

// Спільний стан лісу задач власника: воркспейси + дерева вузлів + дельта
// проти знімка минулого візиту. Baseline фіксується на першому завантаженні
// сесії — refresh порівнює з ним, а не з щойно записаним знімком, тож дельта
// не «зʼїдає» сама себе посеред сесії.
// M5: ліс доповнюється owner:-розміткою (scan_owners) та ідентичністю
// (whoami) — з них деривуються скоупи, що фільтрують чергу/задачі/дельту.

const workspaces = ref([])
const forest = ref({})
const loading = ref(false)
const delta = ref([])
const identity = ref(null)
const scopes = ref({})
const owners = ref({})
const escalations = ref({})
// M7: активні snooze нагадувань (персональний ритм — локально, не в git).
const snoozes = ref({})

let baseline = null
let watching = false
let debounceTimer = null

/**
 * Лишає у дельті лише мої новини: мій скоуп, межі контрактів (стан
 * делегованого вузла — новина замовника) і «нічию землю».
 * @param {Array<{ workspace: string, path: string }>} rows рядки дельти
 * @param {Record<string, { classify: (path: string) => string }>} scopeByWs скоуп за шляхом воркспейсу
 * @returns {Array<object>} відфільтровані рядки
 */
function scopeDelta(rows, scopeByWs) {
  return rows.filter(row => {
    const cls = scopeByWs[row.workspace]?.classify(row.path) ?? 'mine'
    return cls !== 'foreign'
  })
}

/**
 * Сканує всі воркспейси лісу через tool-поверхню і оновлює дельту.
 * @returns {Promise<void>}
 */
async function rescan() {
  loading.value = true
  try {
    const found = await dispatch('workspaces')
    if (!found.ok) throw new Error(found.error.message)
    workspaces.value = found.output.map(w => ({ label: w.label, path: w.path }))

    const me = await dispatch('whoami')
    identity.value = me.ok ? (me.output ?? null) : null

    const silenced = await dispatch('snoozes')
    snoozes.value = silenced.ok ? (silenced.output ?? {}) : {}

    const trees = {}
    const ownersByWs = {}
    const escalationsByWs = {}
    for (const workspace of workspaces.value) {
      const scanned = await dispatch('scan', { tasksDir: workspace.path })
      trees[workspace.path] = scanned.ok ? scanned.output : []
      const marked = await dispatch('scan_owners', { tasksDir: workspace.path })
      ownersByWs[workspace.path] = marked.ok ? marked.output : {}
      const raised = await dispatch('scan_escalations', { tasksDir: workspace.path })
      escalationsByWs[workspace.path] = raised.ok ? raised.output : {}
    }
    forest.value = trees
    owners.value = ownersByWs
    escalations.value = escalationsByWs
    scopes.value = deriveScopes(ownersByWs, identity.value)

    const current = snapshotForest(trees)
    baseline ??= readSnapshot() ?? current
    delta.value = scopeDelta(diffForest(baseline, current), scopes.value)
    writeSnapshot(current)
  } catch (error) {
    console.error('forest rescan failed', error)
  } finally {
    loading.value = false
  }
}

/**
 * Вмикає FS-watcher tasks-директорій (інфраструктурна підписка, не tool):
 * подія mt-changed → дебаунс → rescan.
 * @returns {Promise<void>}
 */
async function watchForest() {
  if (watching) return
  watching = true
  try {
    await invoke('watch_tasks_dirs', { dirs: workspaces.value.map(w => w.path) })
    await listen('mt-changed', () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(rescan, 500)
    })
  } catch {
    // не під Tauri (тести) — живемо без live-оновлень
  }
}

/**
 * Спільне сховище лісу задач для owner-екранів.
 * @returns {{ workspaces: import('vue').Ref<{label: string, path: string}[]>, forest: import('vue').Ref<Record<string, object[]>>, delta: import('vue').Ref<object[]>, loading: import('vue').Ref<boolean>, identity: import('vue').Ref<string|null>, scopes: import('vue').Ref<Record<string, object>>, owners: import('vue').Ref<Record<string, Record<string, string>>>, escalations: import('vue').Ref<Record<string, Record<string, object[]>>>, snoozes: import('vue').Ref<Record<string, string>>, rescan: () => Promise<void>, watchForest: () => Promise<void> }} стан і дії лісу
 */
export function useForest() {
  return { workspaces, forest, delta, loading, identity, scopes, owners, escalations, snoozes, rescan, watchForest }
}
