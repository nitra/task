#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createDispatch, listTools, toolManifest } from '@7n/tauri-components'
import { TOOLS } from '../src/tool/catalog.js'

// Headless entry for script orchestrators (n-tool-surface): no human-facing
// verbs/flags — just `task <tool> '<json>'`, `task schema`, `task list`. Same
// tool catalog as the UI; the only difference is the transport (per-verb spawn
// of the mt-scanner binary). Output is the uniform envelope as JSON on stdout.
//
// `agent`/`mcp` (conversational one-shot + MCP-server mode) were removed
// along with @7n/tauri-components' createAgentKit/createOpenAiChat/runAgent
// (0.11.0 — the package's sole agent engine is now ACP-based useAcpAgent(),
// which drives its session through Tauri invoke() and so can only run inside
// the app's webview, not headless). Use the in-app "Agent"/"Journal" dialogs
// instead; there is no drop-in headless replacement — see @7n/tauri-components
// npm/SPEC.md if you need to build one (e.g. a standalone ACP client binary).

const BIN_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * Resolve the mt-scanner binary: env override, then dev build dirs.
 * @returns {string} absolute path to the binary
 */
function resolveScannerBin() {
  if (process.env.MT_SCANNER_BIN) return process.env.MT_SCANNER_BIN
  const candidates = [
    // mt is a cargo workspace → binary lands in the workspace target dir
    join(BIN_DIR, '../../../mt/target/release/mt-scanner'),
    join(BIN_DIR, '../../../mt/target/debug/mt-scanner'),
    // fallback: standalone (non-workspace) layout
    join(BIN_DIR, '../../../mt/scanner/target/release/mt-scanner'),
    join(BIN_DIR, '../../../mt/scanner/target/debug/mt-scanner')
  ]
  const found = candidates.find(path => existsSync(path))
  if (found) return found
  throw new Error('mt-scanner not found; set MT_SCANNER_BIN or run `cargo build --release` in mt/scanner')
}

/**
 * The user's configured project paths (single source, written by the GUI/Rust);
 * defaults to ~/www. Lets the MCP agent ground against the SAME roots as the human.
 * @returns {string[]} project paths
 */
function readProjectPaths() {
  try {
    const cfg = join(process.env.HOME ?? '', 'Library/Application Support/com.nitra.task/config.json')
    const paths = JSON.parse(readFileSync(cfg, 'utf8')).project_paths
    if (Array.isArray(paths) && paths.length) return paths
  } catch {
    // no config yet — fall through to default
  }
  const www = join(process.env.HOME ?? '', 'www')
  return existsSync(www) ? [www] : []
}

/**
 * CLI transport: spawn mt-scanner per tool, parse JSON stdout. `workspaces`
 * scans the configured project paths (multi-root); others use `tool.cli`.
 * @param {object} tool tool definition (uses `tool.name` / `tool.cli`)
 * @param {object} input tool input
 * @returns {unknown} parsed JSON output (or null when empty)
 */
function cliTransport(tool, input) {
  // workspaces scans the configured project paths (multi-root) — same source as
  // the GUI; scan/create take an absolute tasksDir so they need no cwd.
  const argv = tool.name === 'workspaces' ? ['workspaces', ...readProjectPaths()] : tool.cli(input)
  const result = spawnSync(resolveScannerBin(), argv, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `mt-scanner exited ${result.status}`)
  return result.stdout.trim() ? JSON.parse(result.stdout) : null
}

const dispatch = createDispatch(TOOLS, cliTransport)

/**
 * @returns {Promise<number>} process exit code
 */
async function main() {
  const [cmd, payload] = process.argv.slice(2)

  if (!cmd || cmd === 'list') {
    process.stdout.write(`${JSON.stringify(listTools(TOOLS), null, 2)}\n`)
    return 0
  }
  if (cmd === 'schema') {
    process.stdout.write(`${JSON.stringify(toolManifest(TOOLS), null, 2)}\n`)
    return 0
  }

  if (cmd === 'agent' || cmd === 'mcp') {
    process.stderr.write(
      `\`task ${cmd}\` was removed — @7n/tauri-components dropped createAgentKit/createOpenAiChat/runAgent in 0.11.0 in favor of ACP-based useAcpAgent(), which drives its session through Tauri invoke() and only runs inside the app's own webview.\n` +
        'Use the in-app "Agent"/"Journal" dialogs instead.\n'
    )
    return 2
  }

  let input = {}
  if (payload) {
    try {
      input = JSON.parse(payload)
    } catch {
      process.stderr.write(`Invalid JSON input: ${payload}\n`)
      return 2
    }
  }

  const envelope = await dispatch(cmd, input)
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`)
  return envelope.ok ? 0 : 2
}

try {
  const code = await main()
  // null = long-running mode (MCP server) — let the process live on its own handles.
  if (code !== null) process.exit(code)
} catch (error) {
  process.stderr.write(`${String(error?.message ?? error)}\n`)
  process.exit(1)
}
