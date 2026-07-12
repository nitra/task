import { invoke } from '@tauri-apps/api/core'

const LAST_PROJECT_KEY = 'task:lastProject'

// project_paths are the single source of truth, persisted by Rust in
// appLocalDataDir/config.json (default ~/www) so the GUI, the in-app agent and
// the node MCP bin all read the SAME roots. lastProject stays UI-only
// (localStorage) — it's a convenience, not shared with the agent.

/**
 * Read a localStorage value, or null when localStorage is unavailable.
 * @param {string} key storage key
 * @returns {string|null} stored value, or null
 */
function readStored(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/**
 * Write a localStorage value; no-op when localStorage is unavailable.
 * @param {string} key storage key
 * @param {string} value value to store
 */
function writeStored(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // no localStorage (tests / SSR) — in-memory ref state is still updated
  }
}

const projectPaths = ref([])
const lastProject = ref(readStored(LAST_PROJECT_KEY) || '')
let pathsLoaded = false

/**
 * Shared store of the user's project search paths (Rust config, default ~/www).
 * @returns {{ projectPaths: import('vue').Ref<string[]>, lastProject: import('vue').Ref<string>, loadPaths: () => Promise<void>, addProjectPath: (path: string) => void, removeProjectPath: (path: string) => void, setLastProject: (value: string) => void }} project-paths store
 */
export function useProjectPaths() {
  /**
   * Load project paths from the Rust config (once; no-op outside Tauri).
   * @returns {Promise<void>}
   */
  async function loadPaths() {
    if (pathsLoaded) return
    try {
      projectPaths.value = await invoke('get_project_paths')
      pathsLoaded = true
    } catch {
      // not under Tauri (tests) — keep in-memory state
    }
  }

  /**
   * Persist the current paths to the Rust config (fire-and-forget).
   */
  async function persist() {
    try {
      await invoke('set_project_paths', { paths: projectPaths.value })
    } catch {
      // best-effort; not under Tauri (tests) or transient FS error
    }
  }

  /**
   * Add a project path (deduped) and persist.
   * @param {string} path absolute project path
   */
  function addProjectPath(path) {
    if (!path || projectPaths.value.includes(path)) return
    projectPaths.value = [...projectPaths.value, path]
    persist()
  }

  /**
   * Remove a project path and persist.
   * @param {string} path project path to remove
   */
  function removeProjectPath(path) {
    projectPaths.value = projectPaths.value.filter(p => p !== path)
    persist()
  }

  /**
   * Record the last selected project (UI convenience, localStorage).
   * @param {string} value last project path
   */
  function setLastProject(value) {
    lastProject.value = value
    writeStored(LAST_PROJECT_KEY, value)
  }

  return { projectPaths, lastProject, loadPaths, addProjectPath, removeProjectPath, setLastProject }
}
