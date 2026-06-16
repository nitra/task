import { ref } from 'vue'

const PATHS_KEY = 'task:projectPaths'
const LAST_PROJECT_KEY = 'task:lastProject'

const projectPaths = ref(JSON.parse(localStorage.getItem(PATHS_KEY) || '[]'))
const lastProject = ref(localStorage.getItem(LAST_PROJECT_KEY) || '')

export function useProjectPaths() {
  function addProjectPath(path) {
    if (!path || projectPaths.value.includes(path)) return
    projectPaths.value = [...projectPaths.value, path]
    localStorage.setItem(PATHS_KEY, JSON.stringify(projectPaths.value))
  }

  function removeProjectPath(path) {
    projectPaths.value = projectPaths.value.filter(p => p !== path)
    localStorage.setItem(PATHS_KEY, JSON.stringify(projectPaths.value))
  }

  function setLastProject(value) {
    lastProject.value = value
    localStorage.setItem(LAST_PROJECT_KEY, value)
  }

  return { projectPaths, lastProject, addProjectPath, removeProjectPath, setLastProject }
}
