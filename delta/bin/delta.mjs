#!/usr/bin/env bun
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { createDispatch, listTools, toolManifest } from '@7n/tauri-components'
import { aiCandor, candorShow, markCandorRead } from '../src/candor.js'
import { parseDecisionRequest } from '../src/decisions.js'
import { delegateDecision, delegationQuiz } from '../src/delegation.js'
import { formatDeviceRegistry, parseDeviceRegistry, upsertDevice } from '../src/device-registry.js'
import { formatDirectory, parseDirectory, setDirectoryEntry } from '../src/directory.js'
import { loadDriftCards, runDriftScan } from '../src/drift.js'
import { buildKillSwitchRedirect, killSwitchOff, killSwitchOn, killSwitchStatus } from '../src/kill-switch.js'
import { domainDigest, loadKnowledgeEntries, timeToUnderstandingTrend } from '../src/knowledge.js'
import { parseMandatesFile } from '../src/mandate-change.js'
import { defaultLlmConfig } from '../src/quiz.js'
import { deltaReport } from '../src/report.js'
import { reviewAgenda } from '../src/review.js'
import { loadOrCreateDeviceKey } from '../src/signing.js'
import { decisionBrief } from '../src/staff.js'
import { TOOLS } from '../src/tool/catalog.js'
import { buildWhatSystemKnows } from '../src/what-system-knows.js'
import { notificationsLogPath, parseNotificationsLog, runWatcherScan } from '../src/watcher.js'

// Headless-вхід delta-поверхні (n-tool-surface) для tools ФАЗИ B:
// `delta <tool> '<json>'`, `delta list`, `delta schema`. Каталог той самий,
// що в GUI (src/tool/catalog.js), але `TOOLS` тут покриває лише ті tools,
// що `CLI_HANDLERS` нижче реально реалізує — фаза A (мандати/decisions/
// квіз-гейт/кворум/mandate-change/довіра, 19 tools: whoami/set_identity/
// mandates_dir/set_mandates_dir/mandates_show/decisions_show/decision_quiz/
// decision_approve/device_pubkey/llm_config/set_llm_config/trust_show/
// mandate_narrow/mandate_widen_propose/ai_petition/mandate_change_apply/
// quorum_quiz/quorum_approve/quorum_status) переїхала в окремий Rust-
// бінарник `delta-cli` (`delta/crates/delta-cli`, той самий crate
// `delta-core`, що GUI) — `delta <tool>` на ці 19 імен падає в
// `cliTransport` нижче з «has no CLI transport», навмисно (README, «Фаза A
// Rust-порту»). Решта (фаза B) читає config.json/.mt/mandates.yaml/
// runs/*/decisions/ напряму через node:fs і деривує спільним JS-шаром
// (src/*.js), що й Tauri-транспорт GUI — обидві поверхні бачать той самий
// результат з тих самих файлів.

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
 * фаза B (`watcher.js`/`drift.js`/`report.js`/`review.js`) деривує з цього
 * знімку, не знаючи (і не мусить), звідки він прийшов; `decisions_show`
 * (фаза A, черга «Вирішую») сканує еквівалентно, але тепер у Rust
 * (`delta-cli`/`delta-core::decisions`), не цією функцією.
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
 * @returns {string} абсолютний шлях до `drift.json` (M5, поза git — той самий каталог, що `knowledge.json`)
 */
function driftPath() {
  return join(dirname(configPath()), 'drift.json')
}

/**
 * io дрейф-карток для `src/drift.js` — той самий `{read, write}`-контракт, що `knowledgeIoCli`.
 * @returns {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} io
 */
function driftIoCli() {
  return {
    read: () => (existsSync(driftPath()) ? readFileSync(driftPath(), 'utf8') : null),
    write: content => {
      mkdirSync(dirname(driftPath()), { recursive: true })
      writeFileSync(driftPath(), content)
    }
  }
}

/**
 * @returns {string} абсолютний шлях до `candor_read.json` (M5, поза git — локальні позначки «прочитано»)
 */
function candorReadMarksPath() {
  return join(dirname(configPath()), 'candor_read.json')
}

/**
 * io позначок «прочитано» кандору — той самий `{read, write}`-контракт, що `knowledgeIoCli`.
 * @returns {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} io
 */
function candorReadMarksIoCli() {
  return {
    read: () => (existsSync(candorReadMarksPath()) ? readFileSync(candorReadMarksPath(), 'utf8') : null),
    write: content => {
      mkdirSync(dirname(candorReadMarksPath()), { recursive: true })
      writeFileSync(candorReadMarksPath(), content)
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
 * Kill-switch контекст (M6) для деривації черги/watcher-а — один прохід по
 * person-owner карти мандатів (`kill-switch.js: buildKillSwitchRedirect`).
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {object[]} mandates нормалізовані мандати (уже розібраний `.mt/mandates.yaml`)
 * @returns {Promise<{redirect: Map<string, string>, activeHandles: Set<string>}>} kill-switch контекст
 */
function killSwitchContextCli(mandatesDir, mandates) {
  return buildKillSwitchRedirect({ io: fsIo(), mandatesDir, mandates })
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
 * Тіло case `watcher_scan`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{notifications, delivered, batched}`
 */
async function handleWatcherScanCli(input) {
  const mandatesFile = readMandatesFileCli(input.mandatesDir)
  const { redirect } = await killSwitchContextCli(input.mandatesDir, mandatesFile.mandates)
  return runWatcherScan({
    io: fsIo(),
    mandatesDir: input.mandatesDir,
    decisionsDirs: scanDecisionsDirs(input.mandatesDir),
    config: input.config,
    quietHours: readQuietHours(),
    killSwitchSuppressed: new Set(redirect.keys())
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
 * Тіло case `decision_brief` (M5, Штаб).
 * @param {object} input вхід тула
 * @returns {Promise<object>} бриф
 */
function handleDecisionBriefCli(input) {
  const path = join(decisionsDirPath(input.mandatesDir, input.runId), `${input.nnnn}-decision-request.md`)
  if (!existsSync(path)) throw new Error(`decision_brief: decision-request не знайдено: ${input.nnnn}`)
  const decisionRequest = parseDecisionRequest(readFileSync(path, 'utf8'), { nnnn: input.nnnn })
  return decisionBrief({ decisionRequest, llmConfig: readLlmConfig() })
}

/**
 * Тіло case `ai_candor`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{path, record}`
 */
function handleAiCandorCli(input) {
  const mandatesFile = readMandatesFileCli(input.mandatesDir)
  return aiCandor({
    io: fsIo(),
    mandatesDir: input.mandatesDir,
    toHandle: input.toHandle,
    fromModelHandle: input.fromModelHandle,
    statement: input.statement,
    evidenceRefs: input.evidenceRefs,
    audacityLevel: input.audacityLevel,
    mandatesFile
  })
}

/**
 * Тіло case `candor_show`.
 * @param {object} input вхід тула
 * @returns {Promise<object[]>} інбокс «незручна правда» з `id`/`read`
 */
function handleCandorShowCli(input) {
  return candorShow({
    io: fsIo(),
    mandatesDir: input.mandatesDir,
    handle: input.handle,
    readMarksIo: candorReadMarksIoCli()
  })
}

/**
 * Тіло case `drift_scan`.
 * @param {object} input вхід тула
 * @returns {Promise<object[]>} свіжі дрейф-картки
 */
function handleDriftScanCli(input) {
  return runDriftScan({
    decisionsDirs: scanDecisionsDirs(input.mandatesDir),
    handle: input.handle,
    driftIo: driftIoCli()
  })
}

/**
 * Тіло case `delegation_quiz`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} активне one-tap мета-питання делегування
 */
function handleDelegationQuizCli(input) {
  const path = join(decisionsDirPath(input.mandatesDir, input.runId), `${input.nnnn}-decision-request.md`)
  const decisionRequestText = existsSync(path) ? readFileSync(path, 'utf8') : null
  return delegationQuiz({
    io: fsIo(),
    decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
    nnnn: input.nnnn,
    modelHandle: input.modelHandle,
    decisionRequestText
  })
}

/**
 * Тіло case `decision_delegate`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} результат делегування
 */
async function handleDecisionDelegateCli(input) {
  return delegateDecision({
    io: fsIo(),
    decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
    runId: input.runId,
    nnnn: input.nnnn,
    modelHandle: input.modelHandle,
    delegatedByHandle: input.delegatedByHandle,
    answer: input.answer,
    deviceKey: await loadDeviceKeyCli()
  })
}

/**
 * Тіло case `knowledge_show`.
 * @returns {Promise<object>} конспект/тренд особистої бази знань
 */
async function handleKnowledgeShowCli() {
  const entries = await loadKnowledgeEntries(knowledgeIoCli())
  return { digest: domainDigest(entries), trend: timeToUnderstandingTrend(entries), entryCount: entries.length }
}

/**
 * Тіло case `set_quiet_hours`.
 * @param {object} input вхід тула
 * @returns {null} завжди `null` (write-tool)
 */
function handleSetQuietHoursCli(input) {
  writeConfig({ quiet_hours_start: input.start.trim(), quiet_hours_end: input.end.trim() })
  return null
}

/**
 * Тіло case `candor_mark_read`.
 * @param {object} input вхід тула
 * @returns {Promise<null>} завжди `null` (write-tool)
 */
async function handleCandorMarkReadCli(input) {
  await markCandorRead({ readMarksIo: candorReadMarksIoCli(), id: input.id })
  return null
}

/**
 * Тіло case `delta_report` (M6).
 * @param {object} input вхід тула
 * @returns {Promise<object>} модель звіту + `markdown` + `path`
 */
function handleDeltaReportCli(input) {
  const mandatesFile = readMandatesFileCli(input.mandatesDir)
  return deltaReport({
    io: fsIo(),
    mandatesDir: input.mandatesDir,
    mandatesFile,
    decisionsDirs: scanDecisionsDirs(input.mandatesDir),
    periodDays: input.periodDays ?? 7
  })
}

/**
 * Тіло case `kill_switch_on` (M6) — БЕЗ квізу, миттєво (панічна кнопка).
 * @param {object} input вхід тула
 * @returns {Promise<{active: true, activatedAt: string}>} новий стан
 */
async function handleKillSwitchOnCli(input) {
  return killSwitchOn({ io: fsIo(), mandatesDir: input.mandatesDir, handle: input.handle, deviceKey: await loadDeviceKeyCli() })
}

/**
 * Тіло case `kill_switch_off` (M6).
 * @param {object} input вхід тула
 * @returns {Promise<{active: false, deactivatedAt: string}>} новий стан
 */
async function handleKillSwitchOffCli(input) {
  return killSwitchOff({ io: fsIo(), mandatesDir: input.mandatesDir, handle: input.handle, deviceKey: await loadDeviceKeyCli() })
}

/**
 * Тіло case `review_agenda` (M6).
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{widenCandidates, materialized, narrowCandidates, disputes, markdown, path}`
 */
async function handleReviewAgendaCli(input) {
  const mandatesDir = input.mandatesDir
  const mandatesFile = readMandatesFileCli(mandatesDir)
  const { activeHandles } = await killSwitchContextCli(mandatesDir, mandatesFile.mandates)
  return reviewAgenda({
    io: fsIo(),
    mandatesDir,
    mandatesFile,
    decisionsDirs: scanDecisionsDirs(mandatesDir),
    deviceRegistry: readDeviceRegistryCli(mandatesDir),
    killSwitchActiveHandles: activeHandles,
    loadModelDeviceKey: handle => loadOrCreateModelDeviceKeyCli(handle),
    registerDevice: device => {
      ensureRegisteredCli(mandatesDir, device)
      return Promise.resolve()
    },
    periodDays: input.periodDays ?? 7
  })
}

// Диспетчерська таблиця замість довгого `switch` (sonarjs/max-switch-cases
// — той самий рефактор, що HANDLERS_GUI у tool/index.js): КОЖЕН tool — один
// запис, `cliTransport` лишається чистим lookup+виклик.
// whoami/set_identity/mandates_dir/set_mandates_dir/mandates_show/
// decisions_show/decision_quiz/decision_approve/device_pubkey/llm_config/
// set_llm_config/trust_show/mandate_narrow/mandate_widen_propose/
// ai_petition/mandate_change_apply/quorum_quiz/quorum_approve/
// quorum_status — фаза A, немає запису тут навмисно: `delta <tool>` на ці
// 19 імен падає нижче на «has no CLI transport», використовуй `delta-cli`
// (Rust-бінарник `delta`, `delta/crates/delta-cli`) замість цього скрипта.
const CLI_HANDLERS = {
  knowledge_show: handleKnowledgeShowCli,
  directory_show: input => readDirectoryCli(input.mandatesDir),
  directory_set: handleDirectorySetCli,
  watcher_scan: handleWatcherScanCli,
  notifications_show: input => readNotificationsCli(input.mandatesDir, input.handle),
  quiet_hours: readQuietHours,
  set_quiet_hours: handleSetQuietHoursCli,
  what_system_knows: handleWhatSystemKnowsCli,
  decision_brief: handleDecisionBriefCli,
  ai_candor: handleAiCandorCli,
  candor_show: handleCandorShowCli,
  candor_mark_read: handleCandorMarkReadCli,
  drift_scan: handleDriftScanCli,
  drift_show: () => loadDriftCards(driftIoCli()),
  delegation_quiz: handleDelegationQuizCli,
  decision_delegate: handleDecisionDelegateCli,
  delta_report: handleDeltaReportCli,
  kill_switch_on: handleKillSwitchOnCli,
  kill_switch_off: handleKillSwitchOffCli,
  kill_switch_status: input => killSwitchStatus(fsIo(), input.mandatesDir, input.handle),
  review_agenda: handleReviewAgendaCli
}

/**
 * CLI-транспорт: без mt-scanner, читає config.json / mandates.yaml /
 * runs/*​/decisions/ напряму.
 * @param {object} tool визначення тула
 * @param {object} input вхід тула
 * @returns {Promise<unknown>} результат виклику
 */
function cliTransport(tool, input) {
  const handler = CLI_HANDLERS[tool.name]
  if (!handler) throw new Error(`tool "${tool.name}" has no CLI transport`)
  return handler(input)
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
  // Фаза B tools без явного mandatesDir/handle падають на конфіг —
  // зручність для інтерактивного CLI-використання (GUI завжди передає
  // явно). Фаза A tools (mandates_show/decisions_show/decision_quiz/
  // decision_approve/trust_show/mandate_narrow/mandate_widen_propose/
  // ai_petition/mandate_change_apply/quorum_quiz/quorum_approve/
  // quorum_status) мають той самий дефолтинг у `delta-cli`
  // (`delta/crates/delta-cli/src/main.rs`), не тут.
  const MANDATES_DIR_DEFAULT_TOOLS = [
    'directory_show',
    'directory_set',
    'watcher_scan',
    'notifications_show',
    'what_system_knows',
    'decision_brief',
    'ai_candor',
    'candor_show',
    'drift_scan',
    'delegation_quiz',
    'decision_delegate',
    'delta_report',
    'kill_switch_on',
    'kill_switch_off',
    'kill_switch_status',
    'review_agenda'
  ]
  const HANDLE_DEFAULT_TOOLS = [
    'notifications_show',
    'what_system_knows',
    'candor_show',
    'drift_scan',
    'kill_switch_on',
    'kill_switch_off',
    'kill_switch_status'
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
