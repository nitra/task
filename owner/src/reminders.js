// Нагадування (M7, спека 260714, п. 12): три детерміновані правила з уже
// наявного deadline контракту — жодної нової сутності і жодного LLM.
// Спільне (deadline) живе у git; персональне (snooze — «коли мені нагадати»)
// — локально per-identity, щоб ритм людини не ставав паноптикум-витоком.

// Скільки діб відкрита ескалація на мою адресу може чекати без реакції.
export const ESCALATION_STALE_DAYS = 3

// Горизонт «дедлайн насувається» для deadline_due.
const DUE_HORIZON_MS = 24 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

// Стани, в яких вузол ще не дав результату (дзеркалить критика).
const UNRESOLVED = new Set(['unassigned', 'pending', 'waiting', 'blocked'])

/**
 * Початок локальної доби для моменту часу.
 * @param {number} at момент (ms epoch)
 * @returns {number} північ тієї ж локальної доби (ms epoch)
 */
function dayStart(at) {
  return new Date(at).setHours(0, 0, 0, 0)
}

/**
 * Північ наступної локальної доби — дефолтний горизонт snooze
 * («тихо до завтра»).
 * @param {number} now поточний час (ms epoch)
 * @returns {string} ISO 8601 момент, коли нагадування повернеться
 */
export function nextMidnight(now) {
  return new Date(dayStart(now) + DAY_MS).toISOString()
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
 * Нагадування одного вузла за правилами deadline_due / personal_today.
 * Правила зі спеки перетинаються на pending (deadline сьогодні ⊂ горизонт
 * 24 год), тож вузол дає щонайбільше одне нагадування: pending —
 * personal_today, решта нерозвʼязаних — deadline_due.
 * @param {object} node вузол зі scan
 * @param {{ label: string, path: string }} workspace воркспейс вузла
 * @param {number} now поточний час (ms epoch)
 * @returns {object|null} нагадування або null
 */
function deadlineReminder(node, workspace, now) {
  if (!UNRESOLVED.has(node.state) || !node.deadline) return null
  const deadline = Date.parse(node.deadline)
  if (Number.isNaN(deadline) || deadline > now + DUE_HORIZON_MS) return null
  const overdue = deadline < now
  const rule = node.state === 'pending' ? 'personal_today' : 'deadline_due'
  const what = rule === 'personal_today' ? 'твоя задача' : 'гілка без результату'
  return {
    id: `${rule}|${workspace.path}|${node.path}|${node.deadline}`,
    rule,
    workspace,
    path: node.path,
    deadline: node.deadline,
    overdue,
    stake: overdue ? 0 : 1,
    headline: overdue
      ? `дедлайн ${node.deadline} минув — ${what} прострочена`
      : `дедлайн ${node.deadline} сьогодні — ${what}`
  }
}

/**
 * Нагадування про відкриту ескалацію на мою адресу, що лежить без
 * реакції довше за поріг.
 * @param {string} path шлях вузла
 * @param {Array<{ to: string, from: string, created_at: string, resolved: boolean }>} series серія ескалацій вузла
 * @param {{ label: string, path: string }} workspace воркспейс вузла
 * @param {string|null} me мій handle
 * @param {number} now поточний час (ms epoch)
 * @returns {object|null} нагадування або null
 */
function staleEscalationReminder(path, series, workspace, me, now) {
  const last = series?.at(-1)
  if (!last || last.resolved || me === null || last.to !== me) return null
  const raised = Date.parse(last.created_at)
  if (Number.isNaN(raised) || now - raised < ESCALATION_STALE_DAYS * DAY_MS) return null
  const days = Math.floor((now - raised) / DAY_MS)
  return {
    id: `escalation_stale|${workspace.path}|${path}|${last.created_at}`,
    rule: 'escalation_stale',
    workspace,
    path,
    stake: 2,
    headline: `ескалація від ${last.from} чекає твого вердикту вже ${days} дн.`
  }
}

/**
 * Збирає нагадування мого скоупу за трьома правилами спеки.
 * @param {{ workspaces: Array<{ label: string, path: string }>, forest: Record<string, object[]>, scopes?: Record<string, { classify: (path: string) => string }>, escalations?: Record<string, Record<string, object[]>>, me?: string|null, now: number }} input ліс і контекст
 * @returns {object[]} нагадування, найдорожчі (прострочені) першими
 */
export function deriveReminders({ workspaces, forest, scopes, escalations, me = null, now }) {
  const rows = []
  for (const workspace of workspaces ?? []) {
    const classify = path => scopes?.[workspace.path]?.classify(path) ?? 'mine'
    rows.push(
      ...walk(forest?.[workspace.path], node =>
        classify(node.path) === 'mine' ? deadlineReminder(node, workspace, now) : null
      )
    )
    for (const [path, series] of Object.entries(escalations?.[workspace.path] ?? {})) {
      const stale = staleEscalationReminder(path, series, workspace, me, now)
      if (stale) rows.push(stale)
    }
  }
  return rows.toSorted((a, b) => a.stake - b.stake)
}

/**
 * Відсіює заглушені нагадування: snooze діє, доки його until у майбутньому.
 * @param {object[]} reminders нагадування з deriveReminders
 * @param {Record<string, string>} [snoozes] активні snooze (id → until ISO)
 * @param {number} now поточний час (ms epoch)
 * @returns {object[]} нагадування, що мають звучати зараз
 */
export function applySnoozes(reminders, snoozes, now) {
  return (reminders ?? []).filter(r => {
    const until = Date.parse(snoozes?.[r.id] ?? '')
    return Number.isNaN(until) || until <= now
  })
}

// Порядок і підписи кошиків дедлайнів у брифі (спека 260714, UI п. 14).
const BUCKETS = [
  { key: 'overdue', label: 'прострочено' },
  { key: 'today', label: 'сьогодні' },
  { key: 'week', label: 'цього тижня' },
  { key: 'later', label: 'пізніше' },
  { key: 'none', label: 'без дедлайну' }
]

/**
 * Кошик одного рядка за його deadline.
 * @param {string|undefined} deadline ISO-дедлайн вузла
 * @param {number} now поточний час (ms epoch)
 * @returns {'overdue'|'today'|'week'|'later'|'none'} ключ кошика
 */
function bucketOf(deadline, now) {
  const at = Date.parse(deadline ?? '')
  if (Number.isNaN(at)) return 'none'
  if (at < now) return 'overdue'
  if (at < dayStart(now) + DAY_MS) return 'today'
  if (at < dayStart(now) + 7 * DAY_MS) return 'week'
  return 'later'
}

/**
 * Групує особисті задачі брифу в кошики дедлайнів (порожні кошики
 * опускаються, порядок фіксований — від найпекучішого).
 * @param {Array<{ node: object }>} personal рядки collectPersonal
 * @param {number} now поточний час (ms epoch)
 * @returns {Array<{ key: string, label: string, rows: object[] }>} непорожні кошики
 */
export function bucketPersonal(personal, now) {
  const byKey = Object.fromEntries(BUCKETS.map(b => [b.key, []]))
  for (const row of personal ?? []) byKey[bucketOf(row.node.deadline, now)].push(row)
  return BUCKETS.filter(b => byKey[b.key].length > 0).map(b => ({ ...b, rows: byKey[b.key] }))
}

/**
 * Українська множина для «задача».
 * @param {number} n кількість
 * @returns {string} слово у правильній формі
 */
function tasksWord(n) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'задача'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'задачі'
  return 'задач'
}

/**
 * Тонка стрічка нагадувань для режиму «Рішення»: лічильники без впливу
 * на вибір режиму (правило режимів недоторканне — конституція 260714).
 * @param {object[]} reminders активні нагадування (після applySnoozes)
 * @returns {{ count: number, overdue: number, headline: string }|null} стрічка, або null — тихо
 */
export function reminderRibbon(reminders) {
  const dated = (reminders ?? []).filter(r => r.rule !== 'escalation_stale')
  if (dated.length === 0) return null
  const overdue = dated.filter(r => r.overdue).length
  const base = `сьогодні: ${dated.length} ${tasksWord(dated.length)}`
  return {
    count: dated.length,
    overdue,
    headline: overdue > 0 ? `${base}, з них ${overdue} прострочено` : base
  }
}
