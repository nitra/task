// Накладка remote claims на скановане дерево вузлів. Remote claim ref —
// єдине джерело правди щодо ownership (спека mt.md): активний lease →
// running, прострочений (з grace) → stalled. Чиста функція — рекурсивно
// мутує вузли результату scan перед рендером.

/**
 * Накладає claims на дерево: вузол із claim отримує стан running/stalled
 * і поле `claim` ({ actor, runner_id, lease_until }) для відображення.
 * @param {object[]} nodes дерево вузлів воркспейсу (мутується)
 * @param {Array<{ path: string, expired: boolean }>} claims вивід remote_claims
 * @returns {object[]} те саме дерево (для зручності ланцюжків)
 */
export function applyClaims(nodes, claims) {
  if (!claims.length) return nodes
  const byPath = new Map(claims.map(c => [c.path, c]))
  const walk = list => {
    for (const node of list ?? []) {
      const claim = byPath.get(node.path)
      if (claim) {
        node.state = claim.expired ? 'stalled' : 'running'
        node.claim = claim
      }
      walk(node.children)
    }
  }
  walk(nodes)
  return nodes
}
