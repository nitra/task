#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { runWatcherScan } from '../src/watcher.js'

// Headless-вхід watcher-а (docs/specs/260809-delta-app.md, «Обсяг M4», п.3;
// mt: docs/architecture/mandates.md, «Process watcher»: «headless-актори на
// хості, працюють при закритому ноутбуці»). НАВМИСНО окремий бінарник, не
// `delta watcher_scan` через tool-каталог/dispatch — той самий інваріант,
// що n-tool-surface документує для headless-акторів (escalation-intake,
// квіз-генератор, watcher): вони ганяються кроном/вручну, без інтерактивного
// JSON-payload на команднному рядку. Дублює МІНІМАЛЬНИЙ набір fs-хелперів
// bin/delta.mjs (readConfig/fsIo/scanDecisionsDirs) — свідомо: другий
// незалежний вхід у ту саму логіку (`src/watcher.js: runWatcherScan`), а не
// імпорт internals bin/delta.mjs (той файл не експортує їх, і не повинен —
// це скрипт, не бібліотека).
//
// Крон-приклад: `*/30 * * * * cd /path/to/delta && DELTA_CONFIG_PATH=... bun bin/delta-watcher.mjs`

/**
 * @returns {string} абсолютний шлях до `config.json` застосунку (`DELTA_CONFIG_PATH` — тестовий override)
 */
function configPath() {
  if (process.env.DELTA_CONFIG_PATH) return process.env.DELTA_CONFIG_PATH
  const home = process.env.HOME ?? ''
  return join(home, 'Library/Application Support', 'com.nitra.delta', 'config.json')
}

/**
 * @returns {object} весь конфіг (відсутній/битий файл — порожній обʼєкт)
 */
function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

/**
 * @returns {{start: string, end: string}|null} конфіг тихої години — `null` не налаштовано
 */
function readQuietHours() {
  const config = readConfig()
  return config.quiet_hours_start && config.quiet_hours_end
    ? { start: config.quiet_hours_start, end: config.quiet_hours_end }
    : null
}

/**
 * @returns {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} fs-транспорт
 */
function fsIo() {
  return {
    readFile: path => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    writeFile: (path, content) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    }
  }
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {{dir: string, files: {name: string, content: string}[]}[]} скановані decisions-директорії (той самий скан, що bin/delta.mjs)
 */
function scanDecisionsDirs(mandatesDir) {
  const runsDir = join(mandatesDir, 'runs')
  if (!existsSync(runsDir)) return []
  const result = []
  for (const runEntry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!runEntry.isDirectory()) continue
    const decisionsDir = join(runsDir, runEntry.name, 'decisions')
    if (!existsSync(decisionsDir)) continue
    const files = readdirSync(decisionsDir, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => ({ name: entry.name, content: readFileSync(join(decisionsDir, entry.name), 'utf8') }))
    result.push({ dir: decisionsDir, files })
  }
  return result
}

/**
 * @returns {Promise<number>} код виходу процесу
 */
async function main() {
  const mandatesDir = process.argv[2] ?? readConfig().mandates_dir
  if (!mandatesDir) {
    process.stderr.write('delta-watcher: mandatesDir не задано (аргумент, або set_mandates_dir у config.json)\n')
    return 2
  }
  const summary = await runWatcherScan({
    io: fsIo(),
    mandatesDir,
    decisionsDirs: scanDecisionsDirs(mandatesDir),
    quietHours: readQuietHours()
  })
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  return 0
}

try {
  process.exit(await main())
} catch (error) {
  process.stderr.write(`${String(error?.message ?? error)}\n`)
  process.exit(1)
}
