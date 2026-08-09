// Штаб — бриф перед рішенням (M5, docs/specs/260809-delta-app.md, «Обсяг
// M5», п.2; ідея запозичена з owner-спеки 260711, розділ «Три LLM-ролі» →
// «Штаб (briefing перед рішенням)»: «контекст на три речення, варіанти,
// рекомендація, «що станеться при відмові»... анти-rubber-stamping: перед
// підписом UI показує найсильніше заперечення... підпис означає «я бачив
// контраргумент», а не «я клікнув»» — той самий принцип тут: генератор
// брифу СТИСКАЄ decision-request у {контекст 3 речення, варіанти з ціною
// одним рядком кожен, рекомендація + найсильніше заперечення проти НЕЇ,
// ціна зволікання}.
//
// **Лінива кнопка «Бриф»** — на відміну від квіз-гейта (обов'язковий крок),
// бриф ОПЦІЙНИЙ і ЯВНО запитуваний (tool `decision_brief`): не блокує
// підпис, не генерується автоматично при відкритті картки (ціна виклику
// LLM — лише коли власник її хоче).
//
// **Фолбек без LLM — структурний витяг, чесно позначений** (задачний
// текст, буквально): без стискання — заголовки й фронтматер-поля
// decision-request як є (context.slice, options 1:1 label+title,
// рекомендація повністю), `generatedBy: 'staff-brief-fallback'`,
// `compressed: false`. Немає найсильнішого заперечення у фолбеці —
// генерація контраргументу ПОТРЕБУЄ моделі (структурний витяг з полів не
// може «вигадати» заперечення, якого немає в тексті) — задокументоване
// обмеження, той самий принцип, що quiz.js: немає детермінованого фолбека
// там, де завдання принципово вимагає LLM-судження.

const DEFAULT_LLM_CONFIG = Object.freeze({ baseUrl: 'http://127.0.0.1:8080', model: 'gemma-4-26b-a4b-it' })
const TRAILING_SLASH_RE = /\/$/

/**
 * @returns {{baseUrl: string, model: string}} дефолтний конфіг локального LLM-ендпоінта (той самий, що quiz.js)
 */
export function defaultStaffLlmConfig() {
  return { ...DEFAULT_LLM_CONFIG }
}

const STAFF_SYSTEM_PROMPT =
  'Ти — Штаб системи «Дельта»: стискаєш decision-request у бриф ПЕРЕД тим, як власник його підпише (owner-спека ' +
  '260711, «Штаб»). Анти-rubber-stamping — обов\'язково знайди НАЙСИЛЬНІШЕ заперечення проти рекомендації агента, ' +
  'навіть якщо рекомендація виглядає правильною; власник має побачити контраргумент, а не лише підтвердження. ' +
  'Поверни СТРОГО JSON без пояснень поза ним: {"contextSummary": string, "options": [{"label": string, ' +
  '"priceLine": string}], "recommendationSummary": string, "strongestObjection": string, "delaySummary": string}. ' +
  'contextSummary — РІВНО 3 речення; options — по одному рядку-ціні на кожен варіант decision-request (наслідок + ' +
  'ризик одним реченням); recommendationSummary — одне речення, чому агент рекомендує цей варіант; ' +
  'strongestObjection — найсильніше заперечення ПРОТИ рекомендації (не проти рішення взагалі); delaySummary — ' +
  'ціна зволікання одним реченням (з deadline_cost, якщо є, або з наслідків затримки).'

/**
 * Формує user-промпт зі всього тіла decision-request — той самий підхід,
 * що `quiz.js: buildQuizPrompt`, без обраного варіанта (бриф читається ДО
 * вибору — допомагає обрати, не перевіряє розуміння вибраного).
 * @param {object} decisionRequest розібраний decision-request (`decisions.js`)
 * @returns {string} промпт
 */
export function buildStaffBriefPrompt(decisionRequest) {
  const optionsText = decisionRequest.options.map(o => `### ${o.label}. ${o.title}\n${o.body}`).join('\n\n')
  return [
    `## Контекст\n${decisionRequest.context}`,
    `## Варіанти\n${optionsText}`,
    `## Рекомендація агента\n${decisionRequest.recommendation}`,
    `## Ціна затримки\n${decisionRequest.deadlineCost ?? 'не вказана'}`
  ].join('\n\n')
}

/**
 * @param {unknown} payload розпарсений JSON від LLM
 * @returns {boolean} true — форма валідна
 */
function isValidBriefPayload(payload) {
  return Boolean(
    payload &&
    typeof payload.contextSummary === 'string' &&
    payload.contextSummary.trim() &&
    Array.isArray(payload.options) &&
    payload.options.length > 0 &&
    payload.options.every(o => o && typeof o.label === 'string' && typeof o.priceLine === 'string' && o.priceLine.trim()) &&
    typeof payload.recommendationSummary === 'string' &&
    payload.recommendationSummary.trim() &&
    typeof payload.strongestObjection === 'string' &&
    payload.strongestObjection.trim() &&
    typeof payload.delaySummary === 'string' &&
    payload.delaySummary.trim()
  )
}

/**
 * Викликає локальний ендпоінт для генерації брифу. Той самий контракт
 * помилок, що `quiz.js: callLlmQuizGenerator` — мережева/парсингова
 * помилка, недоступний ендпоінт, чи невалідна форма повертає `null`, не
 * кидає; викликач (`decisionBrief`) переходить на структурний фолбек.
 * @param {{baseUrl: string, model: string}} llmConfig адреса й модель ендпоінта
 * @param {object} decisionRequest розібраний decision-request
 * @param {typeof fetch} [fetchImpl] ін'єкція fetch (тести)
 * @returns {Promise<{contextSummary: string, options: {label: string, priceLine: string}[], recommendationSummary: string,
 *   strongestObjection: string, delaySummary: string, generatedBy: string}|null>} бриф, або `null`
 */
export async function callLlmStaffBrief(llmConfig, decisionRequest, fetchImpl = fetch) {
  const config = llmConfig ?? defaultStaffLlmConfig()
  try {
    const response = await fetchImpl(`${config.baseUrl.replace(TRAILING_SLASH_RE, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: STAFF_SYSTEM_PROMPT },
          { role: 'user', content: buildStaffBriefPrompt(decisionRequest) }
        ]
      })
    })
    if (!response.ok) return null
    const data = await response.json()
    const raw = data?.choices?.[0]?.message?.content
    if (typeof raw !== 'string') return null
    const parsed = JSON.parse(raw)
    if (!isValidBriefPayload(parsed)) return null
    return {
      contextSummary: parsed.contextSummary.trim(),
      options: parsed.options.map(o => ({ label: String(o.label).trim(), priceLine: o.priceLine.trim() })),
      recommendationSummary: parsed.recommendationSummary.trim(),
      strongestObjection: parsed.strongestObjection.trim(),
      delaySummary: parsed.delaySummary.trim(),
      generatedBy: `staff-brief-${config.model}`
    }
  } catch {
    return null
  }
}

/**
 * Структурний фолбек-бриф без LLM (ендпоінт недоступний) — БЕЗ стискання,
 * чесно позначений `compressed: false` (заголовок модуля). Немає
 * `strongestObjection` — `null`, той самий чесний підхід, що
 * `quiz.js: TEACHBACK_UNAVAILABLE_MESSAGE` (не вигадуємо те, чого не можна
 * вивести без LLM-судження).
 * @param {object} decisionRequest розібраний decision-request
 * @returns {{contextSummary: string, options: {label: string, priceLine: string}[], recommendationSummary: string,
 *   strongestObjection: null, delaySummary: string, generatedBy: string}} структурний бриф
 */
export function fallbackStaffBrief(decisionRequest) {
  return {
    contextSummary: decisionRequest.context,
    options: decisionRequest.options.map(o => ({ label: o.label, priceLine: `${o.title} — ${o.body}`.trim() })),
    recommendationSummary: decisionRequest.recommendation,
    strongestObjection: null,
    delaySummary: decisionRequest.deadlineCost ?? 'не вказана',
    generatedBy: 'staff-brief-fallback'
  }
}

/**
 * Повний потік `decision_brief`: спершу LLM ({@link callLlmStaffBrief}),
 * недоступний — структурний фолбек ({@link fallbackStaffBrief}). Обидва
 * шляхи повертають однакову форму плюс `compressed` (true — LLM реально
 * стиснув; false — фолбек, чесно позначений).
 * @param {{decisionRequest: object, llmConfig?: {baseUrl: string, model: string}, fetchImpl?: typeof fetch}} params вхідні параметри
 * @returns {Promise<object>} бриф
 */
export async function decisionBrief({ decisionRequest, llmConfig, fetchImpl }) {
  const brief = await callLlmStaffBrief(llmConfig ?? defaultStaffLlmConfig(), decisionRequest, fetchImpl)
  if (brief) return { ...brief, compressed: true }
  return { ...fallbackStaffBrief(decisionRequest), compressed: false }
}
