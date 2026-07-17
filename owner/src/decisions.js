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
 * Відкрита (нерозвʼязана) ескалація вузла — остання у серії без вердикту.
 * @param {Array<{ resolved: boolean }>} [series] серія ескалацій вузла
 * @returns {object|null} відкрита ескалація, або null
 */
function openEscalation(series) {
  const last = series?.at(-1)
  return last && !last.resolved ? last : null
}

/**
 * Рішення, що чекають власника, з мого скоупу лісу — відсортовані за ціною
 * помилки. Без scopes (нерозмічений ліс / legacy-виклик) — увесь ліс, як
 * раніше. «Нічия земля» (orphaned) потрапляє в чергу всім із прапорцем —
 * загублена ескалація гірша за зайвий рядок (M5, спека 260714).
 * Маршрутизація ескалацій (M6): вузол із відкритою ескалацією зʼявляється
 * у черзі адресата (незалежно від скоупу — записка адресна) і зникає з
 * черги автора (у нього — рядок «ескальовано, чекає» у брифі).
 * @param {Array<{ label: string, path: string }>} workspaces воркспейси лісу
 * @param {Record<string, object[]>} forest дерева вузлів за шляхом воркспейсу
 * @param {Record<string, { classify: (path: string) => string }>} [scopes] скоуп за шляхом воркспейсу
 * @param {{ escalations?: Record<string, Record<string, object[]>>, me?: string|null }} [routing] ескалації за воркспейсом і моя ідентичність
 * @returns {Array<{ node: object, workspace: object, stake: number, headline: string, actions: string[], orphaned?: boolean, escalation?: object }>} черга рішень
 */
export function collectDecisions(workspaces, forest, scopes, routing) {
  const me = routing?.me ?? null
  const rows = workspaces.flatMap(workspace =>
    walk(forest[workspace.path], node => {
      const open = openEscalation(routing?.escalations?.[workspace.path]?.[node.path])
      if (open && me !== null) {
        if (open.to === me) {
          return {
            node,
            workspace,
            stake: 0,
            headline: `ескалація від ${open.from} — записка чекає на твій вердикт`,
            actions: ['resolve'],
            escalation: open
          }
        }
        // Мій вузол чекає вердикту вгорі — з моєї черги він зникає.
        if (open.from === me) return null
      }
      const verdict = VERDICTS[node.state]
      if (!verdict) return null
      const cls = scopes?.[workspace.path]?.classify(node.path) ?? 'mine'
      if (cls === 'mine') return { node, workspace, ...verdict }
      if (cls === 'orphaned') return { node, workspace, ...verdict, orphaned: true }
      return null
    })
  )
  return rows.toSorted((a, b) => a.stake - b.stake)
}

/**
 * Мої делегування — межові вузли (boundary) мого скоупу: «чого чекаєш ти».
 * Контрактний фасад замовника: сам вузол, його стан і власник — без кухні.
 * @param {Array<{ label: string, path: string }>} workspaces воркспейси лісу
 * @param {Record<string, object[]>} forest дерева вузлів за шляхом воркспейсу
 * @param {Record<string, { classify: (path: string) => string }>} scopes скоуп за шляхом воркспейсу
 * @param {Record<string, Record<string, string>>} ownersByWs розмітка {ws: {nodePath: handle}}
 * @returns {Array<{ node: object, workspace: object, owner: string }>} делеговані гілки
 */
export function collectDelegations(workspaces, forest, scopes, ownersByWs) {
  return workspaces.flatMap(workspace =>
    walk(forest[workspace.path], node =>
      scopes?.[workspace.path]?.classify(node.path) === 'boundary'
        ? { node, workspace, owner: ownersByWs?.[workspace.path]?.[node.path] ?? '?' }
        : null
    )
  )
}

/**
 * Мої відкриті ескалації «вгору» — вузли, що чекають вердикту замовника
 * (рядок «ескальовано, чекає» у брифі автора).
 * @param {Array<{ label: string, path: string }>} workspaces воркспейси лісу
 * @param {Record<string, object[]>} forest дерева вузлів за шляхом воркспейсу
 * @param {Record<string, Record<string, object[]>>} escalations ескалації за воркспейсом
 * @param {string|null} me мій handle
 * @returns {Array<{ node: object, workspace: object, escalation: object }>} чекають вердикту
 */
export function collectEscalatedOut(workspaces, forest, escalations, me) {
  if (me === null || me === undefined) return []
  return workspaces.flatMap(workspace =>
    walk(forest[workspace.path], node => {
      const open = openEscalation(escalations?.[workspace.path]?.[node.path])
      return open && open.from === me ? { node, workspace, escalation: open } : null
    })
  )
}

/**
 * Особисті задачі власника — pending h.md-вузли мого скоупу: це робота,
 * не рішення, тож у чергу вони не потрапляють (показуються у брифі).
 * Чужі й нічийні pending — не мої задачі.
 * @param {Array<{ label: string, path: string }>} workspaces воркспейси лісу
 * @param {Record<string, object[]>} forest дерева вузлів за шляхом воркспейсу
 * @param {Record<string, { classify: (path: string) => string }>} [scopes] скоуп за шляхом воркспейсу
 * @returns {Array<{ node: object, workspace: object }>} задачі на сьогодні
 */
export function collectPersonal(workspaces, forest, scopes) {
  return workspaces.flatMap(workspace =>
    walk(forest[workspace.path], node =>
      node.state === 'pending' && (scopes?.[workspace.path]?.classify(node.path) ?? 'mine') === 'mine'
        ? { node, workspace }
        : null
    )
  )
}
