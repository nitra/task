// Pure helpers for the "create task" flow — kept out of the Vue component so the
// rules (name validation, opts assembly, project→mt mapping) are unit-testable
// and mirror the Rust `create_task` contract (mt-scanner).

/**
 * Whether a char is allowed in a node-name segment (docs/mt.md: `[a-z0-9-]`).
 * Char-by-char check rather than a regex to stay linear and ReDoS-free.
 * @param {string} ch single character
 * @returns {boolean} true when allowed
 */
function isSegmentChar(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch === '-'
}

/**
 * Validate a task node id the same way Rust does before any FS touch.
 * @param {string} name node id; `/` separates nested segments
 * @returns {string|null} human-readable error, or `null` when valid
 */
export function validateTaskName(name) {
  if (!name) return 'Вкажіть назву задачі'
  for (const segment of name.split('/')) {
    if (!segment) return 'Порожній сегмент — приберіть зайвий «/»'
    if ([...segment].some(ch => !isSegmentChar(ch))) return 'Лише a-z, 0-9, «-»; сегменти через «/»'
  }
  return null
}

/**
 * The `mt/` tasks dir for a chosen project root (default `.mt.json` layout).
 * @param {string} projectDir absolute project root path
 * @returns {string} `<projectDir>/mt` with any trailing slashes normalized
 */
export function mtDirFor(projectDir) {
  let end = projectDir.length
  while (end > 0 && projectDir[end - 1] === '/') end--
  return `${projectDir.slice(0, end)}/mt`
}

/**
 * Build the snake_case `opts` payload for `create_task`, dropping empty fields
 * so each one falls back to the project's `.mt.json` default. Agent-only fields
 * (`model_tier`, `skills`) are omitted for human mode.
 * @param {{ mode?: string, modelTier?: string, budgetSec?: (number|string),
 *           hint?: string, deps?: string[], skills?: string[] }} form form state
 * @returns {Record<string, unknown>} opts payload
 */
export function buildCreateOpts(form) {
  const opts = {}
  const isAgent = form.mode === 'agent'

  if (form.mode) opts.mode = form.mode
  if (isAgent && form.modelTier) opts.model_tier = form.modelTier

  const budget = Number(form.budgetSec)
  if (Number.isFinite(budget) && budget > 0) opts.budget_sec = budget

  const hint = form.hint?.trim()
  if (hint) opts.hint = hint

  if (form.deps?.length) opts.deps = form.deps
  if (isAgent && form.skills?.length) opts.skills = form.skills

  return opts
}
