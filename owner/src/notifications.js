// ОС-нотифікації (M7, спека 260714): лише детерміновані події — нове рішення
// у моїй черзі, дедлайн перетнув межу «сьогодні/прострочено», один ранковий
// дайджест на перший rescan календарного дня. Дельта-зміни нотифікацій не
// породжують (шум), і ніколи «LLM вирішив перервати». Стан «що вже
// нотифіковано» — локально, як snapshot дельти.

const SEEN_KEY = 'owner:notified'

// Не більше стількох окремих нотифікацій за один rescan — далі одна зведена.
const BATCH_LIMIT = 3

/**
 * Локальна дата моменту (ключ календарного дня для дайджесту).
 * @param {number} at момент (ms epoch)
 * @returns {string} YYYY-MM-DD локальної доби
 */
function dayKey(at) {
  const d = new Date(at)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * Стабільний ключ рішення черги для порівняння між rescan-ами.
 * @param {{ workspace: { path: string }, node: { path: string }, headline: string }} decision рішення
 * @returns {string} ключ
 */
function decisionKey(decision) {
  return `${decision.workspace.path}|${decision.node.path}|${decision.headline}`
}

/**
 * Планує ОС-нотифікації проти стану «що вже бачено» — чиста функція,
 * side-effect (показ) робить notifySeen.
 * @param {{ decisions: object[], reminders: object[], now: number, seen: { day?: string, decisions?: string[], reminders?: string[] } | null }} input поточна черга, нагадування і бачене
 * @returns {{ notes: Array<{ title: string, body: string }>, seen: { day: string, decisions: string[], reminders: string[] } }} нотифікації і новий стан
 */
export function planNotifications({ decisions, reminders, now, seen }) {
  const notes = []
  const today = dayKey(now)
  const decisionKeys = (decisions ?? []).map(d => decisionKey(d))
  const reminderIds = (reminders ?? []).map(r => r.id)

  // Ранковий дайджест — один на календарний день, і лише коли є що казати.
  if (seen?.day !== today && decisionKeys.length + reminderIds.length > 0) {
    notes.push({
      title: 'Owner — ранковий дайджест',
      body: `у черзі: ${decisionKeys.length} рішень · нагадувань: ${reminderIds.length}`
    })
  }

  // Поштучні нотифікації — лише проти вже баченого baseline: перший rescan
  // (seen порожній) не спамить усім лісом одразу.
  const fresh = []
  if (seen?.decisions) {
    const known = new Set(seen.decisions)
    for (const decision of decisions ?? []) {
      if (!known.has(decisionKey(decision))) {
        fresh.push({ title: 'Нове рішення у твоїй черзі', body: `${decision.node.path}: ${decision.headline}` })
      }
    }
  }
  if (seen?.reminders) {
    const known = new Set(seen.reminders)
    for (const reminder of reminders ?? []) {
      if (!known.has(reminder.id)) {
        fresh.push({ title: 'Дедлайн поруч', body: `${reminder.path}: ${reminder.headline}` })
      }
    }
  }
  notes.push(
    ...(fresh.length > BATCH_LIMIT
      ? [{ title: 'Owner', body: `${fresh.length} нових подій у черзі й нагадуваннях` }]
      : fresh)
  )

  return { notes, seen: { day: today, decisions: decisionKeys, reminders: reminderIds } }
}

/**
 * Бачений стан із локального сховища (null — перший запуск чи не браузер).
 * @returns {{ day?: string, decisions?: string[], reminders?: string[] }|null} збережений стан
 */
export function readSeen() {
  try {
    const raw = globalThis.localStorage?.getItem(SEEN_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Зберігає бачений стан для наступного rescan.
 * @param {{ day: string, decisions: string[], reminders: string[] }} seen новий стан
 */
export function writeSeen(seen) {
  try {
    globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify(seen))
  } catch {
    // без localStorage (тести) — baseline живе лише в памʼяті сесії
  }
}

/**
 * Показує заплановані нотифікації через tauri-plugin-notification і фіксує
 * baseline. Поза Tauri (тести, браузер) — мовчки лише фіксує baseline.
 * @param {{ decisions: object[], reminders: object[] }} input поточна черга і нагадування
 * @returns {Promise<void>}
 */
export async function notifyRescan({ decisions, reminders }) {
  const { notes, seen } = planNotifications({ decisions, reminders, now: Date.now(), seen: readSeen() })
  writeSeen(seen)
  if (notes.length === 0) return
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification')
    const granted = (await isPermissionGranted()) || (await requestPermission()) === 'granted'
    if (!granted) return
    for (const note of notes) sendNotification(note)
  } catch {
    // не під Tauri або плагін недоступний — нотифікації просто не звучать
  }
}
