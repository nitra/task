// Deprecated: superseded by use-project-paths.js (list of paths instead of single root).
import { useProjectPaths } from './use-project-paths.js'

export function useProjectsDir() {
  const { projectPaths, lastProject, addProjectPath, setLastProject } = useProjectPaths()
  return { projectsDir: projectPaths, lastProject, setProjectsDir: addProjectPath, setLastProject }
}
