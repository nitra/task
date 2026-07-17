// Критик (M2, docs/specs/260711-owner-app.md): шукає вади плану і виконання,
// яких не бачить виконавець зсередини своєї гілки. Тут — детермінована
// частина (без LLM): чисті правила над результатом scan. Межа з принципу
// ретро-циклу: критик аналізує граф (контракти, стани, залежності),
// НЕ персональну ефективність виконавців.

// Скільки вузол може стояти без прогресу, перш ніж це вада (мс).
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

// Стани, у яких вузол ще не дав результату.
const UNRESOLVED = new Set(['unassigned', 'pending', 'waiting', 'blocked'])

// Стани-небіжчики: залежати від такого вузла — чекати вічно.
const DEAD = new Set(['unresolvable', 'failed'])

/**
 * Плаский індекс вузлів дерева: шлях → вузол.
 * @param {object[]} nodes дерево вузлів зі scan
 * @returns {Map<string, object>} індекс за шляхом
 */
function indexNodes(nodes) {
  const map = new Map()
  const visit = list => {
    for (const node of list ?? []) {
      map.set(node.path, node)
      visit(node.children)
    }
  }
  visit(nodes)
  return map
}

/**
 * Розвʼязує dep-ідентифікатор відносно вузла: сусід у батьківській теці
 * або абсолютний шлях від кореня tasks-директорії.
 * @param {string} nodePath шлях вузла-власника deps
 * @param {string} dep dep-ідентифікатор із deps/
 * @param {Map<string, object>} index індекс вузлів
 * @returns {object|undefined} вузол-залежність, якщо знайдено
 */
function resolveDep(nodePath, dep, index) {
  const parent = nodePath.includes('/') ? nodePath.slice(0, nodePath.lastIndexOf('/')) : ''
  return index.get(parent ? `${parent}/${dep}` : dep) ?? index.get(dep)
}

/**
 * Правило: дедлайн вузла минув, а результату немає.
 * @param {object} node вузол
 * @param {number} now поточний час (ms epoch)
 * @returns {string|null} знахідка або null
 */
function deadlinePassed(node, now) {
  if (!node.deadline || node.state === 'resolved') return null
  const deadline = Date.parse(node.deadline)
  if (Number.isNaN(deadline) || deadline > now) return null
  return `дедлайн ${node.deadline} минув, а вузол у стані ${node.state}`
}

/**
 * Правило: вузол чекає на мертву залежність (failed/unresolvable/зниклу).
 * @param {object} node вузол
 * @param {Map<string, object>} index індекс вузлів
 * @returns {string|null} знахідка або null
 */
function deadDependency(node, index) {
  if (!UNRESOLVED.has(node.state)) return null
  for (const dep of node.deps ?? []) {
    const target = resolveDep(node.path, dep, index)
    if (!target) return `залежність ${dep} не існує у графі — гілка не стартує ніколи`
    if (DEAD.has(target.state)) {
      return `залежність ${dep} у термінальному стані ${target.state} — гілка чекає вічно`
    }
  }
  return null
}

// Стани, у яких «стоїть давно» — вада: без виконавця або без спроб.
const STALLABLE = new Set(['unassigned', 'waiting', 'blocked'])

/**
 * Правило: гілка давно без прогресу — unassigned/waiting/blocked без дітей
 * довше за поріг (pending не рахуємо: то особиста задача людини, вона у брифі).
 * @param {object} node вузол
 * @param {number} now поточний час (ms epoch)
 * @returns {string|null} знахідка або null
 */
function staleBranch(node, now) {
  if (!STALLABLE.has(node.state)) return null
  if ((node.children ?? []).length > 0 || !node.created_at) return null
  const created = Date.parse(node.created_at)
  if (Number.isNaN(created) || now - created < STALE_AFTER_MS) return null
  const days = Math.floor((now - created) / (24 * 60 * 60 * 1000))
  const cause = node.state === 'unassigned' ? 'виконавця так і не призначено' : 'спроб немає'
  return `${days} дн. без прогресу (створено ${node.created_at}, ${cause})`
}

/**
 * Пошук циклів взаємного очікування у deps-графі нерозвʼязаних вузлів.
 * @param {Map<string, object>} index індекс вузлів
 * @returns {string[][]} знайдені цикли (списки шляхів)
 */
function dependencyCycles(index) {
  const cycles = []
  const state = new Map() // шлях → 'visiting' | 'done'
  const walk = (node, trail) => {
    const mark = state.get(node.path)
    if (mark === 'done') return
    if (mark === 'visiting') {
      // trail завершується повторним входом у node — без нього цикл чистий.
      cycles.push(trail.slice(trail.indexOf(node.path), -1))
      return
    }
    state.set(node.path, 'visiting')
    for (const dep of node.deps ?? []) {
      const target = resolveDep(node.path, dep, index)
      if (target && UNRESOLVED.has(target.state)) walk(target, [...trail, target.path])
    }
    state.set(node.path, 'done')
  }
  for (const node of index.values()) {
    if (UNRESOLVED.has(node.state)) walk(node, [node.path])
  }
  return cycles
}

/**
 * Детермінований прогін критика по моєму скоупу лісу (M6, спека 260714):
 * мої й нічийні вузли — всі правила; межові (делеговані) — лише контрактна
 * поверхня (дедлайн, мертва залежність) — кухня делегата не аналізується;
 * чужі (foreign) — вердикти не генеруються взагалі. Індекс вузлів лишається
 * повним: залежність у чужу гілку — не «мертва». Без scopes — увесь ліс.
 * @param {Array<{ label: string, path: string }>} workspaces воркспейси лісу
 * @param {Record<string, object[]>} forest дерева вузлів за шляхом воркспейсу
 * @param {number} now поточний час (ms epoch) — параметром заради тестованості
 * @param {Record<string, { classify: (path: string) => string }>} [scopes] скоуп за шляхом воркспейсу
 * @returns {Array<{ workspace: object, path: string, rule: string, finding: string, stake: number }>} вердикти
 */
export function runDeterministicCritic(workspaces, forest, now, scopes) {
  const verdicts = []
  for (const workspace of workspaces) {
    const classify = path => scopes?.[workspace.path]?.classify(path) ?? 'mine'
    const index = indexNodes(forest[workspace.path])
    for (const node of index.values()) {
      verdicts.push(...nodeVerdicts(node, classify(node.path), index, now).map(v => ({ workspace, ...v })))
    }
    for (const cycle of dependencyCycles(index)) {
      // Цикл звітується з боку мого вузла; цикл цілком у чужій кухні — не мій.
      const anchor = cycle.find(path => classify(path) !== 'foreign')
      if (!anchor) continue
      verdicts.push({
        workspace,
        path: anchor,
        rule: 'dependency-cycle',
        finding: `взаємне очікування: ${cycle.join(' → ')} → ${cycle[0]}`,
        stake: 0
      })
    }
  }
  return verdicts.toSorted((a, b) => a.stake - b.stake)
}

/**
 * Вердикти правил одного вузла з огляду на його клас у скоупі.
 * @param {object} node вузол
 * @param {string} cls клас вузла ('mine'|'boundary'|'foreign'|'orphaned')
 * @param {Map<string, object>} index індекс вузлів
 * @param {number} now поточний час (ms epoch)
 * @returns {Array<{ path: string, rule: string, finding: string, stake: number }>} вердикти вузла
 */
function nodeVerdicts(node, cls, index, now) {
  if (cls === 'foreign') return []
  const found = []
  const dead = deadDependency(node, index)
  if (dead) found.push({ path: node.path, rule: 'dead-dependency', finding: dead, stake: 0 })
  const deadline = deadlinePassed(node, now)
  if (deadline) found.push({ path: node.path, rule: 'deadline-passed', finding: deadline, stake: 1 })
  if (cls === 'boundary') return found
  const stale = staleBranch(node, now)
  if (stale) found.push({ path: node.path, rule: 'stale-branch', finding: stale, stake: 2 })
  return found
}

/**
 * Розбирає відповідь семантичного критика (LLM) у вердикти; невалідні
 * елементи мовчки відкидаються — шум моделі не має валити прогін.
 * @param {string} text сирий content відповіді моделі
 * @param {{ label: string, path: string }} workspace воркспейс прогону
 * @returns {Array<{ workspace: object, path: string, rule: string, finding: string, stake: number }>} вердикти
 */
export function parseCriticReply(text, workspace) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  let parsed
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  // severity 1|2 моделі мапиться на ставку 1|2, решта (та сміття) — 3.
  const STAKE_BY_SEVERITY = { 1: 1, 2: 2 }
  return parsed
    .filter(v => typeof v?.path === 'string' && typeof v?.finding === 'string' && v.finding.trim() !== '')
    .map(v => ({
      workspace,
      path: v.path,
      rule: 'semantic',
      finding: v.finding.trim(),
      stake: STAKE_BY_SEVERITY[v.severity] ?? 3
    }))
}

/**
 * Промпт семантичного критика для одного воркспейсу.
 * @param {string} digest текстовий дайджест графа (вузли + місії)
 * @returns {{ system: string, user: string }} пара повідомлень для chat
 */
export function criticPrompt(digest) {
  return {
    system: [
      'Ти — критик графа задач: шукаєш вади плану, яких не бачить виконавець зсередини своєї гілки.',
      'Шукай ЛИШЕ: дублювання роботи між гілками; суперечності цілей; задачі, що втратили сенс через стан сусідів; ризики, що вже матеріалізувалися.',
      'НЕ оцінюй людей і їхню швидкість — лише план і структуру. Не вигадуй вад: немає впевненості — не звітуй.',
      'Відповідай СУВОРО JSON-масивом (можливо порожнім) без обгортки: [{"path": "шлях вузла", "severity": 1|2|3, "finding": "вада одним-двома реченнями"}]. severity 1 — найкритичніше.'
    ].join('\n'),
    user: digest
  }
}
