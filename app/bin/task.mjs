#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createDispatch } from '../src/tool/dispatch.js'
import { createOpenAiChat, runAgent } from '../src/tool/llm.js'
import { listTools, toolManifest } from '../src/tool/manifest.js'

// Headless entry for script orchestrators (n-tool-surface): no human-facing
// verbs/flags — just `task <tool> '<json>'`, `task schema`, `task list`. Same
// tool catalog as the UI; the only difference is the transport (per-verb spawn
// of the mt-scanner binary). Output is the uniform envelope as JSON on stdout.

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
    join(BIN_DIR, '../../../mt/scanner/target/debug/mt-scanner'),
  ]
  const found = candidates.find(path => existsSync(path))
  if (found) return found
  throw new Error('mt-scanner not found; set MT_SCANNER_BIN or run `cargo build --release` in mt/scanner')
}

/**
 * CLI transport: per-verb spawn of mt-scanner, parse JSON stdout.
 * @param {object} tool tool definition (uses `tool.cli`)
 * @param {object} input tool input
 * @returns {unknown} parsed JSON output (or null when empty)
 */
function cliTransport(tool, input) {
  const result = spawnSync(resolveScannerBin(), tool.cli(input), { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `mt-scanner exited ${result.status}`)
  return result.stdout.trim() ? JSON.parse(result.stdout) : null
}

const dispatch = createDispatch(cliTransport)

/**
 * @returns {Promise<number>} process exit code
 */
async function main() {
  const [cmd, payload] = process.argv.slice(2)

  if (!cmd || cmd === 'list') {
    process.stdout.write(`${JSON.stringify(listTools(), null, 2)}\n`)
    return 0
  }
  if (cmd === 'schema') {
    process.stdout.write(`${JSON.stringify(toolManifest(), null, 2)}\n`)
    return 0
  }

  if (cmd === 'agent') {
    if (!payload) {
      process.stderr.write('usage: task agent "<prompt>"\n')
      return 2
    }
    const baseUrl = process.env.OMLX_BASE_URL ?? 'http://127.0.0.1:8000/v1'
    const model = process.env.OMLX_MODEL ?? 'mlx-community/gemma-3n-E4B-it'
    const apiKey = process.env.OMLX_API_KEY
    try {
      const result = await runAgent({ prompt: payload, dispatch, chat: createOpenAiChat({ baseUrl, model, apiKey }) })
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      return 0
    }
    catch (error) {
      process.stderr.write(`agent failed (omlx ${baseUrl}, model ${model}): ${String(error?.message ?? error)}\n`)
      process.stderr.write('Set OMLX_BASE_URL / OMLX_MODEL, and ensure the omlx server is running.\n')
      return 2
    }
  }

  let input = {}
  if (payload) {
    try {
      input = JSON.parse(payload)
    }
    catch {
      process.stderr.write(`Invalid JSON input: ${payload}\n`)
      return 2
    }
  }

  const envelope = await dispatch(cmd, input)
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`)
  return envelope.ok ? 0 : 2
}

main()
  .then(code => process.exit(code))
  .catch((error) => {
    process.stderr.write(`${String(error?.message ?? error)}\n`)
    process.exit(1)
  })
