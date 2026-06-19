const PATHS_KEY = 'task:projectPaths'
const LAST_PROJECT_KEY = 'task:lastProject'

// Read/write through a guarded localStorage so importing this module (which
// initializes the shared refs below at eval time) never crashes when there is no
// localStorage — e.g. under vitest before a test sets it up, or SSR.

/**
 * Read a localStorage value, or null when localStorage is unavailable.
 * @param {string} key storage key
 * @returns {string|null} stored value, or null
 */
function readStored(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  }
  catch {
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
  }
  catch {
    // no localStorage (tests / SSR) — in-memory ref state is still updated
  }
}

const projectPaths = ref(JSON.parse(readStored(PATHS_KEY) || '[]'))
const lastProject = ref(readStored(LAST_PROJECT_KEY) || '')

/**
 * Shared store of user-chosen project paths (persisted in localStorage).
 * @returns {{ projectPaths: import('vue').Ref<string[]>, lastProject: import('vue').Ref<string>, addProjectPath: (path: string) => void, removeProjectPath: (path: string) => void, setLastProject: (value: string) => void }} project-paths store
 */
export function useProjectPaths() {
  /**
   * Add a project path (deduped) and persist.
   * @param {string} path absolute project path
   */
  function addProjectPath(path) {
    if (!path || projectPaths.value.includes(path)) return
    projectPaths.value = [...projectPaths.value, path]
    writeStored(PATHS_KEY, JSON.stringify(projectPaths.value))
  }

  /**
   * Remove a project path and persist.
   * @param {string} path project path to remove
   */
  function removeProjectPath(path) {
    projectPaths.value = projectPaths.value.filter(p => p !== path)
    writeStored(PATHS_KEY, JSON.stringify(projectPaths.value))
  }

  /**
   * Record the last selected project and persist.
   * @param {string} value last project path
   */
  function setLastProject(value) {
    lastProject.value = value
    writeStored(LAST_PROJECT_KEY, value)
  }

  return { projectPaths, lastProject, addProjectPath, removeProjectPath, setLastProject }
}
