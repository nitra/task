import { invoke } from '@tauri-apps/api/core'
import { appLocalDataDir, join as joinPath } from '@tauri-apps/api/path'
import { createDispatch } from '@7n/tauri-components'
import { tauriTransport } from '@7n/tauri-components/vue'
import { aiPetition } from '../ai-petition.js'
import {
  applyMandateChangeProposal,
  applyMandateNarrow,
  changeProposalDecisionsDir,
  readChangeProposal,
  writeChangeProposal
} from '../change-proposal.js'
import { decisionApprove, decisionQuiz } from '../decision-flow.js'
import { deriveQueue } from '../decisions.js'
import { formatDeviceRegistry, parseDeviceRegistry, upsertDevice } from '../device-registry.js'
import { domainDigest, loadKnowledgeEntries, timeToUnderstandingTrend } from '../knowledge.js'
import { parseMandatesFile } from '../mandate-change.js'
import { deriveMandatesView } from '../mandates.js'
import { defaultLlmConfig } from '../quiz.js'
import { loadOrCreateDeviceKey } from '../signing.js'
import { deriveTrackRecord } from '../track-record.js'
import { deriveTrustView, narrowMandateOneStep, widenMandateOneStep, withMandateReplaced } from '../trust.js'
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
  await ensureRegisteredGui(input.mandatesDir, { handle: input.ownerHandle, role, pubkeyBase64: deviceKey.publicKeyBase64 })
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
  await ensureRegisteredGui(input.mandatesDir, { handle: input.modelHandle, role: 'model', pubkeyBase64: modelDeviceKey.publicKeyBase64 })
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
    deviceKey
  })
}

/**
 * @param {object} tool визначення тула
 * @param {object} input вхід тула
 * @returns {Promise<unknown>} результат виклику
 */
async function transport(tool, input) {
  if (tool.name === 'mandates_show') {
    const yamlText = await invoke('read_mandates_yaml', { mandatesDir: input.mandatesDir })
    return deriveMandatesView(yamlText, input.handle ?? null)
  }
  if (tool.name === 'decisions_show') {
    const decisionsDirs = await invoke('scan_decisions', { mandatesDir: input.mandatesDir })
    return deriveQueue(decisionsDirs, input.handle ?? null)
  }
  if (tool.name === 'decision_quiz') {
    return decisionQuiz({
      io: tauriIo(),
      decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
      nnnn: input.nnnn,
      chosenOption: input.chosenOption,
      llmConfig: await loadLlmConfigGui(),
      knowledgeIo: knowledgeIoGui()
    })
  }
  if (tool.name === 'decision_approve') {
    return decisionApprove({
      io: tauriIo(),
      decisionsDir: decisionsDirPath(input.mandatesDir, input.runId),
      runId: input.runId,
      nnnn: input.nnnn,
      chosenOption: input.chosenOption,
      answer: input.answer,
      deviceKey: await loadDeviceKeyGui(),
      llmConfig: await loadLlmConfigGui(),
      knowledgeIo: knowledgeIoGui()
    })
  }
  if (tool.name === 'device_pubkey') {
    const key = await loadDeviceKeyGui()
    return { publicKeyBase64: key.publicKeyBase64 }
  }
  if (tool.name === 'knowledge_show') {
    const entries = await loadKnowledgeEntries(knowledgeIoGui())
    return { digest: domainDigest(entries), trend: timeToUnderstandingTrend(entries), entryCount: entries.length }
  }
  if (tool.name === 'trust_show') return handleTrustShowGui(input)
  if (tool.name === 'mandate_narrow') return handleMandateNarrowGui(input)
  if (tool.name === 'mandate_widen_propose') return handleMandateWidenProposeGui(input)
  if (tool.name === 'ai_petition') return handleAiPetitionGui(input)
  if (tool.name === 'mandate_change_apply') return handleMandateChangeApplyGui(input)
  return tauriTransport(tool, input)
}

export const dispatch = createDispatch(TOOLS, transport)
