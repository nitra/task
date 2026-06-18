import { createDispatch } from '@7n/tauri-components'
import { tauriTransport } from '@7n/tauri-components/vue'
import { TOOLS } from './catalog.js'

// In-app entry to the tool surface for DIRECT (non-agent) UI calls — create /
// scan / delete from dialogs. Binds the shared dispatcher to this app's catalog
// and the Tauri transport. The in-app agent (useAgent) builds its own dispatch
// inside the kit; the orchestrator (bin/task.mjs) builds one with the CLI
// transport.

export const dispatch = createDispatch(TOOLS, tauriTransport)
