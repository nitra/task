// Індикатор `[slots: X/agent_concurrency]` (спека mt.md, «Ліміти worktree») —
// скільки агентських вузлів воркспейсу зараз running.

/**
 * Рахує вузли у стані `running` в (можливо вкладеному) дереві.
 * @param {object[]} nodes дерево вузлів воркспейсу
 * @returns {number} кількість running-вузлів
 */
export function countRunning(nodes) {
  let count = 0
  const walk = list => {
    for (const node of list ?? []) {
      if (node.state === 'running') count++
      walk(node.children)
    }
  }
  walk(nodes)
  return count
}
