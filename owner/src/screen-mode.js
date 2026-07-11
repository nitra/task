// Адаптивний перший екран (docs/specs/260711-owner-app.md): режим обирає
// детерміноване правило, не LLM. Порядок фіксований — Рішення → Бриф → Карта;
// заголовок завжди оголошує режим і причину, щоб адаптивність лишалась
// передбачуваною.

/**
 * Українська множина: 1 рішення, 2–4 рішення, 5+ рішень.
 * @param {number} n кількість
 * @returns {string} слово «рішення» у правильній формі
 */
function decisionsWord(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'рішення'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'рішення'
  return 'рішень'
}

/**
 * Обирає режим першого екрана і заголовок-пояснення.
 * @param {{ decisionCount: number, deltaCount: number }} counts лічильники стану
 * @returns {{ mode: 'decisions'|'brief'|'map', headline: string }} режим + причина
 */
export function chooseMode({ decisionCount, deltaCount }) {
  if (decisionCount > 0) {
    const word = decisionsWord(decisionCount)
    const verb = decisionCount === 1 ? 'чекає' : 'чекають'
    return { mode: 'decisions', headline: `${decisionCount} ${word} ${verb} на тебе` }
  }
  if (deltaCount > 0) {
    return { mode: 'brief', headline: 'Рішень немає — ось що змінилось із минулого візиту' }
  }
  return { mode: 'map', headline: 'Тихо: ні рішень, ні змін — карта портфеля' }
}
