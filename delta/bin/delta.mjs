#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { createDispatch, listTools, toolManifest } from '@7n/tauri-components'
import { decisionApprove, decisionQuiz } from '../src/decision-flow.js'
import { deriveQueue } from '../src/decisions.js'
import { domainDigest, loadKnowledgeEntries, timeToUnderstandingTrend } from '../src/knowledge.js'
import { deriveMandatesView } from '../src/mandates.js'
import { defaultLlmConfig } from '../src/quiz.js'
import { loadOrCreateDeviceKey } from '../src/signing.js'
import { TOOLS } from '../src/tool/catalog.js'

// Headless-вхід delta-поверхні (n-tool-surface): `delta <tool> '<json>'`,
// `delta list`, `delta schema`. Каталог той самий, що в GUI (src/tool/catalog.js).
// На відміну від owner (spawn mt-scanner), у delta нема Rust-бінарника-читача:
// CLI читає config.json/.mt/mandates.yaml/runs/*/decisions/ напряму через
// node:fs і деривує тим самим спільним JS-шаром (src/*.js), що й Tauri-
// транспорт GUI — обидві поверхні бачать той самий результат з тих самих
// файлів (демо-критерій M0/M1).

/**
 * @returns {string} абсолютний шлях до `config.json` застосунку (`DELTA_CONFIG_PATH` — тестовий override)
 */
function configPath() {
  if (process.env.DELTA_CONFIG_PATH) return process.env.DELTA_CONFIG_PATH
  const home = process.env.HOME ?? ''
  return join(home, 'Library/Application Support', 'com.nitra.delta', 'config.json')
}

/**
 * @returns {object} весь конфіг (відсутній/битий файл — порожній обʼєкт, не помилка)
 */
function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

/**
 * Мерджить патч у конфіг, зберігаючи решту ключів (read-merge-write).
 * @param {object} patch поля для оновлення
 * @returns {void}
 */
function writeConfig(patch) {
  const path = configPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ ...readConfig(), ...patch }, null, 2))
}

/**
 * Скановує `<mandatesDir>/runs/{run-id}/decisions/` для кожного run-а у ту
 * саму форму `{dir, files}[]`, що Rust-команда `scan_decisions` у GUI —
 * `src/decisions.js: deriveQueue` не знає (і не має знати), звідки прийшов знімок.
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {{dir: string, files: {name: string, content: string}[]}[]} скановані decisions-директорії
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
 * fs-транспорт для `decision-flow.js` — `readFile` повертає `null` (не
 * кидає), коли файл відсутній, той самий контракт, що Rust-команда
 * `read_text_file` у GUI.
 * @returns {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} io
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
 * @param {string} runId run-id
 * @returns {string} абсолютний шлях до `runs/{runId}/decisions`
 */
function decisionsDirPath(mandatesDir, runId) {
  return join(mandatesDir, 'runs', runId, 'decisions')
}

/**
 * @returns {string} абсолютний шлях до ключа пристрою (файл-сусід `config.json`, поза git)
 */
function deviceKeyPath() {
  return join(dirname(configPath()), 'device_key.json')
}

/**
 * Завантажує ключ пристрою з диску, генеруючи й персистуючи новий при
 * першому підписі — приватний ключ ніколи не потрапляє в репо (той самий
 * каталог, що `config.json`, поза git).
 * @returns {Promise<{privateKeyJwk: object, publicKeyJwk: object, publicKeyBase64: string}>} ключ пристрою
 */
async function loadDeviceKeyCli() {
  const path = deviceKeyPath()
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
  const key = await loadOrCreateDeviceKey(existing)
  if (key.created) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(key))
  }
  return key
}

/**
 * @returns {string} абсолютний шлях до бази знань (файл-сусід `config.json`/`device_key.json`, поза git)
 */
function knowledgePath() {
  return join(dirname(configPath()), 'knowledge.json')
}

/**
 * io бази знань для `src/knowledge.js` — той самий `{read, write}`-контракт,
 * що GUI (`tool/index.js`: Tauri `read_knowledge`/`write_knowledge`).
 * @returns {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} io
 */
function knowledgeIoCli() {
  return {
    read: () => (existsSync(knowledgePath()) ? readFileSync(knowledgePath(), 'utf8') : null),
    write: content => {
      mkdirSync(dirname(knowledgePath()), { recursive: true })
      writeFileSync(knowledgePath(), content)
    }
  }
}

/**
 * @returns {{baseUrl: string, model: string}} конфіг LLM-ендпоінта з `config.json`, дефолт — `quiz.js`
 */
function readLlmConfig() {
  const config = readConfig()
  const fallback = defaultLlmConfig()
  return { baseUrl: config.llm_base_url ?? fallback.baseUrl, model: config.llm_model ?? fallback.model }
}

/**
 * CLI-транспорт: без mt-scanner, читає config.json / mandates.yaml /
 * runs/*​/decisions/ напряму.
 * @param {object} tool визначення тула
 * @param {object} input вхід тула
 * @returns {Promise<unknown>} результат виклику
 */
async function cliTransport(tool, input) {
  switch (tool.name) {
    case 'whoami': {
      return readConfig().identity ?? null
    }
    case 'set_identity': {
      writeConfig({ identity: input.handle.trim() })
      return null
    }
    case 'mandates_dir': {
      return readConfig().mandates_dir ?? null
    }
    case 'set_mandates_dir': {
      writeConfig({ mandates_dir: input.dir.trim() })
      return null
    }
    case 'mandates_show': {
      const path = join(input.mandatesDir, '.mt', 'mandates.yaml')
      const yamlText = existsSync(path) ? readFileSync(path, 'utf8') : ''
      return deriveMandatesView(yamlText, input.handle ?? null)
    }
    case 'decisions_show': {
      return deriveQueue(scanDecisionsDirs(input.mandatesDir), input.handle ?? null)
    }
    case 'decision_quiz': {
      return decisionQuiz({
        io: fsIo(),
        decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
        nnnn: input.nnnn,
        chosenOption: input.chosenOption,
        llmConfig: readLlmConfig(),
        knowledgeIo: knowledgeIoCli()
      })
    }
    case 'decision_approve': {
      return decisionApprove({
        io: fsIo(),
        decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
        runId: input.runId,
        nnnn: input.nnnn,
        chosenOption: input.chosenOption,
        answer: input.answer,
        deviceKey: await loadDeviceKeyCli(),
        llmConfig: readLlmConfig(),
        knowledgeIo: knowledgeIoCli()
      })
    }
    case 'device_pubkey': {
      const key = await loadDeviceKeyCli()
      return { publicKeyBase64: key.publicKeyBase64 }
    }
    case 'llm_config': {
      return readLlmConfig()
    }
    case 'set_llm_config': {
      writeConfig({
        ...(input.baseUrl !== undefined && { llm_base_url: input.baseUrl.trim() }),
        ...(input.model !== undefined && { llm_model: input.model.trim() })
      })
      return null
    }
    case 'knowledge_show': {
      const entries = await loadKnowledgeEntries(knowledgeIoCli())
      return { digest: domainDigest(entries), trend: timeToUnderstandingTrend(entries), entryCount: entries.length }
    }
    default: {
      throw new Error(`tool "${tool.name}" has no CLI transport`)
    }
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
  // mandates_show/decisions_show/decision_quiz/decision_approve без явного
  // mandatesDir/handle падають на конфіг — зручність для інтерактивного
  // CLI-використання (GUI завжди передає явно).
  const MANDATES_DIR_DEFAULT_TOOLS = ['mandates_show', 'decisions_show', 'decision_quiz', 'decision_approve']
  if (MANDATES_DIR_DEFAULT_TOOLS.includes(cmd) && input.mandatesDir === undefined) {
    input.mandatesDir = readConfig().mandates_dir
  }
  if ((cmd === 'mandates_show' || cmd === 'decisions_show') && input.handle === undefined) {
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
