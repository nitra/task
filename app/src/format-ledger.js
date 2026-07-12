// Форматування cost ledger (мс/грн/токени) для GUI-таблиці — чисті функції,
// щоб не тримати логіку у шаблоні компонента.

/**
 * Форматує секунди як `Xh Ym Zs` (пропускає нульові старші розряди).
 * @param {number} sec кількість секунд
 * @returns {string} людяне форматування тривалості
 */
export function formatDuration(sec) {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  const r = s % 60
  if (m > 0) return `${m}m ${r}s`
  return `${r}s`
}

/**
 * Форматує вартість у доларах; 0/відсутньо → em-dash (дані ще не пишуться
 * жодною інтеграцією — не плутати з "безкоштовно").
 * @param {number} usd сума в доларах
 * @returns {string} відформатована вартість або '—'
 */
export function formatCost(usd) {
  if (!usd) return '—'
  return `$${usd.toFixed(2)}`
}

/**
 * Форматує кількість токенів у скороченому вигляді (1.2k, 340).
 * @param {number} count кількість токенів
 * @returns {string} відформатоване число або '—'
 */
export function formatTokens(count) {
  if (!count) return '—'
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}
