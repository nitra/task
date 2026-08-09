import { invoke } from '@tauri-apps/api/core'
import { appLocalDataDir, join as joinPath } from '@tauri-apps/api/path'
import { createDispatch } from '@7n/tauri-components'
import { tauriTransport } from '@7n/tauri-components/vue'
import { aiPetition } from '../ai-petition.js'
import { aiCandor, candorShow, markCandorRead } from '../candor.js'
import {
  applyMandateChangeProposal,
  applyMandateNarrow,
  changeProposalDecisionsDir,
  readChangeProposal,
  writeChangeProposal
} from '../change-proposal.js'
import { decisionApprove, decisionQuiz } from '../decision-flow.js'
import { deriveQueue, parseDecisionRequest } from '../decisions.js'
import { delegateDecision, delegationQuiz } from '../delegation.js'
import { formatDeviceRegistry, parseDeviceRegistry, upsertDevice } from '../device-registry.js'
import { formatDirectory, parseDirectory, setDirectoryEntry } from '../directory.js'
import { loadDriftCards, runDriftScan } from '../drift.js'
import { buildKillSwitchRedirect, killSwitchOff, killSwitchOn, killSwitchStatus } from '../kill-switch.js'
import { domainDigest, loadKnowledgeEntries, timeToUnderstandingTrend } from '../knowledge.js'
import { parseMandatesFile } from '../mandate-change.js'
import { deriveMandatesView } from '../mandates.js'
import { loadQuorumStatus, quorumApprove, quorumQuiz } from '../quorum.js'
import { defaultLlmConfig } from '../quiz.js'
import { deltaReport } from '../report.js'
import { reviewAgenda } from '../review.js'
import { loadOrCreateDeviceKey } from '../signing.js'
import { decisionBrief } from '../staff.js'
import { deriveTrackRecord } from '../track-record.js'
import { deriveTrustView, narrowMandateOneStep, widenMandateOneStep, withMandateReplaced } from '../trust.js'
import { buildWhatSystemKnows } from '../what-system-knows.js'
import { notificationsLogPath, parseNotificationsLog, runWatcherScan } from '../watcher.js'
import { TOOLS } from './catalog.js'

// In-app вхід у tool-поверхню для прямих (не-агентних) викликів UI:
// обробники подій делегують сюди, а не тримають inline-логіку (інваріант
// n-tool-surface). `mandates_show`/`decisions_show`/`decision_quiz`/
// `decision_approve`/`device_pubkey` мають власну транспортну логіку:
// Rust-команди лишаються тонким fs-шаром (`read_mandates_yaml`,
// `scan_decisions`, `read_text_file`/`write_text_file`, `read_device_key`/
// `write_device_key`), деривацію й квіз-оркестрацію робить спільний JS-шар
// (src/decisions.js, src/decision-flow.js, src/signing.js) — той самий код,
// що CLI (bin/delta.mjs).

/**
 * `io` для `decision-flow.js` над Tauri fs-командами — `read_text_file`
 * повертає `Option<String>` (серіалізується як `null`, коли файл відсутній),
 * той самий контракт, що `readFile` у CLI-транспорті.
 * @returns {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} io
 */
function tauriIo() {
  return {
    readFile: path => invoke('read_text_file', { path }),
    writeFile: (path, content) => invoke('write_text_file', { path, content })
  }
}

/**
 * Завантажує ключ пристрою через Rust fs-команди, генеруючи й персистуючи
 * новий при першому підписі (той самий інваріант, що CLI: приватний ключ
 * ніколи не в репо).
 * @returns {Promise<{privateKeyJwk: object, publicKeyJwk: object, publicKeyBase64: string}>} ключ пристрою
 */
async function loadDeviceKeyGui() {
  const existing = await invoke('read_device_key')
  const key = await loadOrCreateDeviceKey(existing)
  if (key.created) await invoke('write_device_key', { json: JSON.stringify(key) })
  return key
}

/**
 * @returns {Promise<{baseUrl: string, model: string}>} конфіг LLM-ендпоінта — Rust-конфіг, дефолт із `quiz.js`
 */
async function loadLlmConfigGui() {
  const config = await invoke('get_llm_config')
  const fallback = defaultLlmConfig()
  return { baseUrl: config.baseUrl ?? fallback.baseUrl, model: config.model ?? fallback.model }
}

/**
 * `config.json` над generic `read_text_file`/`write_text_file` — той самий
 * шлях (`appLocalDataDir`), що `modelKeyPathGui` уже конструює для
 * model-ключів M3; уникає нової Rust-команди для `quiet_hours` (M4): весь
 * файл читається/мерджиться/пишеться JS-шаром, той самий read-merge-write,
 * що `bin/delta.mjs: writeConfig`.
 * @returns {Promise<string>} абсолютний шлях до `config.json`
 */
async function appConfigPathGui() {
  const dir = await appLocalDataDir()
  return joinPath(dir, 'config.json')
}

/**
 * @returns {Promise<object>} весь конфіг (відсутній/битий файл — порожній обʼєкт)
 */
async function readAppConfigGui() {
  const path = await appConfigPathGui()
  const text = await invoke('read_text_file', { path })
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

/**
 * @param {object} patch поля для оновлення (read-merge-write)
 * @returns {Promise<void>}
 */
async function writeAppConfigGui(patch) {
  const path = await appConfigPathGui()
  const current = await readAppConfigGui()
  await invoke('write_text_file', { path, content: JSON.stringify({ ...current, ...patch }, null, 2) })
}

/**
 * @returns {Promise<{start: string, end: string}|null>} конфіг тихої години пристрою — `null` не налаштовано
 */
async function loadQuietHoursGui() {
  const config = await readAppConfigGui()
  return config.quiet_hours_start && config.quiet_hours_end
    ? { start: config.quiet_hours_start, end: config.quiet_hours_end }
    : null
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {string} абсолютний шлях до `.mt/directory.json` (PII, поза git — `directory.js`)
 */
function directoryPathGui(mandatesDir) {
  return `${mandatesDir}/.mt/directory.json`
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {Promise<object>} довідник handle → {name, email, lang}
 */
async function readDirectoryGui(mandatesDir) {
  const text = await invoke('read_text_file', { path: directoryPathGui(mandatesDir) })
  return parseDirectory(text)
}

/**
 * Тіло tool `directory_set`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} новий запис handle
 */
async function handleDirectorySetGui(input) {
  const entries = await readDirectoryGui(input.mandatesDir)
  const updated = setDirectoryEntry(entries, input.handle, {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.email !== undefined && { email: input.email }),
    ...(input.lang !== undefined && { lang: input.lang })
  })
  await invoke('write_text_file', { path: directoryPathGui(input.mandatesDir), content: formatDirectory(updated) })
  return updated[input.handle]
}

/**
 * Тіло tool `watcher_scan`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{notifications, delivered, batched}`
 */
async function handleWatcherScanGui(input) {
  const decisionsDirs = await invoke('scan_decisions', { mandatesDir: input.mandatesDir })
  const mandatesFile = await readMandatesFileGui(input.mandatesDir)
  const { redirect } = await killSwitchContextGui(input.mandatesDir, mandatesFile.mandates)
  return runWatcherScan({
    io: tauriIo(),
    mandatesDir: input.mandatesDir,
    decisionsDirs,
    quietHours: await loadQuietHoursGui(),
    killSwitchSuppressed: new Set(redirect.keys())
  })
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} handle власник логу
 * @returns {Promise<object[]>} розібрані нотифікації цього handle
 */
async function readNotificationsGui(mandatesDir, handle) {
  const text = await invoke('read_text_file', { path: notificationsLogPath(mandatesDir, handle) })
  return parseNotificationsLog(text)
}

/**
 * Тіло tool `what_system_knows`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} агрегований профспілковий зріз
 */
async function handleWhatSystemKnowsGui(input) {
  const knowledgeEntries = await loadKnowledgeEntries(knowledgeIoGui())
  const notifications = await readNotificationsGui(input.mandatesDir, input.handle)
  const deviceRegistry = await readDeviceRegistryGui(input.mandatesDir)
  return buildWhatSystemKnows({ handle: input.handle, knowledgeEntries, notifications, deviceRegistry })
}

/**
 * io бази знань (M2) над Rust fs-командами — той самий `{read, write}`-
 * контракт, що CLI (`bin/delta.mjs: knowledgeIoCli`).
 * @returns {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} io
 */
function knowledgeIoGui() {
  return {
    read: () => invoke('read_knowledge'),
    write: content => invoke('write_knowledge', { json: content })
  }
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} runId run-id
 * @returns {string} абсолютний шлях до `runs/{runId}/decisions`
 */
function decisionsDirPath(mandatesDir, runId) {
  return `${mandatesDir}/runs/${runId}/decisions`
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {string} абсолютний шлях до `.mt/mandates.yaml`
 */
function mandatesYamlPathGui(mandatesDir) {
  return `${mandatesDir}/.mt/mandates.yaml`
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {Promise<{generation: number, mandates: object[]}>} розібраний `.mt/mandates.yaml` (M3-верхньорівнева форма)
 */
async function readMandatesFileGui(mandatesDir) {
  const yamlText = await invoke('read_mandates_yaml', { mandatesDir })
  return parseMandatesFile(yamlText)
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {string} абсолютний шлях до `device-registry.json` (публічний реєстр, У `mandatesDir`, комітиться в git)
 */
function deviceRegistryPathGui(mandatesDir) {
  return `${mandatesDir}/device-registry.json`
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {Promise<object[]>} записи реєстру пристроїв
 */
async function readDeviceRegistryGui(mandatesDir) {
  const text = await invoke('read_text_file', { path: deviceRegistryPathGui(mandatesDir) })
  return parseDeviceRegistry(text)
}

/**
 * Реєструє (чи оновлює) publicKey підписанта в `device-registry.json` —
 * той самий інваріант, що CLI (`bin/delta.mjs: ensureRegisteredCli`).
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {{handle: string, role: 'human'|'model', pubkeyBase64: string}} device підписант для реєстрації
 * @returns {Promise<void>}
 */
async function ensureRegisteredGui(mandatesDir, device) {
  const entries = await readDeviceRegistryGui(mandatesDir)
  const updated = upsertDevice(entries, device)
  await invoke('write_text_file', { path: deviceRegistryPathGui(mandatesDir), content: formatDeviceRegistry(updated) })
}

/**
 * Kill-switch контекст (M6) для деривації черги/watcher-а — той самий
 * інваріант, що CLI (`bin/delta.mjs: killSwitchContextCli`).
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {object[]} mandates нормалізовані мандати
 * @returns {Promise<{redirect: Map<string, string>, activeHandles: Set<string>}>} kill-switch контекст
 */
function killSwitchContextGui(mandatesDir, mandates) {
  return buildKillSwitchRedirect({ io: tauriIo(), mandatesDir, mandates })
}

/**
 * @param {string} handle handle моделі (owner мандата `kind: model`)
 * @returns {Promise<string>} абсолютний шлях до локально утримуваного ключа моделі
 *   (той самий каталог, що `device_key.json` людини — `appLocalDataDir`, поза git;
 *   мок M3 не має окремого фізичного пристрою моделі, ключ тримає застосунок — `ai-petition.js`)
 */
async function modelKeyPathGui(handle) {
  const dir = await appLocalDataDir()
  return joinPath(dir, 'model_keys', `${handle}.json`)
}

/**
 * Завантажує (чи генерує) локально утримуваний ключ моделі через generic
 * `read_text_file`/`write_text_file` — той самий патерн, що `loadDeviceKeyGui`.
 * @param {string} handle handle моделі
 * @returns {Promise<{privateKeyJwk: object, publicKeyJwk: object, publicKeyBase64: string}>} ключ моделі
 */
async function loadOrCreateModelDeviceKeyGui(handle) {
  const path = await modelKeyPathGui(handle)
  const existing = await invoke('read_text_file', { path })
  const key = await loadOrCreateDeviceKey(existing)
  if (key.created) await invoke('write_text_file', { path, content: JSON.stringify(key) })
  return key
}

/**
 * Тіло tool `trust_show` — винесено окремою функцією (той самий підхід, що
 * решта `handle*Gui`-хелперів нижче): `transport` лишається плоским
 * диспетчером, не носієм вкладеної логіки — знижує cognitive complexity
 * диспетчера (той самий рефактор, що CLI-дзеркало в `bin/delta.mjs`).
 * @param {object} input вхід тула
 * @returns {Promise<object>} зріз «Довіряю»
 */
async function handleTrustShowGui(input) {
  const mandatesFile = await readMandatesFileGui(input.mandatesDir)
  const deviceRegistry = await readDeviceRegistryGui(input.mandatesDir)
  const decisionsDirs = await invoke('scan_decisions', { mandatesDir: input.mandatesDir })
  return deriveTrustView({ mandatesFile, deviceRegistry, decisionsDirs, handle: input.handle ?? null })
}

/**
 * Тіло tool `mandate_narrow`.
 * @param {object} input вхід тула
 * @returns {Promise<{valid: true}|{valid: false, reason: string}>} вердикт застосування
 */
async function handleMandateNarrowGui(input) {
  const old = await readMandatesFileGui(input.mandatesDir)
  const mandate = old.mandates.find(m => m.owner === input.ownerHandle)
  if (!mandate) throw new Error(`mandate_narrow: owner '${input.ownerHandle}' не знайдено в mandates.yaml`)
  const newFile = withMandateReplaced(old, input.ownerHandle, narrowMandateOneStep)
  // Звуження — самопідпис owner; для kind: model це МОДЕЛЬНИЙ ключ (мок
  // утримує його локально), не делегатор (той самий вибір, що CLI).
  const role = mandate.kind === 'model' ? 'model' : 'human'
  const deviceKey = role === 'model' ? await loadOrCreateModelDeviceKeyGui(input.ownerHandle) : await loadDeviceKeyGui()
  await ensureRegisteredGui(input.mandatesDir, {
    handle: input.ownerHandle,
    role,
    pubkeyBase64: deviceKey.publicKeyBase64
  })
  return applyMandateNarrow({
    io: tauriIo(),
    mandatesYamlPath: mandatesYamlPathGui(input.mandatesDir),
    old,
    new: newFile,
    handle: input.ownerHandle,
    role,
    deviceKey
  })
}

/**
 * Тіло tool `mandate_widen_propose`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{changeId, delegatorHandle, decisionRequestPath, changeJsonPath}`
 */
async function handleMandateWidenProposeGui(input) {
  const old = await readMandatesFileGui(input.mandatesDir)
  const mandate = old.mandates.find(m => m.owner === input.ownerHandle)
  if (!mandate) throw new Error(`mandate_widen_propose: owner '${input.ownerHandle}' не знайдено в mandates.yaml`)
  if (!mandate.escalatesTo) {
    throw new Error(`mandate_widen_propose: '${input.ownerHandle}' — кореневий мандат, немає делегатора для підпису`)
  }
  const newFile = withMandateReplaced(old, input.ownerHandle, widenMandateOneStep)
  const changeId = input.changeId ?? `mc-${Date.now()}`
  const written = await writeChangeProposal({
    io: tauriIo(),
    mandatesDir: input.mandatesDir,
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
 * Тіло tool `ai_petition`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{changeId, delegatorHandle, petitionPath, decisionRequestPath, ...}`
 */
async function handleAiPetitionGui(input) {
  const old = await readMandatesFileGui(input.mandatesDir)
  const mandate = old.mandates.find(m => m.owner === input.modelHandle)
  if (!mandate) throw new Error(`ai_petition: model '${input.modelHandle}' не знайдено в mandates.yaml`)
  if (mandate.kind !== 'model') throw new Error(`ai_petition: owner '${input.modelHandle}' не kind: model`)
  if (!mandate.escalatesTo) {
    throw new Error(`ai_petition: '${input.modelHandle}' — кореневий мандат, немає делегатора для петиції`)
  }
  const newFile = withMandateReplaced(old, input.modelHandle, widenMandateOneStep)
  const decisionsDirs = await invoke('scan_decisions', { mandatesDir: input.mandatesDir })
  const deviceRegistry = await readDeviceRegistryGui(input.mandatesDir)
  const trackRecord = deriveTrackRecord({ decisionsDirs, deviceRegistry, handle: input.modelHandle })
  const modelDeviceKey = await loadOrCreateModelDeviceKeyGui(input.modelHandle)
  await ensureRegisteredGui(input.mandatesDir, {
    handle: input.modelHandle,
    role: 'model',
    pubkeyBase64: modelDeviceKey.publicKeyBase64
  })
  const changeId = input.changeId ?? `mc-${Date.now()}`
  const result = await aiPetition({
    io: tauriIo(),
    mandatesDir: input.mandatesDir,
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
 * Тіло tool `mandate_change_apply`.
 * @param {object} input вхід тула
 * @returns {Promise<{valid: true}|{valid: false, reason: string}>} вердикт застосування
 */
async function handleMandateChangeApplyGui(input) {
  const proposal = await readChangeProposal(tauriIo(), input.mandatesDir, input.changeId)
  if (!proposal) throw new Error(`mandate_change_apply: change-proposal '${input.changeId}' не знайдено`)
  const approvalPath = `${changeProposalDecisionsDir(input.mandatesDir, input.changeId)}/0001-approval.json`
  const approvalText = await invoke('read_text_file', { path: approvalPath })
  if (!approvalText) {
    throw new Error(
      `mandate_change_apply: decision-request change-proposal '${input.changeId}' ще не підписано ` +
        '(немає 0001-approval.json) — спершу пройди decision_quiz/decision_approve'
    )
  }
  const approval = JSON.parse(approvalText)
  const role = input.role ?? 'human'
  const deviceKey = role === 'model' ? await loadOrCreateModelDeviceKeyGui(input.handle) : await loadDeviceKeyGui()
  await ensureRegisteredGui(input.mandatesDir, { handle: input.handle, role, pubkeyBase64: deviceKey.publicKeyBase64 })
  return applyMandateChangeProposal({
    io: tauriIo(),
    mandatesYamlPath: mandatesYamlPathGui(input.mandatesDir),
    old: proposal.old,
    new: proposal.new,
    approval,
    handle: input.handle,
    role,
    deviceKey,
    // Маркер «застосовано» (M6, report.js) — пишеться ЛИШЕ в run-каталозі
    // цього change-proposal, поруч із decision-request/change.json.
    appliedMarkerPath: `${changeProposalDecisionsDir(input.mandatesDir, input.changeId)}/0001-applied.json`
  })
}

/**
 * Тіло tool `quorum_quiz`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} активне питання власного квізу підписанта
 */
async function handleQuorumQuizGui(input) {
  return quorumQuiz({
    io: tauriIo(),
    decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
    nnnn: input.nnnn,
    signerHandle: input.signerHandle,
    chosenOption: input.chosenOption,
    llmConfig: await loadLlmConfigGui()
  })
}

/**
 * Тіло tool `quorum_approve`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} результат спроби/підпису цього підписанта
 */
async function handleQuorumApproveGui(input) {
  return quorumApprove({
    io: tauriIo(),
    decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
    runId: input.runId,
    nnnn: input.nnnn,
    signerHandle: input.signerHandle,
    chosenOption: input.chosenOption,
    transcript: input.transcript,
    deviceKey: await loadDeviceKeyGui(),
    llmConfig: await loadLlmConfigGui()
  })
}

/**
 * Тіло tool `quorum_status` — винесено окремою функцією (той самий підхід,
 * що решта `handle*Gui`-хелперів): знижує cognitive complexity диспетчера
 * `transport`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{nnnn, approvers, signed, pending, status}`
 */
function handleQuorumStatusGui(input) {
  return loadQuorumStatus({
    io: tauriIo(),
    decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
    nnnn: input.nnnn
  })
}

/**
 * Тіло tool `set_quiet_hours`.
 * @param {object} input вхід тула
 * @returns {Promise<null>} завжди `null` (write-tool)
 */
async function handleSetQuietHoursGui(input) {
  await writeAppConfigGui({ quiet_hours_start: input.start.trim(), quiet_hours_end: input.end.trim() })
  return null
}

/**
 * Тіло tool `mandates_show`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} дериваційний зріз карти мандатів
 */
async function handleMandatesShowGui(input) {
  const yamlText = await invoke('read_mandates_yaml', { mandatesDir: input.mandatesDir })
  return deriveMandatesView(yamlText, input.handle ?? null)
}

/**
 * Тіло tool `decisions_show`.
 * @param {object} input вхід тула
 * @returns {Promise<object[]>} черга «Вирішую»
 */
async function handleDecisionsShowGui(input) {
  const decisionsDirs = await invoke('scan_decisions', { mandatesDir: input.mandatesDir })
  const mandatesFile = await readMandatesFileGui(input.mandatesDir)
  const { redirect } = await killSwitchContextGui(input.mandatesDir, mandatesFile.mandates)
  return deriveQueue(decisionsDirs, input.handle ?? null, { killSwitchRedirect: redirect })
}

/**
 * Тіло tool `decision_quiz`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} активне питання квізу
 */
async function handleDecisionQuizGui(input) {
  return decisionQuiz({
    io: tauriIo(),
    decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
    nnnn: input.nnnn,
    chosenOption: input.chosenOption,
    llmConfig: await loadLlmConfigGui(),
    knowledgeIo: knowledgeIoGui()
  })
}

/**
 * Тіло tool `decision_approve`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} результат спроби/підпису
 */
async function handleDecisionApproveGui(input) {
  return decisionApprove({
    io: tauriIo(),
    decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
    runId: input.runId,
    nnnn: input.nnnn,
    chosenOption: input.chosenOption,
    answer: input.answer,
    transcript: input.transcript,
    deviceKey: await loadDeviceKeyGui(),
    llmConfig: await loadLlmConfigGui(),
    knowledgeIo: knowledgeIoGui()
  })
}

/**
 * Тіло tool `device_pubkey`.
 * @returns {Promise<{publicKeyBase64: string}>} публічний ключ пристрою
 */
async function handleDevicePubkeyGui() {
  const key = await loadDeviceKeyGui()
  return { publicKeyBase64: key.publicKeyBase64 }
}

/**
 * Тіло tool `knowledge_show`.
 * @returns {Promise<object>} конспект/тренд особистої бази знань
 */
async function handleKnowledgeShowGui() {
  const entries = await loadKnowledgeEntries(knowledgeIoGui())
  return { digest: domainDigest(entries), trend: timeToUnderstandingTrend(entries), entryCount: entries.length }
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} runId run-id
 * @param {string} nnnn чотиризначний номер
 * @returns {string} абсолютний шлях до `NNNN-decision-request.md`
 */
function decisionRequestPathGui(mandatesDir, runId, nnnn) {
  return `${decisionsDirPath(mandatesDir, runId)}/${nnnn}-decision-request.md`
}

/**
 * Тіло tool `decision_brief` (M5, Штаб) — ледаче: читає decision-request і
 * стискає в бриф лише за явним запитом (заголовок `staff.js`).
 * @param {object} input вхід тула
 * @returns {Promise<object>} бриф
 */
async function handleDecisionBriefGui(input) {
  const text = await invoke('read_text_file', {
    path: decisionRequestPathGui(input.mandatesDir, input.runId, input.nnnn)
  })
  if (!text) throw new Error(`decision_brief: decision-request не знайдено: ${input.nnnn}`)
  const decisionRequest = parseDecisionRequest(text, { nnnn: input.nnnn })
  return decisionBrief({ decisionRequest, llmConfig: await loadLlmConfigGui() })
}

/**
 * Тіло tool `ai_candor`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{path, record}`
 */
async function handleAiCandorGui(input) {
  const mandatesFile = await readMandatesFileGui(input.mandatesDir)
  return aiCandor({
    io: tauriIo(),
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
 * `candor_read.json` (M5) над generic `read_text_file`/`write_text_file` —
 * той самий каталог, що `config.json`/`knowledge.json`, поза git; ЛОКАЛЬНА
 * позначка «прочитано» (`candor.js`, заголовок модуля) — не синхронізується.
 * @returns {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} io
 */
function candorReadMarksIoGui() {
  return {
    read: async () => invoke('read_text_file', { path: await joinPath(await appLocalDataDir(), 'candor_read.json') }),
    write: async content =>
      invoke('write_text_file', { path: await joinPath(await appLocalDataDir(), 'candor_read.json'), content })
  }
}

/**
 * Тіло tool `candor_show`.
 * @param {object} input вхід тула
 * @returns {Promise<object[]>} інбокс «незручна правда» з `id`/`read`
 */
function handleCandorShowGui(input) {
  return candorShow({
    io: tauriIo(),
    mandatesDir: input.mandatesDir,
    handle: input.handle,
    readMarksIo: candorReadMarksIoGui()
  })
}

/**
 * Тіло tool `candor_mark_read`.
 * @param {object} input вхід тула
 * @returns {Promise<null>} завжди `null` (write-tool)
 */
async function handleCandorMarkReadGui(input) {
  await markCandorRead({ readMarksIo: candorReadMarksIoGui(), id: input.id })
  return null
}

/**
 * `drift.json` (M5) над generic `read_text_file`/`write_text_file` — той
 * самий каталог, поза git; ЛОКАЛЬНЕ дзеркало, НІКОЛИ не `.mt/notifications`
 * (`drift.js`, заголовок модуля).
 * @returns {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} io
 */
function driftIoGui() {
  return {
    read: async () => invoke('read_text_file', { path: await joinPath(await appLocalDataDir(), 'drift.json') }),
    write: async content =>
      invoke('write_text_file', { path: await joinPath(await appLocalDataDir(), 'drift.json'), content })
  }
}

/**
 * Тіло tool `drift_scan`.
 * @param {object} input вхід тула
 * @returns {Promise<object[]>} свіжі дрейф-картки
 */
async function handleDriftScanGui(input) {
  const decisionsDirs = await invoke('scan_decisions', { mandatesDir: input.mandatesDir })
  return runDriftScan({ decisionsDirs, handle: input.handle, driftIo: driftIoGui() })
}

/**
 * Тіло tool `drift_show`.
 * @returns {Promise<object[]>} локально збережені дрейф-картки
 */
function handleDriftShowGui() {
  return loadDriftCards(driftIoGui())
}

/**
 * Тіло tool `delegation_quiz`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} активне one-tap мета-питання делегування
 */
async function handleDelegationQuizGui(input) {
  const decisionRequestText = await invoke('read_text_file', {
    path: decisionRequestPathGui(input.mandatesDir, input.runId, input.nnnn)
  })
  return delegationQuiz({
    io: tauriIo(),
    decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
    nnnn: input.nnnn,
    modelHandle: input.modelHandle,
    decisionRequestText
  })
}

/**
 * Тіло tool `decision_delegate`.
 * @param {object} input вхід тула
 * @returns {Promise<object>} результат делегування
 */
async function handleDecisionDelegateGui(input) {
  return delegateDecision({
    io: tauriIo(),
    decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
    runId: input.runId,
    nnnn: input.nnnn,
    modelHandle: input.modelHandle,
    delegatedByHandle: input.delegatedByHandle,
    answer: input.answer,
    deviceKey: await loadDeviceKeyGui()
  })
}

/**
 * Тіло tool `delta_report` (M6).
 * @param {object} input вхід тула
 * @returns {Promise<object>} модель звіту + `markdown` + `path`
 */
async function handleDeltaReportGui(input) {
  const mandatesFile = await readMandatesFileGui(input.mandatesDir)
  const decisionsDirs = await invoke('scan_decisions', { mandatesDir: input.mandatesDir })
  return deltaReport({
    io: tauriIo(),
    mandatesDir: input.mandatesDir,
    mandatesFile,
    decisionsDirs,
    periodDays: input.periodDays ?? 7
  })
}

/**
 * Тіло tool `kill_switch_on` (M6) — БЕЗ квізу, миттєво (панічна кнопка).
 * @param {object} input вхід тула
 * @returns {Promise<{active: true, activatedAt: string}>} новий стан
 */
async function handleKillSwitchOnGui(input) {
  return killSwitchOn({ io: tauriIo(), mandatesDir: input.mandatesDir, handle: input.handle, deviceKey: await loadDeviceKeyGui() })
}

/**
 * Тіло tool `kill_switch_off` (M6).
 * @param {object} input вхід тула
 * @returns {Promise<{active: false, deactivatedAt: string}>} новий стан
 */
async function handleKillSwitchOffGui(input) {
  return killSwitchOff({ io: tauriIo(), mandatesDir: input.mandatesDir, handle: input.handle, deviceKey: await loadDeviceKeyGui() })
}

/**
 * Тіло tool `kill_switch_status` (M6).
 * @param {object} input вхід тула
 * @returns {Promise<{active: boolean}>} поточний стан
 */
function handleKillSwitchStatusGui(input) {
  return killSwitchStatus(tauriIo(), input.mandatesDir, input.handle)
}

/**
 * Тіло tool `review_agenda` (M6).
 * @param {object} input вхід тула
 * @returns {Promise<object>} `{widenCandidates, materialized, narrowCandidates, disputes, markdown, path}`
 */
async function handleReviewAgendaGui(input) {
  const mandatesDir = input.mandatesDir
  const mandatesFile = await readMandatesFileGui(mandatesDir)
  const decisionsDirs = await invoke('scan_decisions', { mandatesDir })
  const deviceRegistry = await readDeviceRegistryGui(mandatesDir)
  const { activeHandles } = await killSwitchContextGui(mandatesDir, mandatesFile.mandates)
  return reviewAgenda({
    io: tauriIo(),
    mandatesDir,
    mandatesFile,
    decisionsDirs,
    deviceRegistry,
    killSwitchActiveHandles: activeHandles,
    loadModelDeviceKey: handle => loadOrCreateModelDeviceKeyGui(handle),
    registerDevice: device => ensureRegisteredGui(mandatesDir, device),
    periodDays: input.periodDays ?? 7
  })
}

// Диспетчерська таблиця замість довгого `if`-ланцюга (знижує cognitive
// complexity `transport` — той самий рефактор-намір, що `handle*Gui`-
// хелпери вище, доведений до кінця: КОЖЕН tool — один запис, `transport`
// лишається чистим lookup+виклик). Пропущені tools (без запису тут)
// падають на generic `tauriTransport` (той самий фолбек, що раніше).
const HANDLERS_GUI = {
  mandates_show: handleMandatesShowGui,
  decisions_show: handleDecisionsShowGui,
  decision_quiz: handleDecisionQuizGui,
  decision_approve: handleDecisionApproveGui,
  device_pubkey: handleDevicePubkeyGui,
  knowledge_show: handleKnowledgeShowGui,
  trust_show: handleTrustShowGui,
  mandate_narrow: handleMandateNarrowGui,
  mandate_widen_propose: handleMandateWidenProposeGui,
  ai_petition: handleAiPetitionGui,
  mandate_change_apply: handleMandateChangeApplyGui,
  directory_show: input => readDirectoryGui(input.mandatesDir),
  directory_set: handleDirectorySetGui,
  quorum_quiz: handleQuorumQuizGui,
  quorum_approve: handleQuorumApproveGui,
  quorum_status: handleQuorumStatusGui,
  watcher_scan: handleWatcherScanGui,
  notifications_show: input => readNotificationsGui(input.mandatesDir, input.handle),
  quiet_hours: loadQuietHoursGui,
  set_quiet_hours: handleSetQuietHoursGui,
  what_system_knows: handleWhatSystemKnowsGui,
  decision_brief: handleDecisionBriefGui,
  ai_candor: handleAiCandorGui,
  candor_show: handleCandorShowGui,
  candor_mark_read: handleCandorMarkReadGui,
  drift_scan: handleDriftScanGui,
  drift_show: handleDriftShowGui,
  delegation_quiz: handleDelegationQuizGui,
  decision_delegate: handleDecisionDelegateGui,
  delta_report: handleDeltaReportGui,
  kill_switch_on: handleKillSwitchOnGui,
  kill_switch_off: handleKillSwitchOffGui,
  kill_switch_status: handleKillSwitchStatusGui,
  review_agenda: handleReviewAgendaGui
}

/**
 * @param {object} tool визначення тула
 * @param {object} input вхід тула
 * @returns {Promise<unknown>} результат виклику
 */
function transport(tool, input) {
  const handler = HANDLERS_GUI[tool.name]
  return handler ? handler(input) : tauriTransport(tool, input)
}

export const dispatch = createDispatch(TOOLS, transport)
