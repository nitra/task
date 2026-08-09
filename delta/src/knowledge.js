// Особиста база знань (M2, docs/specs/260809-delta-app.md — конституція
// п.2 «база знань складається з пройдених квізів («що я зрозумів,
// підписуючи»)» і п.9 «профспілковий режим за замовчуванням: усе, що
// система міряє про людину, видно їй першій»). Сховище — ПОЗА git,
// файл-сусід `config.json`/`device_key.json` того самого пристрою
// (`knowledge.json`) — той самий рівень приватності, що ключ пристрою:
// «що про мене знає система» бачить лише власник цього застосунку.
//
// Формат — плаский JSON-масив записів, по одному на КОЖЕН завершений квіз
// (усі питання квізу здано). Запис одночасно:
//  (а) конспект домену — {decisionRef, domain, question, microlesson,
//      completedAt} — «що я зрозумів, підписуючи»;
//  (б) одиниця spaced-repetition — {options, correctAnswer, intervalDays,
//      lastRepeatedAt} — щоб інтервальне повторення (п.5, «Spaced repetition
//      на живих рішеннях») могло поставити те саме питання знову, коли
//      інтервал настав, без повторного звернення до LLM чи decision-request
//      (той давно закритий і поза поточним runs/-снапшотом).
// `options`/`correctAnswer` — власне розширення схеми понад буквальний
// перелік полів у специфікації (яка називає лише decision_ref/domain/
// question/microlesson/iterations/time_to_understanding_sec/completed_at):
// без них питання-повторення неможливо матеріалізувати як квіз (немає з
// чого зібрати варіанти відповіді) — задокументоване рішення M2.

const INTERVAL_LADDER_DAYS = Object.freeze([1, 3, 7, 21])
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * @returns {object[]} порожня база знань
 */
export function emptyKnowledge() {
  return []
}

/**
 * Розбирає сирий текст `knowledge.json` — відсутній/битий файл повертає
 * порожній масив (не кидає): відсутність бази знань — не помилка, а стан
 * «ще жодного завершеного квізу».
 * @param {string|null|undefined} text сирий вміст файлу
 * @returns {object[]} записи бази знань
 */
export function parseKnowledgeFile(text) {
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Серіалізує записи бази знань у pretty-print JSON з кінцевим переносом рядка.
 * @param {object[]} entries записи бази знань
 * @returns {string} текст файлу
 */
export function formatKnowledgeFile(entries) {
  return `${JSON.stringify(entries, null, 2)}\n`
}

/**
 * @param {string} decisionRef `decision_ref` завершеного квізу
 * @param {string} completedAt ISO-час завершення
 * @returns {string} стабільний ідентифікатор запису
 */
function makeEntryId(decisionRef, completedAt) {
  return `${decisionRef}@${completedAt}`
}

/**
 * Додає запис завершеного квізу до бази знань — pure-функція (повертає
 * НОВИЙ масив, не мутує вхідний), той самий інваріант, що parseQuizFile/
 * formatQuizFile у quiz.js.
 * @param {object[]} entries поточна база знань
 * @param {object} completed завершений квіз
 * @param {string} completed.decisionRef `decision_ref` (`NNNN-decision-request.md`)
 * @param {string|null} completed.domain домен (`decisionRequest.decisionType`, `null` → `'general'`)
 * @param {string} completed.question текст (першого/головного) питання квізу
 * @param {string[]|null} [completed.options] варіанти відповіді — потрібні для майбутнього повторення
 * @param {string|null} [completed.correctAnswer] правильна відповідь (точний текст варіанта)
 * @param {string} completed.microlesson мікроурок
 * @param {number} completed.iterations сумарна кількість спроб квізу
 * @param {number} completed.timeToUnderstandingSec час до розуміння (секунди)
 * @param {string} completed.completedAt ISO-час завершення квізу
 * @returns {object[]} новий масив записів (з доданим)
 */
export function appendKnowledgeEntry(entries, completed) {
  const entry = {
    id: makeEntryId(completed.decisionRef, completed.completedAt),
    decisionRef: completed.decisionRef,
    domain: completed.domain ?? 'general',
    question: completed.question,
    options: completed.options ?? null,
    correctAnswer: completed.correctAnswer ?? null,
    microlesson: completed.microlesson,
    iterations: completed.iterations,
    timeToUnderstandingSec: completed.timeToUnderstandingSec,
    completedAt: completed.completedAt,
    intervalDays: INTERVAL_LADDER_DAYS[0],
    lastRepeatedAt: null
  }
  return [...entries, entry]
}

/**
 * @param {object} entry запис бази знань
 * @returns {number} момент (мс від епохи), коли повторення «дозріває»
 */
function dueAtMs(entry) {
  const base = Date.parse(entry.lastRepeatedAt ?? entry.completedAt)
  return base + entry.intervalDays * DAY_MS
}

/**
 * Знаходить найдавніший «дозрілий» запис певного домену для підмішування в
 * новий квіз як «Питання N (повторення)» (п.5 конституції — інтервали
 * 1→3→7→21 днів від `completedAt`/`lastRepeatedAt`). Немає давнього знання в
 * домені (або жоден запис ще не дозрів) — `null`: квіз лишається одним
 * питанням, це штатний, не винятковий шлях.
 * @param {object[]} entries база знань
 * @param {string} domain домен нової розвилки
 * @param {Date} now поточний час (ін'єкція годинника — тести підробляють час)
 * @returns {object|null} найдавніший дозрілий запис домену, або null
 */
export function dueRepetition(entries, domain, now) {
  const nowMs = now.getTime()
  const candidates = entries
    .filter(e => e.domain === domain && e.options && e.correctAnswer)
    .filter(e => dueAtMs(e) <= nowMs)
    .toSorted((a, b) => dueAtMs(a) - dueAtMs(b))
  return candidates[0] ?? null
}

/**
 * Оновлює `lastRepeatedAt`/`intervalDays` запису після відповіді на
 * питання-повторення. Правильна відповідь — просування драбинкою
 * 1→3→7→21 (стеля — 21, повторний прохід не подовжує далі). Неправильна —
 * скидання до першого щабля (1 день): «фейл ≠ покарання» тут означає
 * коротший інтервал до наступної спроби, не виключення зі бази знань.
 * @param {object[]} entries база знань
 * @param {string} entryId `id` запису (dueRepetition().id)
 * @param {boolean} correct чи відповідь на повторення була правильною
 * @param {Date} now поточний час (ін'єкція годинника)
 * @returns {object[]} новий масив записів з оновленим записом
 */
export function recordRepetitionAnswer(entries, entryId, correct, now) {
  return entries.map(e => {
    if (e.id !== entryId) return e
    const currentIndex = INTERVAL_LADDER_DAYS.indexOf(e.intervalDays)
    const nextIndex = correct ? Math.min(currentIndex + 1, INTERVAL_LADDER_DAYS.length - 1) : 0
    return { ...e, lastRepeatedAt: now.toISOString(), intervalDays: INTERVAL_LADDER_DAYS[Math.max(nextIndex, 0)] }
  })
}

/**
 * Конспект по доменах — «що я зрозумів, підписуючи» (конституція п.2/9):
 * усі мікроуроки й питання, згруповані за доменом, хронологічно.
 * @param {object[]} entries база знань
 * @returns {{domain: string, count: number, items: {decisionRef: string, question: string, microlesson: string, completedAt: string}[]}[]}
 *   конспект, домени відсортовані за назвою
 */
export function domainDigest(entries) {
  const byDomain = new Map()
  for (const e of entries) {
    if (!byDomain.has(e.domain)) byDomain.set(e.domain, [])
    byDomain
      .get(e.domain)
      .push({ decisionRef: e.decisionRef, question: e.question, microlesson: e.microlesson, completedAt: e.completedAt })
  }
  return Array.from(byDomain, ([domain, items]) => ({
    domain,
    count: items.length,
    items: items.toSorted((a, b) => a.completedAt.localeCompare(b.completedAt))
  })).toSorted((a, b) => a.domain.localeCompare(b.domain))
}

/**
 * @param {object[]} items записи одного домену з timeToUnderstandingSec
 * @returns {number} середнє арифметичне timeToUnderstandingSec
 */
function averageSec(items) {
  return items.reduce((sum, x) => sum + x.timeToUnderstandingSec, 0) / items.length
}

/**
 * @param {number} firstAvg середнє першої половини хронології
 * @param {number} secondAvg середнє другої половини хронології
 * @returns {'down'|'up'|'flat'} напрям тренду часу до розуміння
 */
function trendDirection(firstAvg, secondAvg) {
  if (secondAvg < firstAvg) return 'down'
  if (secondAvg > firstAvg) return 'up'
  return 'flat'
}

/**
 * Приватний тренд «час до розуміння» по доменах (метрика №3 спеки —
 * «тренд вниз = навчальна функція квізів працює»): порівнює середнє першої
 * й другої половини хронології кожного домену. Менше 2 записів — чесний
 * статус `insufficient-data`, не вигаданий «flat».
 * @param {object[]} entries база знань
 * @returns {{domain: string, samples: number, trend: 'down'|'up'|'flat'|'insufficient-data', averageSec: number|null, firstAvgSec?: number, secondAvgSec?: number}[]}
 *   тренд по доменах, відсортовані за назвою домену
 */
export function timeToUnderstandingTrend(entries) {
  const byDomain = new Map()
  for (const e of entries) {
    if (typeof e.timeToUnderstandingSec !== 'number') continue
    if (!byDomain.has(e.domain)) byDomain.set(e.domain, [])
    byDomain.get(e.domain).push(e)
  }
  return Array.from(byDomain, ([domain, items]) => {
    const sorted = items.toSorted((a, b) => a.completedAt.localeCompare(b.completedAt))
    if (sorted.length < 2) {
      return { domain, samples: sorted.length, trend: 'insufficient-data', averageSec: sorted[0]?.timeToUnderstandingSec ?? null }
    }
    const mid = Math.floor(sorted.length / 2)
    const firstAvg = averageSec(sorted.slice(0, mid))
    const secondAvg = averageSec(sorted.slice(mid))
    const trend = trendDirection(firstAvg, secondAvg)
    return {
      domain,
      samples: sorted.length,
      trend,
      averageSec: Math.round(averageSec(sorted)),
      firstAvgSec: Math.round(firstAvg),
      secondAvgSec: Math.round(secondAvg)
    }
  }).toSorted((a, b) => a.domain.localeCompare(b.domain))
}

/**
 * Читає базу знань через io-транспорт ({@link parseKnowledgeFile} +
 * `io.read()`) — той самий `{read, write}`-контракт, що CLI (`node:fs` на
 * `knowledge.json`-сусіді `config.json`) і GUI (Tauri `read_knowledge`/
 * `write_knowledge`). Немає io (виклик без бази знань) — порожній масив.
 * @param {{read: () => Promise<string|null>}|null|undefined} knowledgeIo io-транспорт бази знань
 * @returns {Promise<object[]>} записи бази знань
 */
export async function loadKnowledgeEntries(knowledgeIo) {
  if (!knowledgeIo) return []
  const text = await knowledgeIo.read()
  return parseKnowledgeFile(text)
}

/**
 * Пише базу знань через io-транспорт. Немає io — no-op (виклик без бази
 * знань не повинен падати).
 * @param {{write: (content: string) => Promise<void>}|null|undefined} knowledgeIo io-транспорт бази знань
 * @param {object[]} entries записи бази знань
 * @returns {Promise<void>}
 */
export async function saveKnowledgeEntries(knowledgeIo, entries) {
  if (!knowledgeIo) return
  await knowledgeIo.write(formatKnowledgeFile(entries))
}

export const INTERVAL_LADDER_DAYS_FOR_TESTS = INTERVAL_LADDER_DAYS
