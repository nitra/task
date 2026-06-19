import { invoke } from '@tauri-apps/api/core'
import { useProjectPaths } from './use-project-paths.js'

const { projectPaths } = useProjectPaths()

const workspaces = ref([])
const loading = ref(false)
let loaded = false

watch(projectPaths, () => { loaded = false })

/**
 * Shared store of mt workspaces discovered from the user's project paths.
 * @returns {{ workspaces: import('vue').Ref<{label: string, value: string}[]>, loading: import('vue').Ref<boolean>, load: () => Promise<void>, refresh: () => Promise<void> }} workspaces store
 */
export function useProjectWorkspaces() {
  /**
   * Load workspaces from the project paths (once; cached until paths change).
   * @returns {Promise<void>}
   */
  async function load() {
    if (loaded) return
    loading.value = true
    try {
      const entries = await invoke('list_projects_from_paths', { paths: projectPaths.value })
      workspaces.value = entries.map(e => ({ label: e.label, value: e.path }))
      loaded = true
    } catch (error) {
      console.error('list_projects_from_paths failed', error)
    }
    finally {
      loading.value = false
    }
  }

  /**
   * Force a reload of the workspaces.
   * @returns {Promise<void>}
   */
  function refresh() {
    loaded = false
    return load()
  }

  return { workspaces, loading, load, refresh }
}
