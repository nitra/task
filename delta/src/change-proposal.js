// Change-proposal flow — «Директорська модель, конструктивно в UI» (docs/
// specs/260809-delta-app.md, «Обсяг M3», п.4, конституція п.4: «кнопка
// розширення ШІ-мандата завжди веде до людського підпису з квізом
// найвищої глибини — UI не має іншого шляху»). Розширення мандата НІКОЛИ
// не пише `.mt/mandates.yaml` напряму: матеріалізується як звичайний
// `decision-request` у черзі власника-делегатора
// (`runs/mandate-changes/{id}/decisions/0001-decision-request.md`), що
// проходить ТОЙ САМИЙ M1/M2-конвеєр (`decision-flow.js`: квіз + Ed25519),
// що будь-яка інша розвилка — лише після цього застосовується
// `mandate-change.js: applyMandateChangeIfValid`.
//
// **Форс глибини квізу — задокументоване рішення (за прямою вимогою
// задачі M3).** `leverage_facets` цього decision-request НЕ описують
// реальний ризик зміни мандата (яка часто справді незворотна за наслідками
// — розширений ШІ-мандат діє, доки хтось не звузить назад) — вони СВІДОМО
// форсують `irreversible: false` + `blast_radius: subtree`, щоб
// {@link import('./decisions.js').depthForFacets} мапила на `standard`
// (mandates.md: `subtree` → `decide-and-inform`/середні фасети → квіз
// `standard`) — НАЙВИЩУ глибину, яку M2 реалізує зараз. Причина форсу
// НЕ «subtree — чесна оцінка»: `teach-back` (переказ своїми словами) —
// контрактно правильна глибина для акту такого важеля (mandates.md:
// «зміна мандата = підписаний акт делегування»), але `teach-back`
// лишається M5 (SUPPORTED_DEPTHS у `decision-flow.js` — лише
// `one-tap`/`standard`); вибір `irreversible: false` тут — єдиний спосіб
// уникнути `loadSupportedDecisionRequest` кидання «глибина ще не
// реалізована» на КОЖНІЙ зміні мандата, залишаючись максимально близько
// до контрактного наміру («найвища ДОСТУПНА» глибина, не «найвища
// теоретична»). Коли `teach-back` реалізується (M5), цей форс має
// змінитися на `irreversible: true` — TODO позначено тут явно.
//
// **Машинописна форма diff-у — власне розширення M3, поза буквою
// mandates.md.** Сам decision-request (markdown) несе ЛЮДИНОЧИТАБЕЛЬНИЙ
// опис зміни (для квізу й аудиту), але `validate_mandate_change`
// (`mandate-change.js`) потребує структуровані `old`/`new` знімки файлу —
// вони пишуться сусіднім `0001-change.json` (той самий дух, що `NNNN-quiz.md`
// поруч із `NNNN-decision-request.md`): `{old, new}` у формі
// `mandate-change.js: parseMandatesFile`.

import { applyMandateChangeIfValid, signMandateChangeAct } from './mandate-change.js'

const AXIS_LABELS = {
  refs: 'scope.refs',
  decisionTypes: 'scope.decision_types',
  budgetEur: 'thresholds.budget_eur',
  risk: 'thresholds.risk',
  irreversible: 'thresholds.irreversible',
  audacity: 'thresholds.audacity'
}

/**
 * @param {object|null} value значення осі
 * @returns {string} людиночитабельне представлення (масив → через кому, null → «—»)
 */
function formatAxisValue(value) {
  if (value === null || value === undefined) return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  return String(value)
}

/**
 * Людиночитабельний перелік осей, що змінились між `oldMandate`/`newMandate`
 * — показується в тілі decision-request (## Контекст) для квізу й аудиту.
 * @param {object} oldMandate старий мандат
 * @param {object} newMandate новий мандат
 * @returns {string[]} рядки виду `"thresholds.audacity: medium → high"`
 */
export function describeMandateDiffLines(oldMandate, newMandate) {
  const lines = []
  for (const key of ['refs', 'decisionTypes']) {
    const oldValue = oldMandate.scope[key]
    const newValue = newMandate.scope[key]
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      lines.push(`${AXIS_LABELS[key]}: ${formatAxisValue(oldValue)} → ${formatAxisValue(newValue)}`)
    }
  }
  for (const key of ['budgetEur', 'risk', 'irreversible', 'audacity']) {
    const oldValue = oldMandate.thresholds[key]
    const newValue = newMandate.thresholds[key]
    if (oldValue !== newValue) {
      lines.push(`${AXIS_LABELS[key]}: ${formatAxisValue(oldValue)} → ${formatAxisValue(newValue)}`)
    }
  }
  return lines
}

/**
 * Будує markdown-текст change-proposal decision-request — computed_owner
 * ЗАВЖДИ делегатор рівня вище (єдиний, чий підпис `validate_mandate_change`
 * прийме для розширення), варіанти A (застосувати)/B (відхилити).
 * @param {object} params вхідні параметри
 * @param {{generation: number, mandates: object[]}} params.old поточний стан `.mt/mandates.yaml`
 * @param {{generation: number, mandates: object[]}} params.new запропонований новий стан
 * @param {string} params.ownerHandle owner мандата, що змінюється (модель, чий мандат розширюють)
 * @param {string} params.delegatorHandle делегатор рівня вище — обчислений `computed_owner` цього decision-request
 * @param {string} params.initiatedBy хто ініціював (`recommended_by`) — `ai-petition-{handle}` (модель) або людський handle
 * @param {string} params.reasonText текст обґрунтування («## Рекомендація агента»)
 * @param {string} [params.evidenceText] текст evidence з трек-рекорду (додається до контексту, якщо є)
 * @returns {string} markdown decision-request
 */
export function buildChangeProposalMarkdown({
  old,
  new: newFile,
  ownerHandle,
  delegatorHandle,
  initiatedBy,
  reasonText,
  evidenceText
}) {
  const oldMandate = old.mandates.find(m => m.owner === ownerHandle)
  const newMandate = newFile.mandates.find(m => m.owner === ownerHandle)
  const diffLines = oldMandate && newMandate ? describeMandateDiffLines(oldMandate, newMandate) : []

  const frontmatter = [
    '---',
    'type: decision-request',
    `mandate_generation: ${old.generation}`,
    `computed_owner: ${delegatorHandle}`,
    `escalation_chain: [${delegatorHandle}]`,
    'retry_history: []',
    // Форс глибини — див. заголовок модуля («Форс глибини квізу»).
    'leverage_facets: { irreversible: false, blast_radius: subtree, divergence: high }',
    'deadline_cost: "мандат лишається у старих межах, доки не підписано"',
    `recommended_by: ${initiatedBy}`,
    'decision_type: mandate-change',
    '---',
    ''
  ].join('\n')

  const contextLines = [
    `Запропоновано зміну мандата власника \`${ownerHandle}\` (generation ${old.generation} → ${newFile.generation}).`,
    '',
    'Зміни по осях:',
    ...diffLines.map(l => `- ${l}`)
  ]
  if (evidenceText) contextLines.push('', 'Evidence:', evidenceText)

  const body = [
    '## Контекст',
    '',
    contextLines.join('\n'),
    '',
    '## Варіанти',
    '',
    '### A. Застосувати зміну',
    '',
    `Наслідки: \`.mt/mandates.yaml\` оновлюється (generation ${newFile.generation}), мандат \`${ownerHandle}\` діє за новими межами негайно.`,
    '',
    '### B. Відхилити',
    '',
    `Наслідки: \`.mt/mandates.yaml\` лишається без змін (generation ${old.generation}), мандат \`${ownerHandle}\` діє за старими межами.`,
    '',
    '## Рекомендація агента',
    '',
    reasonText
  ].join('\n')

  return `${frontmatter}${body}\n`
}

/**
 * Run-id change-proposal — ПЛОСКЕ імʼя `mandate-change-{changeId}`, не
 * вкладений сегмент `mandate-changes/{changeId}` (як буквально написано в
 * docs/specs/260809-delta-app.md, «Обсяг M3», п.4). **Задокументоване
 * відхилення від букви задачі:** і CLI-сканер (`bin/delta.mjs:
 * scanDecisionsDirs`), і Rust-команда (`src-tauri/src/lib.rs: scan_decisions`)
 * читають РІВНО один рівень вкладеності — `runs/{run-id}/decisions/`; зміна
 * сканера під двосегментний шлях зачепила б обидві поверхні заради самого
 * лише M3, ризикуючи паритетом CLI/GUI (M0 інваріант) без потреби —
 * плоский run-id несе ту саму інформацію (`mandate-change-{changeId}` так
 * само унікально ідентифікує чергу зміни) без розширення сканера.
 * @param {string} changeId ідентифікатор change-proposal
 * @returns {string} run-id для `runs/{run-id}/decisions/`
 */
export function changeProposalRunId(changeId) {
  return `mandate-change-${changeId}`
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} changeId ідентифікатор change-proposal
 * @returns {string} абсолютний шлях до `decisions/`-директорії цього change-proposal
 */
export function changeProposalDecisionsDir(mandatesDir, changeId) {
  return `${mandatesDir}/runs/${changeProposalRunId(changeId)}/decisions`
}

/**
 * Пише decision-request + сусідній `0001-change.json` (машинописний
 * `{old, new}` — див. заголовок модуля) у чергу делегатора.
 * @param {object} params вхідні параметри
 * @param {{writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {string} params.changeId ідентифікатор change-proposal
 * @param {{generation: number, mandates: object[]}} params.old поточний стан `.mt/mandates.yaml`
 * @param {{generation: number, mandates: object[]}} params.new запропонований новий стан
 * @param {string} params.ownerHandle owner мандата, що змінюється
 * @param {string} params.delegatorHandle делегатор рівня вище (computed_owner)
 * @param {string} params.initiatedBy хто ініціював (recommended_by)
 * @param {string} params.reasonText обґрунтування
 * @param {string} [params.evidenceText] evidence-текст (ШІ-петиція)
 * @returns {Promise<{decisionRequestPath: string, changeJsonPath: string}>} шляхи записаних файлів
 */
export async function writeChangeProposal({
  io,
  mandatesDir,
  changeId,
  old,
  new: newFile,
  ownerHandle,
  delegatorHandle,
  initiatedBy,
  reasonText,
  evidenceText
}) {
  const decisionsDir = changeProposalDecisionsDir(mandatesDir, changeId)
  const decisionRequestPath = `${decisionsDir}/0001-decision-request.md`
  const changeJsonPath = `${decisionsDir}/0001-change.json`
  const markdown = buildChangeProposalMarkdown({
    old,
    new: newFile,
    ownerHandle,
    delegatorHandle,
    initiatedBy,
    reasonText,
    evidenceText
  })
  await io.writeFile(decisionRequestPath, markdown)
  await io.writeFile(changeJsonPath, `${JSON.stringify({ old, new: newFile }, null, 2)}\n`)
  return { decisionRequestPath, changeJsonPath }
}

/**
 * Читає `0001-change.json`, записаний {@link writeChangeProposal}.
 * @param {{readFile: (path: string) => Promise<string|null>}} io fs-транспорт
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} changeId ідентифікатор change-proposal
 * @returns {Promise<{old: object, new: object}|null>} `{old, new}`, або null — не знайдено
 */
export async function readChangeProposal(io, mandatesDir, changeId) {
  const path = `${changeProposalDecisionsDir(mandatesDir, changeId)}/0001-change.json`
  const text = await io.readFile(path)
  return text ? JSON.parse(text) : null
}

/**
 * Застосовує change-proposal ПІСЛЯ того, як людина пройшла звичайний
 * M1/M2-конвеєр (`decision-flow.js: decisionApprove`) і підписала
 * `ApprovalResponse` на цьому decision-request. Це — МІСТ між двома
 * незалежними крипто-схемами цього застосунку: квіз-гейт підписує
 * `{request_id, approved, chosen_option, quiz_ref, ...}` (`approval.js`),
 * а `validate_mandate_change` (`mandate-change.js`) підписує окремий акт
 * `{old_generation, new_generation, new_file}` — той самий ФІЗИЧНИЙ ключ
 * пристрою підписує ОБИДВА (одна людська дія, два криптографічно незалежні
 * підтвердження: «я зрозуміла це рішення» + «я авторизую цю мутацію
 * мандата»). `chosen_option !== 'A'` (відхилено) — mandates.yaml НЕ
 * чіпається, повертається `{valid: false}` без спроби підпису.
 * @param {object} params вхідні параметри
 * @param {{writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт `.mt/mandates.yaml`
 * @param {string} params.mandatesYamlPath абсолютний шлях до `.mt/mandates.yaml`
 * @param {{generation: number, mandates: object[]}} params.old поточний стан
 * @param {{generation: number, mandates: object[]}} params.new запропонований новий стан
 * @param {object} params.approval підписаний `ApprovalResponse` decision-request (approval.js)
 * @param {string} params.handle handle підписанта (делегатор, що щойно пройшов квіз)
 * @param {'human'} params.role роль ключа — ЗАВЖДИ `'human'` (підпис зміни мандата ніколи не модельний)
 * @param {{privateKeyJwk: object, publicKeyBase64: string}} params.deviceKey ключ пристрою (той самий, що підписав approval)
 * @param {object[]} [params.extraSignatures] додаткові підписи акта зміни (напр. другий підпис при зміні escalates_to)
 * @param {string} [params.appliedMarkerPath] абсолютний шлях до `0001-applied.json` — переданий, лише коли викликач
 *   хоче зафіксувати «застосовано» (M6, `report.js`: «рух межі» скановує САМЕ цей маркер, не сам факт мутації
 *   mandates.yaml — той самий run-каталог, що decision-request, тримає повний слід «коли й хто застосував»)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{valid: true}|{valid: false, reason: string}>} вердикт застосування
 */
export async function applyMandateChangeProposal({
  io,
  mandatesYamlPath,
  old,
  new: newFile,
  approval,
  handle,
  role,
  deviceKey,
  extraSignatures = [],
  appliedMarkerPath,
  now
}) {
  if (!approval?.approved || approval.chosen_option !== 'A') {
    return {
      valid: false,
      reason: 'change-proposal не підписано варіантом A (застосувати) — mandates.yaml не змінюється'
    }
  }
  const signature = await signMandateChangeAct({
    oldGeneration: old.generation,
    newFile,
    handle,
    role,
    privateKeyJwk: deviceKey.privateKeyJwk,
    publicKeyBase64: deviceKey.publicKeyBase64
  })
  const verdict = await applyMandateChangeIfValid({
    io,
    mandatesYamlPath,
    old,
    new: newFile,
    signatures: [...extraSignatures, signature]
  })
  if (verdict.valid && appliedMarkerPath) {
    const appliedAt = (now ? now() : new Date()).toISOString()
    await io.writeFile(appliedMarkerPath, `${JSON.stringify({ appliedAt, handle, role }, null, 2)}\n`)
  }
  return verdict
}

/**
 * Звуження ШІ-мандата — «без квіза, самопідпис, одразу»
 * (docs/specs/260809-delta-app.md, «Обсяг M3», п.3 «Довіряю»: кнопка
 * «звузити»). На відміну від {@link applyMandateChangeProposal}, тут НЕМАЄ
 * decision-request/квіз-конвеєра — власник мандата вище підписує напряму
 * (той самий шлях, що `mandate-change.js`-тести «звуження із самопідписом»).
 * @param {object} params вхідні параметри
 * @param {{writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт `.mt/mandates.yaml`
 * @param {string} params.mandatesYamlPath абсолютний шлях до `.mt/mandates.yaml`
 * @param {{generation: number, mandates: object[]}} params.old поточний стан
 * @param {{generation: number, mandates: object[]}} params.new звужений новий стан
 * @param {string} params.handle handle підписанта (owner мандата, що звужується — самопідпис)
 * @param {'human'|'model'} params.role роль ключа самопідписанта (`kind: model` owner підписує МОДЕЛЬНИМ ключем — validate_mandate_change не вимагає ролі для звуження, це лише чесна атрибуція)
 * @param {{privateKeyJwk: object, publicKeyBase64: string}} params.deviceKey ключ пристрою
 * @returns {Promise<{valid: true}|{valid: false, reason: string}>} вердикт застосування
 */
export async function applyMandateNarrow({ io, mandatesYamlPath, old, new: newFile, handle, role, deviceKey }) {
  const signature = await signMandateChangeAct({
    oldGeneration: old.generation,
    newFile,
    handle,
    role,
    privateKeyJwk: deviceKey.privateKeyJwk,
    publicKeyBase64: deviceKey.publicKeyBase64
  })
  return applyMandateChangeIfValid({ io, mandatesYamlPath, old, new: newFile, signatures: [signature] })
}
