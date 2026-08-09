// Панель «незручна правда» — ШІ-кандор (M5, docs/specs/260809-delta-app.md,
// «Обсяг M5», п.3; конституція п.6: «Окремий інбокс «незручна правда» — те,
// що агент зобов'язаний сказати за анти-сикофантським контрактом, відділено
// від потоку рішень»). Патерн `tool ai_candor` — той самий headless-actor
// підхід, що `ai-petition.js` («симуляція від імені моделі»): викликається
// CLI чи майбутнім watcher-ом/агентом, НЕ людиною напряму; коли справжній
// агент отримає анти-сикофантський контракт (пізніший мілстоун), він
// викликатиме той самий tool замість симуляції.
//
// **ВІДДІЛЕНО від потоку рішень** (буквально з задачі) — власний лог
// `.mt/directory.json`-подібний файл `.mt/candor/{handle}.jsonl`
// (append-only JSONL, той самий read-append-write патерн, що
// `watcher.js: appendNotifications`), НЕ вплетений у `decisions/`
// чи `notifications/{handle}.jsonl` watcher-а — інший інбокс, інша вкладка
// UI, щоб «не губилось і не пом'якшувалось» (конституція).
//
// **Бюджет зухвалості** — `audacity_level` запису ≤ `audacity` мандата
// моделі (`thresholds.audacity`, `mandates.js`): модель без мандата, чи з
// `low`/`medium` бюджетом, не може «палити» `high`-заяви. Той самий
// інваріант, що `trust.js: audacityOf`/`AUDACITY_DESCRIPTIONS` — зухвалість
// кандору НЕ окремий канал повз мандат, вона СПОЖИВАЄ той самий бюджет, що
// й «жорсткі переговори сам» (mandates.md: «зухвалість обмежена
// інваріантом reversible» — той самий бюджет, інша форма витрати).
//
// **Позначка «прочитано» — локальна (приватна)**, той самий рівень
// приватності, що `knowledge.json`/`device_key.json`: файл-сусід
// `config.json` (`candor_read.json`, поза git) зі списком `id` прочитаних
// записів ЦЬОГО пристрою — прочитання кандору НЕ синхронізується між
// пристроями/людьми (профспілковий режим: що я прочитав — моя приватність,
// не спільний стан).

const AUDACITY_RANK = { low: 0, medium: 1, high: 2 }
const NEWLINE_RE = /\r?\n/

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} handle адресат («той, хто має почути незручну правду»)
 * @returns {string} абсолютний шлях до `.mt/candor/{handle}.jsonl`
 */
export function candorLogPath(mandatesDir, handle) {
  return `${mandatesDir}/.mt/candor/${handle}.jsonl`
}

/**
 * Розбирає JSONL-лог кандору — той самий fail-safe парсинг, що
 * `watcher.js: parseNotificationsLog` (битий рядок пропускається, не валить лог).
 * @param {string|null|undefined} text сирий вміст `{handle}.jsonl`
 * @returns {object[]} розібрані кандор-записи (сирі, snake_case поля файлу)
 */
export function parseCandorLog(text) {
  if (!text) return []
  const entries = []
  for (const line of text.split(NEWLINE_RE)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed))
    } catch {
      // битий рядок — пропускаємо
    }
  }
  return entries
}

/**
 * Кидає, якщо `audacityLevel` перевищує бюджет зухвалості мандата моделі —
 * той самий budget-принцип, що `trust.js`: `thresholds.audacity` (дефолт
 * `'low'`, той самий дефолт, що `trust.js: audacityOf`). Модель без
 * мандата, чи не `kind: model` — теж відхилено (кандор — акт мандата, не
 * будь-якого рядка тексту).
 * @param {object} params вхідні параметри
 * @param {{mandates: object[]}} params.mandatesFile розібраний `.mt/mandates.yaml`
 * @param {string} params.fromModelHandle handle моделі-відправника
 * @param {'low'|'medium'|'high'} params.audacityLevel заявлений рівень зухвалості цього запису
 * @returns {void}
 */
export function validateCandorAudacity({ mandatesFile, fromModelHandle, audacityLevel }) {
  const mandate = mandatesFile.mandates.find(m => m.owner === fromModelHandle)
  if (!mandate || mandate.kind !== 'model') {
    throw new Error(`ai_candor: '${fromModelHandle}' не має ШІ-мандата (kind: model) — кандор без мандата відхилено`)
  }
  const budget = mandate.thresholds.audacity ?? 'low'
  if (AUDACITY_RANK[audacityLevel] > AUDACITY_RANK[budget]) {
    throw new Error(
      `ai_candor: audacity_level '${audacityLevel}' перевищує бюджет зухвалості мандата '${fromModelHandle}' ` +
        `('${budget}') — модель не може палити заяви понад власний бюджет (mandates.md: «зухвалість обмежена»)`
    )
  }
}

/**
 * Будує один кандор-запис — контракт задачі M5, буквально:
 * `{from_model, statement, evidence_refs, created_at, audacity_level}`.
 * @param {object} params вхідні параметри
 * @param {string} params.fromModelHandle handle моделі-відправника
 * @param {string} params.statement сам текст незручної правди
 * @param {string[]} [params.evidenceRefs] посилання на evidence (напр. decision-ref-и, quiz-ref-и)
 * @param {'low'|'medium'|'high'} params.audacityLevel рівень зухвалості цієї заяви
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {{from_model: string, statement: string, evidence_refs: string[], audacity_level: string, created_at: string}}
 *   кандор-запис
 */
export function buildCandorRecord({ fromModelHandle, statement, evidenceRefs, audacityLevel, now }) {
  return {
    from_model: fromModelHandle,
    statement,
    evidence_refs: evidenceRefs ?? [],
    audacity_level: audacityLevel,
    created_at: (now ? now() : new Date()).toISOString()
  }
}

/**
 * Дописує один кандор-запис у JSONL-лог адресата — той самий
 * read-append-write, що `watcher.js: appendNotifications`.
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} io fs-транспорт
 * @param {string} path абсолютний шлях до `{handle}.jsonl`
 * @param {object} record кандор-запис
 * @returns {Promise<void>}
 */
export async function appendCandorRecord(io, path, record) {
  const existing = (await io.readFile(path)) ?? ''
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing
  await io.writeFile(path, `${prefix}${JSON.stringify(record)}\n`)
}

/**
 * `id` стабільний для одного кандор-запису — той самий підхід, що
 * `knowledge.js: makeEntryId` (композиція з полів запису, не окремий лічильник).
 * @param {{from_model: string, created_at: string}} record кандор-запис (сирий, snake_case)
 * @returns {string} стабільний ідентифікатор
 */
export function candorId(record) {
  return `${record.from_model}@${record.created_at}`
}

/**
 * headless-tool `ai_candor` — формує, валідує (бюджет зухвалості) і дописує
 * кандор-запис у лог адресата.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {string} params.toHandle адресат («той, хто має почути»)
 * @param {string} params.fromModelHandle handle моделі-відправника
 * @param {string} params.statement сам текст незручної правди
 * @param {string[]} [params.evidenceRefs] посилання на evidence
 * @param {'low'|'medium'|'high'} params.audacityLevel рівень зухвалості
 * @param {{mandates: object[]}} params.mandatesFile розібраний `.mt/mandates.yaml` (для валідації бюджету)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{path: string, record: object}>} шлях лога + записаний кандор-запис
 */
export async function aiCandor({ io, mandatesDir, toHandle, fromModelHandle, statement, evidenceRefs, audacityLevel, mandatesFile, now }) {
  validateCandorAudacity({ mandatesFile, fromModelHandle, audacityLevel })
  const record = buildCandorRecord({ fromModelHandle, statement, evidenceRefs, audacityLevel, now })
  const path = candorLogPath(mandatesDir, toHandle)
  await appendCandorRecord(io, path, record)
  return { path, record }
}

/**
 * Розбирає локальні позначки «прочитано» (`candor_read.json`, поза git) —
 * той самий fail-safe парсинг, що `knowledge.js: parseKnowledgeFile`: битий
 * чи відсутній файл — порожній набір, не помилка.
 * @param {string|null|undefined} text сирий вміст `candor_read.json`
 * @returns {Set<string>} множина прочитаних `id`
 */
export function parseCandorReadMarks(text) {
  if (!text) return new Set()
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? new Set(parsed) : new Set()
  } catch {
    return new Set()
  }
}

/**
 * @param {Set<string>} readIds множина прочитаних `id`
 * @returns {string} pretty-print JSON текст файлу
 */
export function formatCandorReadMarks(readIds) {
  return `${JSON.stringify([...readIds], null, 2)}\n`
}

/**
 * Тіло `candor_show` — читає лог адресата й позначки «прочитано» ЦЬОГО
 * пристрою, повертає записи з доданими `id`/`read` — UI/CLI бейдж
 * («N непрочитаних») рахує з `read: false`.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>}} params.io fs-транспорт `.mt/candor/`
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {string} params.handle адресат, чий інбокс читаємо
 * @param {{read: () => Promise<string|null>}} [params.readMarksIo] io локальних позначок «прочитано»
 * @returns {Promise<{from_model: string, statement: string, evidence_refs: string[], audacity_level: string,
 *   created_at: string, id: string, read: boolean}[]>} записи інбоксу
 */
export async function candorShow({ io, mandatesDir, handle, readMarksIo }) {
  const text = await io.readFile(candorLogPath(mandatesDir, handle))
  const records = parseCandorLog(text)
  const readIds = readMarksIo ? parseCandorReadMarks(await readMarksIo.read()) : new Set()
  return records.map(r => ({ ...r, id: candorId(r), read: readIds.has(candorId(r)) }))
}

/**
 * Тіло `candor_mark_read` — додає `id` до локальних позначок «прочитано»
 * ЦЬОГО пристрою (pure над уже завантаженим набором + `write` через io).
 * @param {object} params вхідні параметри
 * @param {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}} params.readMarksIo io позначок «прочитано»
 * @param {string} params.id `id` кандор-запису (`candorId`)
 * @returns {Promise<void>}
 */
export async function markCandorRead({ readMarksIo, id }) {
  const readIds = parseCandorReadMarks(await readMarksIo.read())
  readIds.add(id)
  await readMarksIo.write(formatCandorReadMarks(readIds))
}
