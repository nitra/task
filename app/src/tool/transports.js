import { invoke } from '@tauri-apps/api/core'

// UI transport: route a tool call to its Tauri command. Input keys map 1:1 to
// the command's args (already camelCase, e.g. tasksDir). The orchestrator's
// CLI transport (spawn mt-scanner) lives in bin/task.mjs, off the UI path.

/**
 * @param {object} tool tool definition (uses `tool.tauri`)
 * @param {object} input tool input, forwarded as command args
 * @returns {Promise<unknown>} the command result
 */
export function tauriTransport(tool, input) {
  return invoke(tool.tauri, input)
}
