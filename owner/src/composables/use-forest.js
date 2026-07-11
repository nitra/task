import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { diffForest, readSnapshot, snapshotForest, writeSnapshot } from '../delta.js'
import { dispatch } from '../tool/index.js'

// Спільний стан лісу задач власника: воркспейси + дерева вузлів + дельта
// проти знімка минулого візиту. Baseline фіксується на першому завантаженні
// сесії — refresh порівнює з ним, а не з щойно записаним знімком, тож дельта
// не «зʼїдає» сама себе посеред сесії.

const workspaces = ref([])
const forest = ref({})
const loading = ref(false)
const delta = ref([])

let baseline = null
let watching = false
let debounceTimer = null

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

    const trees = {}
    for (const workspace of workspaces.value) {
      const scanned = await dispatch('scan', { tasksDir: workspace.path })
      trees[workspace.path] = scanned.ok ? scanned.output : []
    }
    forest.value = trees

    const current = snapshotForest(trees)
    baseline ??= readSnapshot() ?? current
    delta.value = diffForest(baseline, current)
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
 * @returns {{ workspaces: import('vue').Ref<{label: string, path: string}[]>, forest: import('vue').Ref<Record<string, object[]>>, delta: import('vue').Ref<object[]>, loading: import('vue').Ref<boolean>, rescan: () => Promise<void>, watchForest: () => Promise<void> }} стан і дії лісу
 */
export function useForest() {
  return { workspaces, forest, delta, loading, rescan, watchForest }
}
