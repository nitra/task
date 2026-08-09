// Process watcher — headless-актор ПРОЦЕСУ, не людей (M4, docs/specs/
// 260809-delta-app.md, «Обсяг M4», п.3; mt: docs/architecture/mandates.md,
// «Process watcher»: «мікроменеджер процесу... порядок сигналізації
// (критично для психології системи): (1) першим пінгується сам виконавець
// — «у тебе висить X, допомогти?», послуга, не нагляд; (2) тільки після
// grace period без руху — власник мандата вище, у форматі «X застрягло, Y
// в курсі з {дата}», завжди паралельно й прозоро — виконавець бачить, що і
// коли піде вгору».
//
// **Час відкриття decision-request — власне розширення `opened_at`**
// (`decisions.js`, той самий дефакто-підхід, що `decision_type`):
// контракт mt не фіксує явного поля «час відкриття» для файлового мока
// (у реальному git-refs транспорті це час коміту decision-request, якого
// цей застосунок не матеріалізує). Немає `opened_at` → вік невідомий,
// watcher СВІДОМО не пінгує (fail-safe: краще пропустити пінг, ніж
// збрехати про вік — той самий принцип, що device-registry.js:
// «непідтверджений підпис ігнорується, а не приймається за замовчуванням
// валідний»).
//
// **Нотифікації — файловий лог, не push.** `<mandatesDir>/.mt/notifications/
// {handle}.jsonl`, append-only (той самий генеричний `{readFile, writeFile}`
// транспорт, що decision-flow.js/quorum.js — жодних нових Tauri-команд не
// потрібно: append читає поточний текст і дописує рядок). Relay для живих
// push-нотифікацій прийде пізніше (конституція п.8) — «полінг файлів
// замість пушу» задокументована деградація M4.
//
// **Тиха година — не фільтр, а ЗАТРИМКА доставки.** Некритична
// нотифікація, згенерована в тиху годину, і далі пишеться в лог одразу
// (watcher — headless-актор, може працювати при закритому ноутбуці й не
// чекати кінця вікна), але з полем `deliverAt` = момент кінця поточного
// вікна тихої години — споживач (`notifications_show`/UI-бейдж) фільтрує
// «видимі зараз» нотифікації за `deliverAt <= now`, показуючи решту як
// «відкладено до {час}» (батч, що спливе після вікна). Irreversible
// рішення З дедлайном (`deadline_cost` заповнено) — ВИНЯТОК, `critical:
// true`, `deliverAt` завжди = момент генерації (показ негайно, навіть у
// тиху годину) — той самий принцип, що quorum.js: незворотне не чекає.

import { deriveQuorumStatus, parseDecisionRequest, requiresQuorum } from './decisions.js'

const DEFAULT_SLA_HOURS = 24
const DEFAULT_GRACE_HOURS = 24
const HOUR_MS = 60 * 60 * 1000
const DECISION_REQUEST_RE = /^(\d{4})-decision-request\.md$/
const TIME_RE = /^(\d{1,2}):(\d{2})$/

/**
 * @returns {{slaHours: number, graceHours: number}} дефолтний конфіг watcher-а
 */
export function defaultWatcherConfig() {
  return { slaHours: DEFAULT_SLA_HOURS, graceHours: DEFAULT_GRACE_HOURS }
}

/**
 * @param {string} openedAtIso ISO-час відкриття decision-request
 * @param {Date} now поточний час (ін'єкція годинника)
 * @returns {number|null} вік у годинах, або `null` — `openedAtIso` невалідний
 */
function hoursSince(openedAtIso, now) {
  const openedMs = Date.parse(openedAtIso)
  if (Number.isNaN(openedMs)) return null
  return (now.getTime() - openedMs) / HOUR_MS
}

/**
 * Виконавці/підписанти, чиєї реакції ще бракує на ЦЬОМУ decision-request —
 * для одноосібного шляху: сам `computed_owner`, якщо `NNNN-approval.json`
 * ще нема; для кворумного (irreversible) — ті з `approvers`, хто ще не
 * підписав ({@link import('./decisions.js').deriveQuorumStatus}), і лише
 * поки кворум `'pending'` (закритий/розбіжний — вже термінальний, watcher
 * не пінгує далі). M6 (`killSwitchSuppressed`): виконавці з активним
 * kill-switch делегатора ({@link import('./kill-switch.js').buildKillSwitchRedirect})
 * НЕ повертаються — «watcher бачить активацію і НЕ ескалює по них»
 * (docs/specs/260809-delta-app.md, «Обсяг M6», п.3): пінгувати модель, чий
 * делегатор свідомо забрав усе собі, безглуздо, а ескалювати ЙОМУ ж —
 * повторний шум по тому, що він і так уже бачить у своїй черзі.
 * @param {object} parsed розібраний decision-request
 * @param {Map<string, string>} filesByName карта імʼя файлу → вміст у директорії decisions
 * @param {Set<string>|null|undefined} [killSwitchSuppressed] handle-и моделей, чий делегатор має активний kill-switch (M6)
 * @returns {string[]} handle-и, що ще не відповіли
 */
function pendingSignersFor(parsed, filesByName, killSwitchSuppressed) {
  if (requiresQuorum(parsed.leverageFacets)) {
    const quorum = deriveQuorumStatus(parsed, filesByName)
    const pending = quorum.status === 'pending' ? quorum.pending : []
    return pending.filter(signer => !killSwitchSuppressed?.has(signer))
  }
  if (!parsed.computedOwner || killSwitchSuppressed?.has(parsed.computedOwner)) return []
  return filesByName.has(`${parsed.nnnn}-approval.json`) ? [] : [parsed.computedOwner]
}

/**
 * Наступний власник мандата вище виконавця в ланцюгу ескалації — той, хто
 * ЗАРАЗ ескалює до кого (`escalation_chain[i+1]` для виконавця на позиції
 * `i`); ланцюг без виконавця, чи виконавець уже на вершині — `null` (нема
 * кому ескалювати, watcher мовчить, не падає).
 * @param {string[]} escalationChain ланцюг ескалації decision-request
 * @param {string} signer виконавець, чий пінг вичерпав grace-період
 * @returns {string|null} handle власника вище, або null
 */
function ownerAbove(escalationChain, signer) {
  const idx = escalationChain.indexOf(signer)
  if (idx === -1) return null
  return escalationChain[idx + 1] ?? null
}

/**
 * Одна decision-request-«розвилка» → нотифікації (SLA-пінг виконавцю,
 * потім, за grace, ескалація власнику + прозора копія виконавцю) —
 * винесено з {@link scanForNotifications} окремою функцією (той самий
 * рефактор, що `handle*Cli` в bin/delta.mjs — знижує cognitive complexity
 * зовнішньої функції).
 * @param {object} parsed розібраний decision-request
 * @param {string} runId run-id
 * @param {Map<string, string>} filesByName карта імʼя файлу → вміст у директорії decisions
 * @param {{slaHours: number, graceHours: number}} config конфіг watcher-а
 * @param {Date} now поточний час
 * @param {Set<string>|null|undefined} [killSwitchSuppressed] handle-и моделей, пригнічені kill-switch-ем (M6)
 * @returns {object[]} нотифікації цієї розвилки (можливо порожньо)
 */
function notificationsForDecision(parsed, runId, filesByName, config, now, killSwitchSuppressed) {
  const signers = pendingSignersFor(parsed, filesByName, killSwitchSuppressed)
  if (signers.length === 0 || !parsed.openedAt) return []
  const ageHours = hoursSince(parsed.openedAt, now)
  if (ageHours === null || ageHours < config.slaHours) return []

  const critical = parsed.leverageFacets.irreversible === true && Boolean(parsed.deadlineCost)
  const decisionRef = `${parsed.nnnn}-decision-request.md`
  const notifications = Array.from(signers, signer => ({
    kind: 'sla-ping-executor',
    to: signer,
    runId,
    nnnn: parsed.nnnn,
    decisionRef,
    ageHours: Math.round(ageHours),
    critical,
    message: `у тебе висить ${runId}/${parsed.nnnn} — допомогти?`
  }))

  if (ageHours < config.slaHours + config.graceHours) return notifications

  for (const signer of signers) {
    const owner = ownerAbove(parsed.escalationChain, signer)
    if (!owner) continue
    // Прозорість (mandates.md: «виконавець бачить, що і коли піде вгору») —
    // та сама подія дублюється в лог самого виконавця, іншим kind — один
    // виклик push з обома нотифікаціями (unicorn/prefer-single-call).
    notifications.push(
      {
        kind: 'sla-escalate-owner',
        to: owner,
        runId,
        nnnn: parsed.nnnn,
        decisionRef,
        ageHours: Math.round(ageHours),
        critical,
        executorHandle: signer,
        message: `${runId}/${parsed.nnnn} застрягло, ${signer} в курсі з ${parsed.openedAt}`
      },
      {
        kind: 'sla-escalated-notice',
        to: signer,
        runId,
        nnnn: parsed.nnnn,
        decisionRef,
        ageHours: Math.round(ageHours),
        critical,
        escalatedTo: owner,
        message: `${runId}/${parsed.nnnn} пішло вгору до ${owner} (grace-період вичерпано)`
      }
    )
  }
  return notifications
}

/**
 * Сканує усі decisions-директорії й будує список нотифікацій за SLA/grace —
 * pure-функція (не пише лог сама, `now`/`config` завжди явно ін'єктовані —
 * тестовність, той самий підхід, що весь застосунок з M2).
 * @param {object} params вхідні параметри
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані decisions-директорії
 * @param {{slaHours: number, graceHours: number}} [params.config] конфіг (дефолт — {@link defaultWatcherConfig})
 * @param {Date} params.now поточний час (ін'єкція годинника)
 * @param {Set<string>|null|undefined} [params.killSwitchSuppressed] handle-и моделей, пригнічені kill-switch-ем
 *   делегатора (M6, `kill-switch.js: buildKillSwitchRedirect().redirect` — множина ключів) — опційно, відсутність
 *   зберігає точну поведінку до M6 (жодного пригнічення)
 * @returns {object[]} нотифікації, недетерміновано впорядковані за run-ами файлової системи
 */
export function scanForNotifications({ decisionsDirs, config, now, killSwitchSuppressed }) {
  const resolvedConfig = { ...defaultWatcherConfig(), ...config }
  const notifications = []
  for (const { dir, files } of decisionsDirs ?? []) {
    const filesByName = new Map(files.map(f => [f.name, f.content]))
    for (const file of files) {
      const match = DECISION_REQUEST_RE.exec(file.name)
      if (!match) continue
      const nnnn = match[1]
      const runId = dir.split('/').filter(Boolean).at(-2) ?? null
      const parsed = parseDecisionRequest(file.content, { path: `${dir}/${file.name}`, runId, nnnn })
      notifications.push(...notificationsForDecision(parsed, runId, filesByName, resolvedConfig, now, killSwitchSuppressed))
    }
  }
  return notifications
}

/**
 * `"HH:MM"` → хвилини від півночі; невалідний формат — `null`.
 * @param {string} value рядок часу
 * @returns {number|null} хвилини від півночі
 */
function toMinutes(value) {
  const match = TIME_RE.exec(value ?? '')
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Чи `now` потрапляє у вікно тихої години `{start, end}` (`"HH:MM"`,
 * пристрій-конфіг застосунку) — підтримує нічне вікно, що перетинає
 * північ (`start > end`, напр. `20:00–09:00`).
 * @param {Date} now поточний час
 * @param {{start: string, end: string}|null|undefined} quietHours конфіг тихої години
 * @returns {boolean} true — зараз тиха година
 */
export function isQuietHours(now, quietHours) {
  if (!quietHours) return false
  const startMin = toMinutes(quietHours.start)
  const endMin = toMinutes(quietHours.end)
  if (startMin === null || endMin === null || startMin === endMin) return false
  const nowMin = now.getHours() * 60 + now.getMinutes()
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin
  return nowMin >= startMin || nowMin < endMin // нічне вікно через північ
}

/**
 * Найближчий момент часу-доби `"HH:MM"` СТРОГО ПІСЛЯ (чи в) `now` —
 * «кінець поточного вікна тихої години», куди відкладається доставка
 * некритичної нотифікації.
 * @param {string} timeStr `"HH:MM"`
 * @param {Date} now поточний час
 * @returns {Date} момент найближчого настання цього часу-доби
 */
function nextOccurrenceOf(timeStr, now) {
  const minutes = toMinutes(timeStr)
  const candidate = new Date(now)
  candidate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  if (candidate <= now) candidate.setDate(candidate.getDate() + 1)
  return candidate
}

/**
 * Проставляє `deliverAt` на кожну нотифікацію за правилом тихої години
 * (M4, докладніше — заголовок модуля): некритична нотифікація, згенерована
 * в тиху годину, відкладається до кінця вікна; критична (irreversible З
 * дедлайном) чи згенерована поза тихою годиною — доставляється негайно
 * (`deliverAt === now`).
 * @param {object[]} notifications нотифікації від {@link scanForNotifications}
 * @param {object} params вхідні параметри
 * @param {{start: string, end: string}|null|undefined} params.quietHours конфіг тихої години пристрою
 * @param {Date} params.now поточний час
 * @returns {object[]} ті самі нотифікації, з доданим `deliverAt` (ISO)
 */
export function applyQuietHours(notifications, { quietHours, now }) {
  const quiet = isQuietHours(now, quietHours)
  return notifications.map(n => {
    const deferred = quiet && !n.critical
    const deliverAt = deferred ? nextOccurrenceOf(quietHours.end, now) : now
    return { ...n, deliverAt: deliverAt.toISOString(), batched: deferred }
  })
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} handle власник логу
 * @returns {string} абсолютний шлях до `.mt/notifications/{handle}.jsonl`
 */
export function notificationsLogPath(mandatesDir, handle) {
  return `${mandatesDir}/.mt/notifications/${handle}.jsonl`
}

/**
 * Розбирає JSONL-лог нотифікацій — порожні/биті рядки мовчки пропускаються
 * (той самий fail-safe інваріант, що `device-registry.js`/`knowledge.js`
 * парсери: один битий рядок не має валити весь лог).
 * @param {string|null|undefined} text сирий вміст `{handle}.jsonl`
 * @returns {object[]} розібрані нотифікації
 */
export function parseNotificationsLog(text) {
  if (!text) return []
  const entries = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed))
    } catch {
      // битий рядок — пропускаємо, не валимо весь лог
    }
  }
  return entries
}

/**
 * Дописує нотифікації в JSONL-лог `handle` — read-append-write через
 * генеричний `{readFile, writeFile}`-io (той самий транспорт, що
 * decision-flow.js/quorum.js; жодних нових Tauri-команд, GUI має
 * `read_text_file`/`write_text_file` вже з M1).
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} io fs-транспорт
 * @param {string} path абсолютний шлях до `{handle}.jsonl`
 * @param {object[]} notifications нотифікації для дописування
 * @returns {Promise<void>}
 */
export async function appendNotifications(io, path, notifications) {
  if (notifications.length === 0) return
  const existing = (await io.readFile(path)) ?? ''
  const lines = notifications.map(n => JSON.stringify(n))
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing
  await io.writeFile(path, `${prefix}${lines.join('\n')}\n`)
}

/**
 * Повний прогін watcher-а — скан → тиха година → дописування в лог
 * КОЖНОГО адресата (`to`-handle нотифікації, не обовʼязково той самий, хто
 * викликав скан: `runWatcherScan` — headless-актор, пише в чужі логи, той
 * самий інваріант, що mandates.md: «watcher — актор процесу»). Єдина
 * точка входу, спільна для `watcher_scan` tool (CLI/GUI) і headless
 * `bin/delta-watcher.mjs`.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані decisions-директорії
 * @param {{slaHours: number, graceHours: number}} [params.config] конфіг watcher-а
 * @param {{start: string, end: string}|null|undefined} [params.quietHours] конфіг тихої години
 * @param {Set<string>|null|undefined} [params.killSwitchSuppressed] handle-и моделей, пригнічені kill-switch-ем (M6)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{notifications: object[], delivered: number, batched: number}>} підсумок прогону
 */
export async function runWatcherScan({ io, mandatesDir, decisionsDirs, config, quietHours, killSwitchSuppressed, now }) {
  const nowDate = now ? now() : new Date()
  const scanned = scanForNotifications({ decisionsDirs, config, now: nowDate, killSwitchSuppressed })
  const withDelivery = applyQuietHours(scanned, { quietHours, now: nowDate })

  const byHandle = new Map()
  for (const n of withDelivery) {
    if (!byHandle.has(n.to)) byHandle.set(n.to, [])
    byHandle.get(n.to).push(n)
  }
  for (const [handle, entries] of byHandle) {
    await appendNotifications(io, notificationsLogPath(mandatesDir, handle), entries)
  }

  return {
    notifications: withDelivery,
    delivered: withDelivery.filter(n => !n.batched).length,
    batched: withDelivery.filter(n => n.batched).length
  }
}
