// Розкладка dependency-DAG воркспейсу (спека mt.md: «Ребра — потік даних»)
// у шари: leaf-и (без deps) — шар 0, кожен наступний вузол — на шар глибше
// за найдовшого з його deps. Це окремий граф від composite parent/child
// дерева (яке вже видно в TaskGraph як вкладений список) — тут візуалізуємо
// саме deps-ребра, які досі були лише текстом.

const COLUMN_WIDTH = 200
const ROW_HEIGHT = 64

/**
 * Рекурсивно збирає весь (можливо вкладений) список вузлів у плаский масив.
 * @param {object[]} nodes дерево (з композитними children)
 * @returns {object[]} плаский список усіх вузлів
 */
function flatten(nodes) {
  const out = []
  const walk = list => {
    for (const node of list ?? []) {
      out.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/**
 * Обчислює шар кожного вузла: 0 — немає deps (або жоден dep не знайдено в
 * наборі), інакше 1 + max(шар кожного dep). Захист від циклу (не мав би
 * траплятись за спекою, але дерево можна відредагувати вручну) — вузол, що
 * входить у власний ланцюг обчислення, отримує шар 0 замість зависання.
 * @param {Map<string, object>} byPath вузли за шляхом
 * @returns {Map<string, number>} шар кожного вузла за шляхом
 */
function computeLayers(byPath) {
  const layers = new Map()
  const visiting = new Set()

  const layerOf = path => {
    if (layers.has(path)) return layers.get(path)
    const node = byPath.get(path)
    if (!node || visiting.has(path)) return 0
    visiting.add(path)
    const depLayers = (node.deps ?? []).filter(dep => byPath.has(dep)).map(dep => layerOf(dep))
    const layer = depLayers.length ? Math.max(...depLayers) + 1 : 0
    visiting.delete(path)
    layers.set(path, layer)
    return layer
  }

  for (const path of byPath.keys()) layerOf(path)
  return layers
}

/**
 * Будує layout для DAG-візуалізації: позиції вузлів (за шаром dependency-
 * глибини) + ребра dep → dependent.
 * @param {object[]} nodes дерево воркспейсу (як з scan, з children)
 * @returns {{
 *   nodes: Array<{path: string, id: string, state: string, x: number, y: number}>,
 *   edges: Array<{from: string, to: string}>,
 *   width: number, height: number
 * }} layout для рендеру
 */
export function computeDagLayout(nodes) {
  const flat = flatten(nodes)
  const byPath = new Map(flat.map(n => [n.path, n]))
  const layers = computeLayers(byPath)

  const byLayer = new Map()
  for (const node of flat) {
    const layer = layers.get(node.path) ?? 0
    if (!byLayer.has(layer)) byLayer.set(layer, [])
    byLayer.get(layer).push(node)
  }
  for (const list of byLayer.values()) {
    list.sort((a, b) => a.path.localeCompare(b.path))
  }

  const positioned = []
  let maxLayer = 0
  let maxRows = 0
  for (const [layer, list] of byLayer) {
    maxLayer = Math.max(maxLayer, layer)
    maxRows = Math.max(maxRows, list.length)
    for (const [row, node] of list.entries()) {
      positioned.push({
        path: node.path,
        id: node.id,
        state: node.state,
        x: layer * COLUMN_WIDTH,
        y: row * ROW_HEIGHT
      })
    }
  }

  const edges = []
  for (const node of flat) {
    for (const dep of node.deps ?? []) {
      if (byPath.has(dep)) edges.push({ from: dep, to: node.path })
    }
  }

  return {
    nodes: positioned,
    edges,
    width: (maxLayer + 1) * COLUMN_WIDTH,
    height: (maxRows || 1) * ROW_HEIGHT
  }
}
