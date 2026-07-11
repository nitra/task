// Черга рішень власника (docs/specs/260711-owner-app.md, M0): одиниця
// інтерфейсу — не задача, а рішення, що чекає на вердикт. Чиста деривація
// над результатом scan; сортування — за ціною помилки (менший stake =
// дорожча помилка = вище в черзі).

const VERDICTS = {
  unresolvable: {
    stake: 0,
    headline: 'спроби вичерпано — гілка стоїть без вердикту',
    actions: ['done']
  },
  failed: {
    stake: 1,
    headline: 'агент вичерпав retry — потрібне втручання',
    actions: ['done']
  },
  stalled: {
    stake: 2,
    headline: 'claim протух — виконавець зник посеред роботи',
    actions: ['done']
  },
  plan_review: {
    stake: 3,
    headline: 'план декомпозиції чекає approve / reject',
    actions: ['approve', 'reject']
  }
}

/**
 * Обходить дерево вузлів воркспейсу і збирає рядки предикатом.
 * @param {object[]} nodes дерево вузлів зі scan
 * @param {(node: object) => object|null} pick повертає payload рядка або null
 * @returns {object[]} зібрані payload-и у порядку обходу
 */
function walk(nodes, pick) {
  const rows = []
  for (const node of nodes ?? []) {
    const payload = pick(node)
    if (payload) rows.push(payload)
    rows.push(...walk(node.children, pick))
  }
  return rows
}

/**
 * Рішення, що чекають власника, з усього лісу — відсортовані за ціною помилки.
 * @param {Array<{ label: string, path: string }>} workspaces воркспейси лісу
 * @param {Record<string, object[]>} forest дерева вузлів за шляхом воркспейсу
 * @returns {Array<{ node: object, workspace: object, stake: number, headline: string, actions: string[] }>} черга рішень
 */
export function collectDecisions(workspaces, forest) {
  const rows = workspaces.flatMap(workspace =>
    walk(forest[workspace.path], node => {
      const verdict = VERDICTS[node.state]
      return verdict ? { node, workspace, ...verdict } : null
    })
  )
  return rows.toSorted((a, b) => a.stake - b.stake)
}

/**
 * Особисті задачі власника — pending h.md-вузли: це робота, не рішення,
 * тож у чергу вони не потрапляють (показуються у брифі).
 * @param {Array<{ label: string, path: string }>} workspaces воркспейси лісу
 * @param {Record<string, object[]>} forest дерева вузлів за шляхом воркспейсу
 * @returns {Array<{ node: object, workspace: object }>} задачі на сьогодні
 */
export function collectPersonal(workspaces, forest) {
  return workspaces.flatMap(workspace =>
    walk(forest[workspace.path], node => (node.state === 'pending' ? { node, workspace } : null))
  )
}
