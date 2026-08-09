// Детектор соціального дрейфу — приватне дзеркало (M5, docs/specs/
// 260809-delta-app.md, «Обсяг M5», п.4; mt: mandates.md, «Детектор
// соціального дрейфу»: «класи рішень, де людські вибори систематично
// відхиляються від мети задачі в бік соціального комфорту... показуються
// власнику мандата як дельта «мета vs комфорт»... адресовано самому
// власнику, не нагляд згори»; конституція п.6: «приходить лише самому
// власнику, з кнопкою «делегувати цю дію ШІ»»).
//
// **Headless-actor патерн** — той самий, що `watcher.js`: `driftScan` —
// pure-функція над скановими `decisionsDirs` (не читає диск сама),
// `runDriftScan` — оркеструє скан + персист, спільна точка входу для CLI/GUI
// tool `drift_scan` і майбутнього headless-крону (dogfooding з watcher-ом).
//
// **Сигнали систематичного відкладання** (клас = `decision_type`,
// одноосібні рішення — `requiresQuorum` кворумні виключено: кворум має
// власну механіку прогресу, не «моє особисте відкладання»):
//  (а) **застарілі** — відкриті (немає `NNNN-approval.json`) старші за
//      `staleDays` (дефолт 7 — власний поріг M5, задокументоване рішення:
//      м'якший за watcher-івський SLA+grace 24+24h, дрейф — довший
//      горизонт «я системно уникаю цього класу», не «це щойно висить»);
//  (б) **повторні ітерації без підпису** — квіз-файл (`NNNN-quiz.md`)
//      існує з `iterations >= iterationsThreshold` (дефолт 3), а рішення
//      й досі відкрите — «я почав, провалив кілька спроб і покинув», не
//      «я ще не почав».
// Обидва сигнали ОКРЕМІ (задокументоване спрощення M5): «reject-и з
// подальшим поверненням того самого класу» (третій сигнал з задачі)
// потребує графової прив'язки причин-наслідків між закритими й новими
// рішеннями, якої файловий мок не матеріалізує (той самий чесно названий
// ліміт, що `track-record.js: override` — «не обов'язково та сама
// розвилка»); кандидат наступного мілстоуна, коли precedent-engine
// (mandates.md, «Прецедентний рушій») дасть графову прив'язку.
//
// **Приватність — ЛОКАЛЬНО поза git, НЕ в `.mt/notifications`** (буквально
// з задачі): картки пишуться біля `knowledge.json`/`device_key.json`
// (`drift.json`, той самий рівень приватності — файл-сусід `config.json`
// цього пристрою), НЕ у спільний `.mt/notifications/{handle}.jsonl`
// watcher-а (той лог читають інші акти системи для ескалації — дрейф
// нікуди не ескалює, це дзеркало самому собі).

import { parseDecisionRequest } from './decisions.js'

const DECISION_REQUEST_RE = /^(\d{4})-decision-request\.md$/
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_STALE_DAYS = 7
const DEFAULT_ITERATIONS_THRESHOLD = 3

/**
 * @returns {{staleDays: number, iterationsThreshold: number}} дефолтний конфіг детектора
 */
export function defaultDriftConfig() {
  return { staleDays: DEFAULT_STALE_DAYS, iterationsThreshold: DEFAULT_ITERATIONS_THRESHOLD }
}

/**
 * @param {string} openedAtIso ISO-час відкриття decision-request
 * @param {Date} now поточний час
 * @returns {number|null} вік у днях, або `null` — `openedAtIso` невалідний/відсутній
 */
function ageDaysOf(openedAtIso, now) {
  if (!openedAtIso) return null
  const openedMs = Date.parse(openedAtIso)
  if (Number.isNaN(openedMs)) return null
  return (now.getTime() - openedMs) / DAY_MS
}

const ITERATIONS_FIELD_RE = /^iterations: (\d+)$/m

/**
 * `iterations` квіз-чернетки цього `nnnn`, якщо файл є — читає СИРИЙ
 * `iterations:` рядок фронтматера напряму (без повного `quiz.js: parseQuizFile`
 * — drift.js навмисно не залежить від формату Q&A/teach-back квіз-файлів,
 * лише від спільного для ОБОХ поля `iterations`, той самий інваріант, що
 * обидва формати документують у заголовку: «iterations — сумарна кількість
 * спроб»).
 * @param {string|undefined} quizText сирий вміст `NNNN-quiz.md`, якщо є
 * @returns {number} `iterations`, або `0` — квізу немає/поле відсутнє
 */
function quizIterations(quizText) {
  if (!quizText) return 0
  const match = ITERATIONS_FIELD_RE.exec(quizText)
  return match ? Number(match[1]) : 0
}

/**
 * Деривує дрейф-картки одного власника з уже сканованих `decisions/`-
 * директорій — pure-функція (той самий підхід, що `watcher.js:
 * scanForNotifications`): не читає диск сама, `now` завжди явно
 * ін'єктований.
 * @param {object} params вхідні параметри
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {string|null|undefined} params.handle власник, чий дрейф деривувати
 * @param {Date} params.now поточний час (ін'єкція годинника)
 * @param {number} [params.staleDays] поріг «застаріле» в днях
 * @param {number} [params.iterationsThreshold] поріг «повторні ітерації без підпису»
 * @returns {{decisionType: string, count: number, oldestAgeDays: number, deadlineCostSample: string|null,
 *   items: {nnnn: string, runId: string|null, ageDays: number|null, iterations: number, deadlineCost: string|null,
 *   signal: 'stale'|'repeated-iterations'|'both'}[], generatedAt: string}[]} дрейф-картки, найстаріший клас перший
 */
export function detectDrift({ decisionsDirs, handle, now, staleDays = DEFAULT_STALE_DAYS, iterationsThreshold = DEFAULT_ITERATIONS_THRESHOLD }) {
  if (!handle) return []
  const items = collectDriftItems({ decisionsDirs, handle, now, staleDays, iterationsThreshold })

  const byType = new Map()
  for (const item of items) {
    if (!byType.has(item.decisionType)) byType.set(item.decisionType, [])
    byType.get(item.decisionType).push(item)
  }

  return Array.from(byType, ([decisionType, typeItems]) => {
    const sorted = typeItems.toSorted((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0))
    return {
      decisionType,
      count: sorted.length,
      oldestAgeDays: Math.round(Math.max(...sorted.map(i => i.ageDays ?? 0))),
      deadlineCostSample: sorted.find(i => i.deadlineCost)?.deadlineCost ?? null,
      items: sorted.map(({ decisionType: _dt, ...rest }) => rest),
      generatedAt: now.toISOString()
    }
  }).toSorted((a, b) => b.oldestAgeDays - a.oldestAgeDays)
}

/**
 * @param {object} params вхідні параметри
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {string|null|undefined} params.handle власник, чий дрейф деривувати
 * @param {Date} params.now поточний час
 * @param {number} params.staleDays поріг «застаріле» в днях
 * @param {number} params.iterationsThreshold поріг «повторні ітерації без підпису»
 * @returns {object[]} плаский список сигнальних item-ів (з `decisionType` для групування)
 */
function collectDriftItems({ decisionsDirs, handle, now, staleDays, iterationsThreshold }) {
  const items = []
  for (const { dir, files } of decisionsDirs ?? []) {
    const filesByName = new Map(files.map(f => [f.name, f.content]))
    for (const file of files) {
      const match = DECISION_REQUEST_RE.exec(file.name)
      if (!match) continue
      const nnnn = match[1]
      const item = driftItemOrNull({ file, filesByName, nnnn, dir, handle, now, staleDays, iterationsThreshold })
      if (item) items.push(item)
    }
  }
  return items
}

/**
 * @param {object} params вхідні параметри одного decision-request-кандидата
 * @param {{name: string, content: string}} params.file файл decision-request-а
 * @param {Map<string, string>} params.filesByName карта імʼя файлу → вміст у директорії decisions
 * @param {string} params.nnnn чотиризначний номер
 * @param {string} params.dir абсолютний шлях до decisions-директорії
 * @param {string} params.handle власник, чий дрейф деривувати
 * @param {Date} params.now поточний час
 * @param {number} params.staleDays поріг «застаріле» в днях
 * @param {number} params.iterationsThreshold поріг «повторні ітерації без підпису»
 * @returns {object|null} сигнальний item, або `null` — не мій/кворумний/закритий/без сигналу
 */
function driftItemOrNull({ file, filesByName, nnnn, dir, handle, now, staleDays, iterationsThreshold }) {
  const parsed = parseDecisionRequest(file.content, { path: `${dir}/${file.name}`, nnnn })
  if (parsed.computedOwner !== handle) return null
  if (parsed.leverageFacets.irreversible) return null // кворум — власна механіка прогресу, не «моє особисте відкладання»
  if (filesByName.has(`${nnnn}-approval.json`)) return null // закрите — не відкладається

  const age = ageDaysOf(parsed.openedAt, now)
  const iterations = quizIterations(filesByName.get(`${nnnn}-quiz.md`))
  const stale = age !== null && age >= staleDays
  const repeated = iterations >= iterationsThreshold
  if (!stale && !repeated) return null

  const runId = dir.split('/').filter(Boolean).at(-2) ?? null
  return {
    decisionType: parsed.decisionType ?? 'general',
    nnnn,
    runId,
    ageDays: age === null ? null : Math.round(age),
    iterations,
    deadlineCost: parsed.deadlineCost,
    signal: driftSignal(stale, repeated)
  }
}

/**
 * @param {boolean} stale чи спрацював сигнал «застаріле»
 * @param {boolean} repeated чи спрацював сигнал «повторні ітерації без підпису»
 * @returns {'stale'|'repeated-iterations'|'both'} комбінований сигнал
 */
function driftSignal(stale, repeated) {
  if (stale && repeated) return 'both'
  return stale ? 'stale' : 'repeated-iterations'
}

/**
 * Розбирає локальний файл дрейф-карток (`drift.json`, поза git) — той самий
 * fail-safe парсинг, що `knowledge.js: parseKnowledgeFile`.
 * @param {string|null|undefined} text сирий вміст `drift.json`
 * @returns {object[]} дрейф-картки
 */
export function parseDriftFile(text) {
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * @param {object[]} cards дрейф-картки
 * @returns {string} pretty-print JSON текст файлу
 */
export function formatDriftFile(cards) {
  return `${JSON.stringify(cards, null, 2)}\n`
}

/**
 * Читає ЛОКАЛЬНІ дрейф-картки (той самий `{read, write}`-io-контракт, що
 * `knowledge.js: loadKnowledgeEntries`).
 * @param {{read: () => Promise<string|null>}|null|undefined} driftIo io дрейф-файлу
 * @returns {Promise<object[]>} дрейф-картки
 */
export async function loadDriftCards(driftIo) {
  if (!driftIo) return []
  return parseDriftFile(await driftIo.read())
}

/**
 * Перезаписує ЛОКАЛЬНІ дрейф-картки СВІЖИМ результатом скану (кожен
 * `drift_scan` — повний перерахунок, не інкрементальний append — той самий
 * підхід, що `watcher.js` НЕ використовує тут: watcher дописує, дрейф
 * перераховує, бо картка «клас Х відкладається» застаріває сама собою,
 * коли клас закрито — append накопичував би мертві картки назавжди).
 * @param {{write: (content: string) => Promise<void>}|null|undefined} driftIo io дрейф-файлу
 * @param {object[]} cards свіжі дрейф-картки
 * @returns {Promise<void>}
 */
export async function saveDriftCards(driftIo, cards) {
  if (!driftIo) return
  await driftIo.write(formatDriftFile(cards))
}

/**
 * Повний потік `drift_scan`: деривує картки ({@link detectDrift}) і
 * перезаписує локальний файл ({@link saveDriftCards}) — спільна точка
 * входу для CLI/GUI tool і headless-крону.
 * @param {object} params вхідні параметри
 * @param {{dir: string, files: {name: string, content: string}[]}[]} params.decisionsDirs скановані `decisions/`-директорії
 * @param {string|null|undefined} params.handle власник
 * @param {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} [params.driftIo] io дрейф-файлу
 * @param {{staleDays: number, iterationsThreshold: number}} [params.config] конфіг детектора
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object[]>} свіжі дрейф-картки
 */
export async function runDriftScan({ decisionsDirs, handle, driftIo, config, now }) {
  const resolvedConfig = { ...defaultDriftConfig(), ...config }
  const nowDate = now ? now() : new Date()
  const cards = detectDrift({ decisionsDirs, handle, now: nowDate, ...resolvedConfig })
  await saveDriftCards(driftIo, cards)
  return cards
}
