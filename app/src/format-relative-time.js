const UNITS = [
  { limit: 60, divisor: 1, label: 's' },
  { limit: 3600, divisor: 60, label: 'm' },
  { limit: 86400, divisor: 3600, label: 'h' },
  { limit: 2592000, divisor: 86400, label: 'd' },
  { limit: Infinity, divisor: 2592000, label: 'mo' }
]

/**
 * Format an ISO8601 timestamp as a short relative-time label (e.g. '3h ago').
 * @param {string} isoString ISO8601 timestamp, or '' for "no data"
 * @returns {string} relative label, or '—' when `isoString` is empty/invalid
 */
export function formatRelativeTime(isoString) {
  if (!isoString) return '—'
  const then = Date.parse(isoString)
  if (Number.isNaN(then)) return '—'
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (seconds < 30) return 'just now'
  const unit = UNITS.find(u => seconds < u.limit)
  const value = Math.floor(seconds / unit.divisor)
  return `${value}${unit.label} ago`
}
