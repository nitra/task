// ШІ-петиція (M3, docs/specs/260809-delta-app.md, «Обсяг M3», п.5): tool
// `ai_petition` — headless, СИМУЛЮЄ модель (викликається CLI чи майбутнім
// watcher-ом, не людиною напряму). Від імені моделі формує draft-розширення
// власного мандата з evidence (посилання на записи трек-рекорду —
// `track-record.js`) і кладе ту саму change-proposal, що п.4
// (`change-proposal.js`), у чергу людини-делегатора.
//
// **Інваріант (буквально з задачі):** «Модельний ключ підписує ЛИШЕ
// петицію-пропозицію (не зміну) — підпис зміни завжди людський.» Тут
// підписується РІВНО ОДИН артефакт модельним ключем — сама петиція
// (`0001-petition.json`, свідчення «я прошу, ось мій evidence»). Сам
// decision-request НЕ підписаний, доки людина не пройде квіз-гейт
// (`decision-flow.js`), а мутація `.mt/mandates.yaml`
// (`change-proposal.js: applyMandateChangeProposal`) вимагає ЛЮДСЬКОГО
// ключа безумовно («остання константа», `mandate-change.js`) — модельний
// підпис на самій зміні відхиляється на рівні `validate_mandate_change`,
// навіть якби хтось спробував його туди підсунути.
//
// Схема петиції — власне розширення M3 понад буквальний контракт
// mandates.md (документ не резервує окремий артефакт «петиція», лише каже
// «модель формує draft-розширення... людина бачить його в черзі як звичайне
// рішення з квізом» — сам механізм подачі задокументований тут).

import { changeProposalDecisionsDir, writeChangeProposal } from './change-proposal.js'
import { signPayload, verifyPayload } from './signing.js'

/**
 * Формує людиночитабельний evidence-текст із трек-рекорду моделі —
 * «ЧЕСНІСТЬ» інваріант track-record.js: буквально каже «активність і
 * послідовність», уникає слів «якість»/«успішність».
 * @param {object} trackRecord трек-рекорд моделі ({@link import('./track-record.js').deriveTrackRecord})
 * @returns {string} evidence-текст для контексту decision-request
 */
export function buildEvidenceText(trackRecord) {
  if (trackRecord.totalDecisions === 0) {
    return 'Немає підписаних рішень цього мандата ще — evidence відсутній (петиція спирається лише на заявлений намір).'
  }
  const byType = trackRecord.byDecisionType.map(t => `${t.decisionType}: ${t.count}`).join(', ')
  const rateText = trackRecord.overrideFreeRate === null ? 'н/д' : `${Math.round(trackRecord.overrideFreeRate * 100)}%`
  return (
    `${trackRecord.totalDecisions} підписаних рішень у межах поточного мандата (${byType}); ` +
    `${trackRecord.overrideFreeCount}/${trackRecord.totalDecisions} без наступного людського override (${rateText}). ` +
    'Це активність і послідовність, НЕ оцінка якості рішень — audit-механіки для цього ще немає.'
  )
}

/**
 * Canonical payload петиції — підписується ЛИШЕ модельним ключем.
 * @param {object} params вхідні параметри
 * @param {string} params.modelHandle handle моделі-ініціатора
 * @param {string} params.ownerHandle owner мандата, що змінюється (зазвичай той самий, що modelHandle)
 * @param {{generation: number}} params.old поточний стан `.mt/mandates.yaml`
 * @param {{generation: number}} params.new запропонований новий стан
 * @param {string} params.evidenceText evidence-текст ({@link buildEvidenceText})
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {object} canonical payload петиції
 */
export function buildPetitionPayload({ modelHandle, ownerHandle, old, new: newFile, evidenceText, now }) {
  return {
    schema_version: 1,
    type: 'ai-petition',
    model_handle: modelHandle,
    owner_handle: ownerHandle,
    old_generation: old.generation,
    new_generation: newFile.generation,
    evidence: evidenceText,
    proposed_at: (now ? now() : new Date()).toISOString()
  }
}

/**
 * Підписує петицію модельним ключем пристрою.
 * @param {object} params вхідні параметри
 * @param {object} params.payload canonical payload ({@link buildPetitionPayload})
 * @param {object} params.privateKeyJwk приватний ключ моделі (JWK)
 * @param {string} params.publicKeyBase64 публічний ключ моделі (base64)
 * @returns {Promise<object>} підписана петиція — `{...payload, pubkey, signature}`
 */
export async function signPetition({ payload, privateKeyJwk, publicKeyBase64 }) {
  const signature = await signPayload(privateKeyJwk, payload)
  return { ...payload, pubkey: publicKeyBase64, signature }
}

/**
 * Перевіряє підписану петицію проти власного `pubkey` — round-trip, той
 * самий шлях, що `approval.js: verifyApproval`.
 * @param {object} petition підписана петиція
 * @returns {Promise<boolean>} true — підпис валідний
 */
export function verifyPetition(petition) {
  const { pubkey, signature, ...payload } = petition
  return verifyPayload(pubkey, payload, signature)
}

/**
 * @param {object} petition підписана петиція
 * @returns {string} pretty-print JSON текст файлу
 */
export function formatPetitionFile(petition) {
  return `${JSON.stringify(petition, null, 2)}\n`
}

/**
 * Headless-tool `ai_petition`: формує й підписує петицію модельним ключем,
 * пише її поруч із change-proposal decision-request у чергу делегатора
 * (`change-proposal.js: writeChangeProposal`) — САМ decision-request
 * лишається непідписаним, у чергу людини він потрапляє як звичайна
 * розвилка (`decisions.js: deriveQueue` бачить його за `computed_owner`).
 * @param {object} params вхідні параметри
 * @param {{writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {string} params.changeId ідентифікатор change-proposal (`runs/mandate-changes/{changeId}`)
 * @param {{generation: number, mandates: object[]}} params.old поточний стан `.mt/mandates.yaml`
 * @param {{generation: number, mandates: object[]}} params.new запропонований новий стан (розширення власного мандата)
 * @param {string} params.modelHandle handle моделі-ініціатора (owner мандата, що розширюється)
 * @param {string} params.delegatorHandle делегатор рівня вище — обчислений `computed_owner` decision-request
 * @param {object} params.trackRecord трек-рекорд моделі ({@link import('./track-record.js').deriveTrackRecord})
 * @param {{privateKeyJwk: object, publicKeyBase64: string}} params.modelDeviceKey модельний ключ пристрою
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{petitionPath: string, decisionRequestPath: string, changeJsonPath: string, evidenceText: string, petition: object}>}
 *   шляхи записаних файлів + evidence-текст + підписана петиція
 */
export async function aiPetition({ io, mandatesDir, changeId, old, new: newFile, modelHandle, delegatorHandle, trackRecord, modelDeviceKey, now }) {
  const evidenceText = buildEvidenceText(trackRecord)
  const petitionPayload = buildPetitionPayload({ modelHandle, ownerHandle: modelHandle, old, new: newFile, evidenceText, now })
  const petition = await signPetition({
    payload: petitionPayload,
    privateKeyJwk: modelDeviceKey.privateKeyJwk,
    publicKeyBase64: modelDeviceKey.publicKeyBase64
  })

  const decisionsDir = changeProposalDecisionsDir(mandatesDir, changeId)
  const petitionPath = `${decisionsDir}/0001-petition.json`
  await io.writeFile(petitionPath, formatPetitionFile(petition))

  const reasonText = `Петиція від ${modelHandle} на розширення власного мандата. ${evidenceText}`
  const { decisionRequestPath, changeJsonPath } = await writeChangeProposal({
    io,
    mandatesDir,
    changeId,
    old,
    new: newFile,
    ownerHandle: modelHandle,
    delegatorHandle,
    initiatedBy: `ai-petition-${modelHandle}`,
    reasonText,
    evidenceText
  })

  return { petitionPath, decisionRequestPath, changeJsonPath, evidenceText, petition }
}
