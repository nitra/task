import { invoke } from '@tauri-apps/api/core'
import { ref, watch } from 'vue'
import { useProjectPaths } from './use-project-paths.js'

const { projectPaths } = useProjectPaths()

const workspaces = ref([])
const loading = ref(false)
let loaded = false

watch(projectPaths, () => { loaded = false })

export function useProjectWorkspaces() {
  async function load() {
    if (loaded) return
    loading.value = true
    try {
      const entries = await invoke('list_projects_from_paths', { paths: projectPaths.value })
      workspaces.value = entries.map(e => ({ label: e.label, value: e.path }))
      loaded = true
    } catch (err) {
      console.error('list_projects_from_paths failed', err)
    }
    finally {
      loading.value = false
    }
  }

  function refresh() {
    loaded = false
    return load()
  }

  return { workspaces, loading, load, refresh }
}
