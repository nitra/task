// Attention inbox: вузли, що чекають рішення людини (спека mt.md — шість
// людських точок протоколу). Чиста функція над результатом scan —
// GUI-аналог нагадувань `mt watch`.

// Причина + вага (менше = терміновіше) для станів, де діє людина.
const ATTENTION = {
  unresolvable: { order: 0, reason: 'attempts exhausted — human decision' },
  failed: { order: 1, reason: 'agent retries exhausted' },
  stalled: { order: 2, reason: 'claim lease expired' },
  plan_review: { order: 3, reason: 'plan awaits approve / reject' },
  pending: { order: 4, reason: 'awaiting human executor' },
  unassigned: { order: 5, reason: 'no executor assigned' }
}

/**
 * Збирає вузли, що потребують людини, з усіх воркспейсів (рекурсивно по
 * children), відсортовані за терміновістю.
 * @param {Array<{ label: string, path: string }>} workspaces воркспейси зі scan
 * @param {Record<string, object[]>} workspaceNodes дерева вузлів за шляхом воркспейсу
 * @returns {Array<{ node: object, workspace: object, reason: string }>} рядки inbox
 */
export function collectAttention(workspaces, workspaceNodes) {
  const rows = []
  for (const workspace of workspaces) {
    const walk = nodes => {
      for (const node of nodes ?? []) {
        const entry = ATTENTION[node.state]
        if (entry) rows.push({ node, workspace, reason: entry.reason, order: entry.order })
        walk(node.children)
      }
    }
    walk(workspaceNodes[workspace.path])
  }
  rows.sort((a, b) => a.order - b.order)
  return rows.map(({ node, workspace, reason }) => ({ node, workspace, reason }))
}
