// Витягує місію вузла з тексту task.md для LLM-дайджестів (критик, штаб) —
// прибирає HTML-коментарі шаблону й обрізає до ліміту контексту.

const DEFAULT_CHARS = 400

/**
 * Текст секції `## Task` без коментарів-підказок, обрізаний за лімітом.
 * @param {string} taskMdText сирий вміст task.md (порожній — вузол без контракту)
 * @param {number} [maxChars] ліміт символів (замовчування — контекст критика)
 * @returns {string} чиста місія
 */
export function extractMission(taskMdText, maxChars = DEFAULT_CHARS) {
  const text = taskMdText ?? ''
  const body = text.split('## Task', 2)[1] ?? text
  return body
    .replaceAll(/<!--[\s\S]*?-->/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars)
}
