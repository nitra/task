#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createDispatch, listTools, toolManifest } from '@7n/tauri-components'
import { TOOLS } from '../src/tool/catalog.js'

// Headless-вхід owner-поверхні (n-tool-surface): `owner <tool> '<json>'`,
// `owner list`, `owner schema`. Каталог той самий, що в GUI; транспорт —
// spawn mt-scanner per-verb. Write-тули без cli-шляху лишаються in-app only —
// dispatch поверне помилку транспорту, і це очікувано.

const HERE = dirname(fileURLToPath(import.meta.url))

const SCANNER_CANDIDATES = [
  join(HERE, '../../../mt/target/release/mt-scanner'),
  join(HERE, '../../../mt/target/debug/mt-scanner')
]

/**
 * Налаштовані project paths: owner-конфіг → конфіг app (спільний ліс) → ~/www.
 * @returns {string[]} корені пошуку воркспейсів
 */
function projectPaths() {
  const home = process.env.HOME ?? ''
  for (const appId of ['com.nitra.owner', 'com.nitra.task']) {
    try {
      const raw = readFileSync(join(home, 'Library/Application Support', appId, 'config.json'), 'utf8')
      const paths = JSON.parse(raw).project_paths
      if (Array.isArray(paths) && paths.length > 0) return paths
    } catch {
      // конфігу ще немає — пробуємо наступне джерело
    }
  }
  const www = join(home, 'www')
  return existsSync(www) ? [www] : []
}

/**
 * CLI-транспорт: spawn mt-scanner, JSON зі stdout.
 * @param {object} tool визначення тула (`tool.cli` будує argv)
 * @param {object} input вхід тула
 * @returns {unknown} розпарсений вивід (null — порожній stdout)
 */
function cliTransport(tool, input) {
  if (!tool.cli) throw new Error(`tool "${tool.name}" is in-app only (no headless path)`)
  const bin = process.env.MT_SCANNER_BIN ?? SCANNER_CANDIDATES.find(existsSync)
  if (!bin) throw new Error('mt-scanner not found; set MT_SCANNER_BIN')
  const argv = tool.name === 'workspaces' ? ['workspaces', ...projectPaths()] : tool.cli(input)
  const result = spawnSync(bin, argv, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `mt-scanner exited ${result.status}`)
  return result.stdout.trim() ? JSON.parse(result.stdout) : null
}

const dispatch = createDispatch(TOOLS, cliTransport)

/**
 * @returns {Promise<number>} код виходу процесу
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
  process.exit(await main())
} catch (error) {
  process.stderr.write(`${String(error?.message ?? error)}\n`)
  process.exit(1)
}
