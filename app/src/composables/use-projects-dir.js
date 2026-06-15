// Remembers the user's "projects root" (the directory they browse from to pick a
// project) and the last project they created a task in, so the folder picker
// reopens where they left off. Persisted in localStorage; no FS access here.

const PROJECTS_DIR_KEY = 'task:projectsDir'
const LAST_PROJECT_KEY = 'task:lastProject'
const DEFAULT_PROJECTS_DIR = '/Users/vitalii/www/'

/**
 * @returns {{"projectsDir": import("vue").Ref<string>, "lastProject": import("vue").Ref<string>, "setProjectsDir": (value: string) => void, "setLastProject": (value: string) => void}} persisted projects-dir state and setters
 */
export function useProjectsDir() {
  const projectsDir = ref(localStorage.getItem(PROJECTS_DIR_KEY) || DEFAULT_PROJECTS_DIR)
  const lastProject = ref(localStorage.getItem(LAST_PROJECT_KEY) || '')

  /**
   * @param {string} value new projects root
   */
  function setProjectsDir(value) {
    projectsDir.value = value
    localStorage.setItem(PROJECTS_DIR_KEY, value)
  }

  /**
   * @param {string} value last project the user created a task in
   */
  function setLastProject(value) {
    lastProject.value = value
    localStorage.setItem(LAST_PROJECT_KEY, value)
  }

  return { projectsDir, lastProject, setProjectsDir, setLastProject }
}