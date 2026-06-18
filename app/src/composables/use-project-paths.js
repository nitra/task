import { ref } from 'vue'

const PATHS_KEY = 'task:projectPaths'
const LAST_PROJECT_KEY = 'task:lastProject'

// Read/write through a guarded localStorage so importing this module (which
// initializes the shared refs below at eval time) never crashes when there is no
// localStorage — e.g. under vitest before a test sets it up, or SSR.
function readStored(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  }
  catch {
    return null
  }
}

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

export function useProjectPaths() {
  function addProjectPath(path) {
    if (!path || projectPaths.value.includes(path)) return
    projectPaths.value = [...projectPaths.value, path]
    writeStored(PATHS_KEY, JSON.stringify(projectPaths.value))
  }

  function removeProjectPath(path) {
    projectPaths.value = projectPaths.value.filter(p => p !== path)
    writeStored(PATHS_KEY, JSON.stringify(projectPaths.value))
  }

  function setLastProject(value) {
    lastProject.value = value
    writeStored(LAST_PROJECT_KEY, value)
  }

  return { projectPaths, lastProject, addProjectPath, removeProjectPath, setLastProject }
}
