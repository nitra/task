import { createDispatch } from './dispatch.js'
import { tauriTransport } from './transports.js'

// In-app entry to the tool surface. The UI and the in-app LLM runner share this
// single dispatch instance (Tauri transport). The orchestrator builds its own
// dispatch with the CLI transport in bin/task.mjs.

export const dispatch = createDispatch(tauriTransport)
export { listTools, toolManifest } from './manifest.js'
