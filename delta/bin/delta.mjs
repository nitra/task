#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { createDispatch, listTools, toolManifest } from '@7n/tauri-components'
import { deriveMandatesView } from '../src/mandates.js'
import { TOOLS } from '../src/tool/catalog.js'

// Headless-вхід delta-поверхні (n-tool-surface): `delta <tool> '<json>'`,
// `delta list`, `delta schema`. Каталог той самий, що в GUI (src/tool/catalog.js).
// На відміну від owner (spawn mt-scanner), у delta M0 нема Rust-бінарника-читача:
// CLI читає config.json і .mt/mandates.yaml напряму через node:fs і деривує тим
// самим мок-парсером (src/mandates.js), що й Tauri-транспорт GUI — обидві
// поверхні бачать той самий результат з того самого файлу (демо-критерій M0).

/**
 *
 */
function configPath() {
  if (process.env.DELTA_CONFIG_PATH) return process.env.DELTA_CONFIG_PATH
  const home = process.env.HOME ?? ''
  return join(home, 'Library/Application Support', 'com.nitra.delta', 'config.json')
}

/**
 *
 */
function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

/**
 *
 */
function writeConfig(patch) {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ ...readConfig(), ...patch }, null, 2))
}

/**
 * CLI-транспорт: без mt-scanner, читає config.json / mandates.yaml напряму.
 * @param {object} tool визначення тула
 * @param {object} input вхід тула
 * @returns {unknown} результат виклику
 */
function cliTransport(tool, input) {
  switch (tool.name) {
    case 'whoami':
      return readConfig().identity ?? null
    case 'set_identity':
      writeConfig({ identity: input.handle.trim() })
      return null
    case 'mandates_dir':
      return readConfig().mandates_dir ?? null
    case 'set_mandates_dir':
      writeConfig({ mandates_dir: input.dir.trim() })
      return null
    case 'mandates_show': {
      const path = join(input.mandatesDir, '.mt', 'mandates.yaml')
      const yamlText = existsSync(path) ? readFileSync(path, 'utf8') : ''
      return deriveMandatesView(yamlText, input.handle ?? null)
    }
    default:
      throw new Error(`tool "${tool.name}" has no CLI transport`)
  }
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
  // whoami/mandates_show без явного mandatesDir/handle падають на конфіг —
  // зручність для інтерактивного CLI-використання (GUI завжди передає явно).
  if (cmd === 'mandates_show' && input.mandatesDir === undefined) {
    input.mandatesDir = readConfig().mandates_dir
  }
  if (cmd === 'mandates_show' && input.handle === undefined) {
    input.handle = readConfig().identity ?? null
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
