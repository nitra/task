import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Node journal store for the MCP bin: spawns the Rust `journal` binary so the
// agent side persists requests through Rust too (FS-in-Rust). Same shape as the
// webview store (journal-store-tauri.js).

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Resolve the journal binary: env override, then the src-tauri build dirs.
 * @returns {string} absolute path
 */
function resolveJournalBin() {
  if (process.env.TASK_JOURNAL_BIN) return process.env.TASK_JOURNAL_BIN
  const candidates = [
    join(HERE, '../../src-tauri/target/release/journal'),
    join(HERE, '../../src-tauri/target/debug/journal')
  ]
  const found = candidates.find(path => existsSync(path))
  if (found) return found
  throw new Error('journal binary not found; run `cargo build --bin journal` in app/src-tauri or set TASK_JOURNAL_BIN')
}

/**
 * @param {{ requestsDir?: string }} [opts] optional requests-dir override (→ TASK_REQUESTS_DIR)
 * @returns {{ create: (r:object)=>string, load: (id:string)=>object, update: (id:string,patch:object)=>void }} journal store
 */
export function createNodeJournalStore({ requestsDir } = {}) {
  const bin = resolveJournalBin()
  const env = { ...process.env }
  if (requestsDir) env.TASK_REQUESTS_DIR = requestsDir

  const run = args => {
    const res = spawnSync(bin, args, { encoding: 'utf8', env })
    if (res.status !== 0) throw new Error(res.stderr?.trim() || `journal exited ${res.status}`)
    return res.stdout.trim() ? JSON.parse(res.stdout) : null
  }

  return {
    create: ({ intent, actor }) => run(['create', JSON.stringify({ intent, actor })]).id,
    load: id => run(['load', id]),
    update: (id, patch) => {
      run(['update', id, JSON.stringify(patch)])
    }
  }
}
