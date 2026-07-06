// Спільні чисті хелпери над деревом вузлів (вивід scan) — використовуються
// для переходу по deps-ребру, оновлення відкритого вузла після rescan тощо.

/**
 * Рекурсивно шукає вузол за `path` у (можливо вкладеному) дереві.
 * @param {object[]} nodes дерево для пошуку (може бути undefined/порожнім)
 * @param {string} path шлях вузла для пошуку
 * @returns {object|null} знайдений вузол, або null
 */
export function findNodeByPath(nodes, path) {
  for (const node of nodes ?? []) {
    if (node.path === path) return node
    const hit = findNodeByPath(node.children, path)
    if (hit) return hit
  }
  return null
}
