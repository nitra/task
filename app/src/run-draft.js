// run-draft.md парсер (спека mt.md: агент веде ## Completed / ## Blockers /
// ## Next Attempt під час виконання) — для live-стрічки GUI поки вузол running.

/**
 * Витягує секцію `## <name>` із markdown-тексту run-draft.md.
 * @param {string} text вміст run-draft.md
 * @param {string} name назва секції без `##`, напр. `Completed`
 * @returns {string|null} тіло секції (trimmed), або null якщо відсутня/порожня
 */
function section(text, name) {
  const header = `## ${name}`
  const lines = text.split('\n')
  let inside = false
  const out = []
  for (const line of lines) {
    if (line.trim() === header) {
      inside = true
      continue
    }
    if (inside) {
      if (line.startsWith('## ')) break
      out.push(line)
    }
  }
  const body = out.join('\n').trim()
  return body || null
}

/**
 * Розбирає run-draft.md на секції прогресу для live-стрічки.
 * @param {string} text вміст run-draft.md (може бути порожнім)
 * @returns {{ completed: string|null, blockers: string|null, nextAttempt: string|null }} секції
 */
export function parseRunDraft(text) {
  return {
    completed: section(text, 'Completed'),
    blockers: section(text, 'Blockers'),
    nextAttempt: section(text, 'Next Attempt')
  }
}
