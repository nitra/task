// ApprovalResponse — mt: docs/architecture/mandates.md «Розширення
// ApprovalResponse» (M6 фаза 0). Схема M1 звужена до полів, які реально
// матеріалізуються файловим моком (docs/specs/260809-delta-app.md, п.5):
// `{ schema_version, request_id, approved, chosen_option, quiz_ref,
// signed_at, pubkey, signature }` — access.md згадує ще `node_hash`/
// `run_token` для гейтів mid-run tool approval/plan-review; вони належать
// git-claim-транспорту, якого файловий мок decision-request М1 не має, тому
// свідомо відсутні тут (не забуті — див. mandates.md: «інваріант діє лише
// для гейту decision-request»).
//
// **Інваріант (mandates.md, «Розширення ApprovalResponse»):** підпис на
// decision-request без `quiz_ref`, або з `quiz_ref` на незавершений квіз
// (немає зафіксованих `iterations`/`time_to_understanding_sec`), —
// невалідний. `buildAndSignApproval` перевіряє це ДО підпису — немає шляху
// отримати підписаний approval повз завершений квіз.

import { signPayload, verifyPayload } from './signing.js'

/**
 * Квіз завершений, коли зафіксовані обидва похідні поля фіналізації
 * (mandates.md: «схема свідомо без passed/failed» — завершеність міряється
 * наявністю `iterations`/`time_to_understanding_sec`, не окремим прапорцем).
 * @param {{iterations?: number, timeToUnderstandingSec?: number}|null|undefined} quiz розібраний квіз-стан (quiz.js: parseQuizFile)
 * @returns {boolean} true — квіз завершено
 */
export function quizIsComplete(quiz) {
  return (
    Boolean(quiz) &&
    Number.isSafeInteger(quiz.iterations) &&
    quiz.iterations >= 1 &&
    typeof quiz.timeToUnderstandingSec === 'number'
  )
}

/**
 * Перевіряє переднапідписні умови — кидає з поясненням, якщо approval
 * писати не можна (mandates.md: «до людини не доходить run failed» —
 * тут навпаки, без квізу до git не доходить підпис).
 * @param {{quiz: object|null, quizRef: string|null, decisionRef: string}} params вхідні дані
 * @returns {void}
 */
export function validateApprovalPreconditions({ quiz, quizRef, decisionRef }) {
  if (!quizRef) {
    throw new Error('ApprovalResponse без quiz_ref недійсний (mandates.md, «Розширення ApprovalResponse»)')
  }
  if (!quizIsComplete(quiz)) {
    throw new Error('квіз не завершено (немає iterations/time_to_understanding_sec) — підпис неможливий')
  }
  if (quiz.decisionRef !== decisionRef) {
    throw new Error(`quiz.decision_ref («${quiz.decisionRef}») не відповідає decision-request («${decisionRef}»)`)
  }
}

/**
 * Складає identity decision-request-а для `request_id` — контракт mt не
 * фіксує окреме поле id у фронтматері decision-request (позиція визначена
 * шляхом `runs/{run-id}/decisions/NNNN-...`), тому `request_id` тут —
 * власна композиція `{runId}/{nnnn}`, стабільна й людинозчитувана
 * (задокументоване рішення M1, docs/specs/260809-delta-app.md, п.5).
 * @param {{runId: string, nnnn: string}} params identity decision-request
 * @returns {string} `request_id`
 */
export function buildRequestId({ runId, nnnn }) {
  return `${runId}/${nnnn}`
}

/**
 * Будує й підписує `ApprovalResponse` — єдина функція, що перевіряє інваріант
 * «квіз завершено» ПЕРЕД підписом (mandates.md). Підписується канонікалізований
 * payload БЕЗ `pubkey`/`signature` (вони додаються після підпису — інакше
 * підпис підписував би сам себе).
 * @param {object} params вхідні дані для побудови й підпису
 * @param {string} params.requestId `request_id` (buildRequestId)
 * @param {string} params.chosenOption обраний варіант (label)
 * @param {string} params.quizRef відносний шлях до квіз-файлу (`decisions/NNNN-quiz.md`)
 * @param {object} params.quiz розібраний завершений квіз-стан
 * @param {string} params.decisionRef `decision_ref` квізу (для перехресної перевірки)
 * @param {object} params.privateKeyJwk приватний ключ пристрою (JWK)
 * @param {string} params.publicKeyBase64 публічний ключ пристрою (base64, включається у файл)
 * @returns {Promise<object>} підписаний `ApprovalResponse`, готовий до серіалізації в `NNNN-approval.json`
 */
export async function buildAndSignApproval({
  requestId,
  chosenOption,
  quizRef,
  quiz,
  decisionRef,
  privateKeyJwk,
  publicKeyBase64
}) {
  validateApprovalPreconditions({ quiz, quizRef, decisionRef })

  const payload = {
    schema_version: 1,
    request_id: requestId,
    approved: true,
    chosen_option: chosenOption,
    quiz_ref: quizRef,
    signed_at: new Date().toISOString()
  }
  const signature = await signPayload(privateKeyJwk, payload)
  return { ...payload, pubkey: publicKeyBase64, signature }
}

/**
 * Перевіряє підписаний `ApprovalResponse` проти публічного ключа —
 * round-trip перевірка того самого канонічного payload, що підписувався
 * (без `pubkey`/`signature`).
 * @param {object} approval підписаний `ApprovalResponse`
 * @returns {Promise<boolean>} true — підпис валідний
 */
export function verifyApproval(approval) {
  const { pubkey, signature, ...payload } = approval
  return verifyPayload(pubkey, payload, signature)
}

/**
 * Серіалізує підписаний approval у канонічний JSON-текст файлу
 * (`NNNN-approval.json`) — читабельний pretty-print, не канонікалізований
 * рядок підпису (той лишається внутрішнім для `signPayload`/`verifyPayload`).
 * @param {object} approval підписаний `ApprovalResponse`
 * @returns {string} JSON-текст файлу
 */
export function formatApprovalFile(approval) {
  return `${JSON.stringify(approval, null, 2)}\n`
}

export { canonicalize } from './signing.js'
