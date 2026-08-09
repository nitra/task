#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { createDispatch, listTools, toolManifest } from '@7n/tauri-components'
import { aiPetition } from '../src/ai-petition.js'
import {
  applyMandateChangeProposal,
  applyMandateNarrow,
  changeProposalDecisionsDir,
  changeProposalRunId,
  readChangeProposal,
  writeChangeProposal
} from '../src/change-proposal.js'
import { decisionApprove, decisionQuiz } from '../src/decision-flow.js'
import { deriveQueue } from '../src/decisions.js'
import { formatDeviceRegistry, parseDeviceRegistry, upsertDevice } from '../src/device-registry.js'
import { formatDirectory, parseDirectory, setDirectoryEntry } from '../src/directory.js'
import { domainDigest, loadKnowledgeEntries, timeToUnderstandingTrend } from '../src/knowledge.js'
import { parseMandatesFile } from '../src/mandate-change.js'
import { deriveMandatesView } from '../src/mandates.js'
import { loadQuorumStatus, quorumApprove, quorumQuiz } from '../src/quorum.js'
import { defaultLlmConfig } from '../src/quiz.js'
import { loadOrCreateDeviceKey } from '../src/signing.js'
import { TOOLS } from '../src/tool/catalog.js'
import { deriveTrackRecord } from '../src/track-record.js'
import { deriveTrustView, narrowMandateOneStep, widenMandateOneStep, withMandateReplaced } from '../src/trust.js'
import { buildWhatSystemKnows } from '../src/what-system-knows.js'
import { notificationsLogPath, parseNotificationsLog, runWatcherScan } from '../src/watcher.js'

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
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {string} абсолютний шлях до `.mt/mandates.yaml`
 */
function mandatesYamlPath(mandatesDir) {
  return join(mandatesDir, '.mt', 'mandates.yaml')
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {{generation: number, mandates: object[]}} розібраний `.mt/mandates.yaml` (M3-верхньорівнева форма — `mandate-change.js`)
 */
function readMandatesFileCli(mandatesDir) {
  const path = mandatesYamlPath(mandatesDir)
  return parseMandatesFile(existsSync(path) ? readFileSync(path, 'utf8') : '')
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {string} абсолютний шлях до `device-registry.json` (публічний реєстр, У `mandatesDir`, комітиться в git — `device-registry.js`)
 */
function deviceRegistryPath(mandatesDir) {
  return join(mandatesDir, 'device-registry.json')
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {object[]} записи реєстру пристроїв
 */
function readDeviceRegistryCli(mandatesDir) {
  const path = deviceRegistryPath(mandatesDir)
  return parseDeviceRegistry(existsSync(path) ? readFileSync(path, 'utf8') : null)
}

/**
 * Реєструє (чи оновлює) publicKey підписанта в `device-registry.json`
 * ПЕРЕД першим підписом мандат-зміни цим ключем — «свій pubkey
 * реєструється при першому підписі» (той самий інваріант, що M1 `device_key.json`).
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {{handle: string, role: 'human'|'model', pubkeyBase64: string}} device підписант для реєстрації
 * @returns {void}
 */
function ensureRegisteredCli(mandatesDir, device) {
  const entries = readDeviceRegistryCli(mandatesDir)
  const updated = upsertDevice(entries, device)
  writeFileSync(deviceRegistryPath(mandatesDir), formatDeviceRegistry(updated))
}

/**
 * @param {string} handle handle моделі (owner мандата `kind: model`)
 * @returns {string} абсолютний шлях до локально утримуваного ключа моделі
 *   (той самий каталог, що `device_key.json` людини, поза git — див. `ai-petition.js`:
 *   мок M3 не має окремого фізичного пристрою моделі, ключ тримає застосунок)
 */
function modelKeyPath(handle) {
  return join(dirname(configPath()), 'model_keys', `${handle}.json`)
}

/**
 * Завантажує (чи генерує) локально утримуваний ключ моделі — той самий
 * `loadOrCreateDeviceKey`, що людський ключ, окремий файл на handle моделі.
 * @param {string} handle handle моделі
 * @returns {Promise<{privateKeyJwk: object, publicKeyJwk: object, publicKeyBase64: string}>} ключ моделі
 */
async function loadOrCreateModelDeviceKeyCli(handle) {
  const path = modelKeyPath(handle)
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null
  const key = await loadOrCreateDeviceKey(existing)
  if (key.created) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(key))
  }
  return key
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
 * @returns {{start: string, end: string}|null} конфіг тихої години пристрою — `null` не налаштовано (watcher/UI ніколи не притлумлюють)
 */
function readQuietHours() {
  const config = readConfig()
  return config.quiet_hours_start && config.quiet_hours_end
    ? { start: config.quiet_hours_start, end: config.quiet_hours_end }
    : null
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {string} абсолютний шлях до `.mt/directory.json` (PII, поза git — `directory.js`)
 */
function directoryPath(mandatesDir) {
  return join(mandatesDir, '.mt', 'directory.json')
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {object} довідник handle → {name, email, lang}
 */
function readDirectoryCli(mandatesDir) {
  const path = directoryPath(mandatesDir)
  return parseDirectory(existsSync(path) ? readFileSync(path, 'utf8') : null)
}

/**
 * Тіло case `directory_set`.
 * @param {object} input вхід тула
 * @returns {object} новий запис handle
 */
function handleDirectorySetCli(input) {
  const path = directoryPath(input.mandatesDir)
  const entries = readDirectoryCli(input.mandatesDir)
  const updated = setDirectoryEntry(entries, input.handle, {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.email !== undefined && { email: input.email }),
    ...(input.lang !== undefined && { lang: input.lang })
  })
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, formatDirectory(updated))
  return updated[input.handle]
}

/**
 * Тіло case `quorum_quiz`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} активне питання власного квізу підписанта
 */
function handleQuorumQuizCli(input) {
  return quorumQuiz({
    io: fsIo(),
    decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
    nnnn: input.nnnn,
    signerHandle: input.signerHandle,
    chosenOption: input.chosenOption,
    llmConfig: readLlmConfig()
  })
}

/**
 * Тіло case `quorum_approve`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} результат спроби/підпису цього підписанта
 */
async function handleQuorumApproveCli(input) {
  return quorumApprove({
    io: fsIo(),
    decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
    runId: input.runId,
    nnnn: input.nnnn,
    signerHandle: input.signerHandle,
    chosenOption: input.chosenOption,
    answer: input.answer,
    deviceKey: await loadDeviceKeyCli(),
    llmConfig: readLlmConfig()
  })
}

/**
 * Тіло case `watcher_scan`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{notifications, delivered, batched}`
 */
function handleWatcherScanCli(input) {
  return runWatcherScan({
    io: fsIo(),
    mandatesDir: input.mandatesDir,
    decisionsDirs: scanDecisionsDirs(input.mandatesDir),
    config: input.config,
    quietHours: readQuietHours()
  })
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} handle власник логу
 * @returns {object[]} розібрані нотифікації цього handle
 */
function readNotificationsCli(mandatesDir, handle) {
  const path = notificationsLogPath(mandatesDir, handle)
  return parseNotificationsLog(existsSync(path) ? readFileSync(path, 'utf8') : null)
}

/**
 * Тіло case `what_system_knows`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} агрегований профспілковий зріз
 */
async function handleWhatSystemKnowsCli(input) {
  const knowledgeEntries = await loadKnowledgeEntries(knowledgeIoCli())
  const notifications = readNotificationsCli(input.mandatesDir, input.handle)
  const deviceRegistry = readDeviceRegistryCli(input.mandatesDir)
  return buildWhatSystemKnows({ handle: input.handle, knowledgeEntries, notifications, deviceRegistry })
}

/**
 * Тіло case `trust_show` — винесено окремою функцією (той самий підхід, що
 * решта `handle*Cli`-хелперів нижче): switch `cliTransport` лишається
 * плоским диспетчером, а не носієм вкладеної логіки — знижує cognitive
 * complexity диспетчера.
 * @param {object} input вхід тула
 * @returns {object} зріз «Довіряю»
 */
function handleTrustShowCli(input) {
  const mandatesFile = readMandatesFileCli(input.mandatesDir)
  const deviceRegistry = readDeviceRegistryCli(input.mandatesDir)
  const decisionsDirs = scanDecisionsDirs(input.mandatesDir)
  return deriveTrustView({ mandatesFile, deviceRegistry, decisionsDirs, handle: input.handle ?? null })
}

/**
 * Тіло case `mandate_narrow`.
 * @param {object} input вхід тула
 * @returns {Promise<{valid: true}|{valid: false, reason: string}>} вердикт застосування
 */
async function handleMandateNarrowCli(input) {
  const mandatesDir = input.mandatesDir
  const old = readMandatesFileCli(mandatesDir)
  const mandate = old.mandates.find(m => m.owner === input.ownerHandle)
  if (!mandate) throw new Error(`mandate_narrow: owner '${input.ownerHandle}' не знайдено в mandates.yaml`)
  const newFile = withMandateReplaced(old, input.ownerHandle, narrowMandateOneStep)
  // Звуження — самопідпис owner (mandates.md); для kind: model це МОДЕЛЬНИЙ
  // ключ (мок утримує його локально — ai-petition.js), не делегатор.
  const role = mandate.kind === 'model' ? 'model' : 'human'
  const deviceKey = role === 'model' ? await loadOrCreateModelDeviceKeyCli(input.ownerHandle) : await loadDeviceKeyCli()
  ensureRegisteredCli(mandatesDir, { handle: input.ownerHandle, role, pubkeyBase64: deviceKey.publicKeyBase64 })
  return applyMandateNarrow({
    io: fsIo(),
    mandatesYamlPath: mandatesYamlPath(mandatesDir),
    old,
    new: newFile,
    handle: input.ownerHandle,
    role,
    deviceKey
  })
}

/**
 * Тіло case `mandate_widen_propose`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{changeId, delegatorHandle, decisionRequestPath, changeJsonPath}`
 */
async function handleMandateWidenProposeCli(input) {
  const mandatesDir = input.mandatesDir
  const old = readMandatesFileCli(mandatesDir)
  const mandate = old.mandates.find(m => m.owner === input.ownerHandle)
  if (!mandate) throw new Error(`mandate_widen_propose: owner '${input.ownerHandle}' не знайдено в mandates.yaml`)
  if (!mandate.escalatesTo) {
    throw new Error(`mandate_widen_propose: '${input.ownerHandle}' — кореневий мандат, немає делегатора для підпису`)
  }
  const newFile = withMandateReplaced(old, input.ownerHandle, widenMandateOneStep)
  const changeId = input.changeId ?? `mc-${Date.now()}`
  const written = await writeChangeProposal({
    io: fsIo(),
    mandatesDir,
    changeId,
    old,
    new: newFile,
    ownerHandle: input.ownerHandle,
    delegatorHandle: mandate.escalatesTo,
    initiatedBy: input.initiatedByHandle,
    reasonText: `${input.initiatedByHandle} пропонує розширити мандат '${input.ownerHandle}' на один щабель (audacity/budget_eur).`
  })
  return { changeId, delegatorHandle: mandate.escalatesTo, ...written }
}

/**
 * Тіло case `ai_petition`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{changeId, delegatorHandle, petitionPath, decisionRequestPath, ...}`
 */
async function handleAiPetitionCli(input) {
  const mandatesDir = input.mandatesDir
  const old = readMandatesFileCli(mandatesDir)
  const mandate = old.mandates.find(m => m.owner === input.modelHandle)
  if (!mandate) throw new Error(`ai_petition: model '${input.modelHandle}' не знайдено в mandates.yaml`)
  if (mandate.kind !== 'model') throw new Error(`ai_petition: owner '${input.modelHandle}' не kind: model`)
  if (!mandate.escalatesTo) {
    throw new Error(`ai_petition: '${input.modelHandle}' — кореневий мандат, немає делегатора для петиції`)
  }
  const newFile = withMandateReplaced(old, input.modelHandle, widenMandateOneStep)
  const decisionsDirs = scanDecisionsDirs(mandatesDir)
  const deviceRegistry = readDeviceRegistryCli(mandatesDir)
  const trackRecord = deriveTrackRecord({ decisionsDirs, deviceRegistry, handle: input.modelHandle })
  const modelDeviceKey = await loadOrCreateModelDeviceKeyCli(input.modelHandle)
  ensureRegisteredCli(mandatesDir, {
    handle: input.modelHandle,
    role: 'model',
    pubkeyBase64: modelDeviceKey.publicKeyBase64
  })
  const changeId = input.changeId ?? `mc-${Date.now()}`
  const result = await aiPetition({
    io: fsIo(),
    mandatesDir,
    changeId,
    old,
    new: newFile,
    modelHandle: input.modelHandle,
    delegatorHandle: mandate.escalatesTo,
    trackRecord,
    modelDeviceKey
  })
  return { changeId, delegatorHandle: mandate.escalatesTo, ...result }
}

/**
 * Тіло case `mandate_change_apply`.
 * @param {object} input вхід тула
 * @returns {Promise<{valid: true}|{valid: false, reason: string}>} вердикт застосування
 */
async function handleMandateChangeApplyCli(input) {
  const mandatesDir = input.mandatesDir
  const changeId = input.changeId
  const proposal = await readChangeProposal(fsIo(), mandatesDir, changeId)
  if (!proposal) throw new Error(`mandate_change_apply: change-proposal '${changeId}' не знайдено`)
  const approvalPath = `${changeProposalDecisionsDir(mandatesDir, changeId)}/0001-approval.json`
  if (!existsSync(approvalPath)) {
    throw new Error(
      `mandate_change_apply: decision-request change-proposal '${changeId}' ще не підписано ` +
        '(немає 0001-approval.json) — спершу пройди decision_quiz/decision_approve з runId ' +
        `'${changeProposalRunId(changeId)}'`
    )
  }
  const approval = JSON.parse(readFileSync(approvalPath, 'utf8'))
  const role = input.role ?? 'human'
  const deviceKey = role === 'model' ? await loadOrCreateModelDeviceKeyCli(input.handle) : await loadDeviceKeyCli()
  ensureRegisteredCli(mandatesDir, { handle: input.handle, role, pubkeyBase64: deviceKey.publicKeyBase64 })
  return applyMandateChangeProposal({
    io: fsIo(),
    mandatesYamlPath: mandatesYamlPath(mandatesDir),
    old: proposal.old,
    new: proposal.new,
    approval,
    handle: input.handle,
    role,
    deviceKey
  })
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
    case 'trust_show': {
      return handleTrustShowCli(input)
    }
    case 'mandate_narrow': {
      return handleMandateNarrowCli(input)
    }
    case 'mandate_widen_propose': {
      return handleMandateWidenProposeCli(input)
    }
    case 'ai_petition': {
      return handleAiPetitionCli(input)
    }
    case 'mandate_change_apply': {
      return handleMandateChangeApplyCli(input)
    }
    case 'directory_show': {
      return readDirectoryCli(input.mandatesDir)
    }
    case 'directory_set': {
      return handleDirectorySetCli(input)
    }
    case 'quorum_quiz': {
      return handleQuorumQuizCli(input)
    }
    case 'quorum_approve': {
      return handleQuorumApproveCli(input)
    }
    case 'quorum_status': {
      return loadQuorumStatus({
        io: fsIo(),
        decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
        nnnn: input.nnnn
      })
    }
    case 'watcher_scan': {
      return handleWatcherScanCli(input)
    }
    case 'notifications_show': {
      return readNotificationsCli(input.mandatesDir, input.handle)
    }
    case 'quiet_hours': {
      return readQuietHours()
    }
    case 'set_quiet_hours': {
      writeConfig({ quiet_hours_start: input.start.trim(), quiet_hours_end: input.end.trim() })
      return null
    }
    case 'what_system_knows': {
      return handleWhatSystemKnowsCli(input)
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
  // mandates_show/decisions_show/decision_quiz/decision_approve/trust_show
  // без явного mandatesDir/handle падають на конфіг — зручність для
  // інтерактивного CLI-використання (GUI завжди передає явно).
  const MANDATES_DIR_DEFAULT_TOOLS = [
    'mandates_show',
    'decisions_show',
    'decision_quiz',
    'decision_approve',
    'trust_show',
    'mandate_narrow',
    'mandate_widen_propose',
    'ai_petition',
    'mandate_change_apply',
    'directory_show',
    'directory_set',
    'quorum_quiz',
    'quorum_approve',
    'quorum_status',
    'watcher_scan',
    'notifications_show',
    'what_system_knows'
  ]
  const HANDLE_DEFAULT_TOOLS = [
    'mandates_show',
    'decisions_show',
    'trust_show',
    'notifications_show',
    'what_system_knows'
  ]
  if (MANDATES_DIR_DEFAULT_TOOLS.includes(cmd) && input.mandatesDir === undefined) {
    input.mandatesDir = readConfig().mandates_dir
  }
  if (HANDLE_DEFAULT_TOOLS.includes(cmd) && input.handle === undefined) {
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
