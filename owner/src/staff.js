// Штаб (docs/specs/260711-owner-app.md): готує рішення до підпису так, щоб
// власник не читав сирі run-журнали. Дві ролі: briefing (контекст, варіанти,
// рекомендація, наслідок відмови) і анти-rubber-stamping (найсильніше
// заперечення проти рішення, яке власник мусить явно побачити перед
// approve). Тут — чиста частина: побудова дайджесту, промпти, парсинг.

/**
 * Текстовий дайджест рішення для LLM: причина в черзі + контракт + (для
 * plan-review) список підзадач.
 * @param {{ decision: object, mission: string, children?: object[] }} input вхідні дані
 * @param {object} input.decision елемент черги (decisions.js)
 * @param {string} input.mission текст місії вузла (mission.js)
 * @param {object[]} [input.children] підзадачі плану (лише plan_review)
 * @returns {string} дайджест
 */
export function buildDecisionDigest({ decision, mission, children }) {
  const rows = [`Вузол: ${decision.node.path} [${decision.node.state}]`, `Причина в черзі: ${decision.headline}`]
  if (mission) rows.push(`Контракт: ${mission}`)
  if (children?.length > 0) {
    rows.push(`План — ${children.length} підзадач:`)
    for (const child of children) rows.push(`- ${child.id} [${child.mode}]: ${child.task ?? ''}`)
  }
  return rows.join('\n')
}

/**
 * Витягує перший JSON-обʼєкт із тексту (толерантно до ```json```-обгортки).
 * @param {string} text сирий content відповіді моделі
 * @returns {object} розібраний обʼєкт
 * @throws {Error} немає JSON-обʼєкта або він битий
 */
function extractJsonObject(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('відповідь штабу без JSON-обʼєкта')
  return JSON.parse(text.slice(start, end + 1))
}

/**
 * Промпт брифу: контекст, варіанти, рекомендація, наслідок відмови.
 * @param {string} digest дайджест рішення
 * @returns {{ system: string, user: string }} пара повідомлень для chat
 */
export function briefingPrompt(digest) {
  return {
    system: [
      'Ти — штаб власника: готуєш рішення з черги до підпису, щоб він не читав сирі журнали.',
      'Дай стислий контекст (2-3 речення), варіанти дій, рекомендацію і що станеться, якщо відхилити.',
      'Не вигадуй фактів, яких немає в дайджесті. Пиши мовою дайджесту.',
      'Відповідай СУВОРО одним JSON-обʼєктом без обгортки: {"context": "...", "options": ["...", "..."], "recommendation": "...", "if_declined": "..."}'
    ].join('\n'),
    user: digest
  }
}

/**
 * Розбирає відповідь брифу; кидає з поясненням при відсутності обовʼязкових полів.
 * @param {string} text сирий content відповіді моделі
 * @returns {{ context: string, options: string[], recommendation: string, ifDeclined: string }} бриф
 */
export function parseBriefing(text) {
  const parsed = extractJsonObject(text)
  for (const field of ['context', 'recommendation', 'if_declined']) {
    if (typeof parsed[field] !== 'string' || parsed[field].trim() === '') {
      throw new Error(`бриф без поля ${field}`)
    }
  }
  const options = Array.isArray(parsed.options) ? parsed.options.filter(o => typeof o === 'string') : []
  return {
    context: parsed.context.trim(),
    options,
    recommendation: parsed.recommendation.trim(),
    ifDeclined: parsed.if_declined.trim()
  }
}

/**
 * Промпт анти-rubber-stamping: найсильніше заперечення проти рішення.
 * @param {string} digest дайджест рішення
 * @returns {{ system: string, user: string }} пара повідомлень для chat
 */
export function objectionPrompt(digest) {
  return {
    system: [
      'Ти — адвокат диявола: власник ось-ось підпише рішення з наведеного дайджесту.',
      'Знайди НАЙСИЛЬНІШЕ конкретне заперечення — ризик, наслідок чи вада, яку легко проґавити поспіхом.',
      'Не вигадуй, якщо дайджесту дійсно бракує підстав для заперечення — тоді напиши, що вагомих заперечень не видно.',
      'Відповідай СУВОРО одним JSON-обʼєктом без обгортки: {"objection": "..."}'
    ].join('\n'),
    user: digest
  }
}

/**
 * Розбирає відповідь заперечення.
 * @param {string} text сирий content відповіді моделі
 * @returns {string} текст заперечення
 * @throws {Error} немає JSON чи порожнє заперечення
 */
export function parseObjection(text) {
  const parsed = extractJsonObject(text)
  if (typeof parsed.objection !== 'string' || parsed.objection.trim() === '') {
    throw new Error('заперечення порожнє')
  }
  return parsed.objection.trim()
}
