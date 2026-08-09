import { invoke } from '@tauri-apps/api/core'
import { createDispatch } from '@7n/tauri-components'
import { tauriTransport } from '@7n/tauri-components/vue'
import { decisionApprove, decisionQuiz } from '../decision-flow.js'
import { deriveQueue } from '../decisions.js'
import { domainDigest, loadKnowledgeEntries, timeToUnderstandingTrend } from '../knowledge.js'
import { deriveMandatesView } from '../mandates.js'
import { defaultLlmConfig } from '../quiz.js'
import { loadOrCreateDeviceKey } from '../signing.js'
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
  return tauriTransport(tool, input)
}

export const dispatch = createDispatch(TOOLS, transport)
