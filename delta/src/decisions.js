// Парсер `decisions/NNNN-decision-request.md` за контрактом mt:
// mt/docs/architecture/mandates.md, секція «Артефакт decision-request», і
// «Нормативний контракт (M6 фаза 0)» (частина PR #67, злита в origin/main mt
// після написання specs/260809-delta-app.md — delta мокає за контрактом,
// mt-rust реалізує mandate-crate паралельно, рішення Ж).
//
// M1 — файловий мок git-refs транспорту: замість читання
// `refs/mt/runs/{run-id}/decisions/NNNN-decision-request.md` напряму з git
// (це прийде з mt-rust/napi), скануємо ту саму структуру директорій на
// диску — `<mandatesDir>/runs/{run-id}/decisions/NNNN-decision-request.md`.
// Дерево директорій навмисно дзеркалить контрактний git-шлях (той самий
// сегмент `decisions/NNNN-*`), щоб заміна на napi-виклик мандат-крейта
// пізніше не міняла форму виходу цього модуля.

import { parse as parseYaml } from 'yaml'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
const DECISION_REQUEST_RE = /^(\d{4})-decision-request\.md$/
const NEWLINE_RE = /\r?\n/
const BLAST_RADIUS_RANK = { node: 0, subtree: 1, repo: 2, company: 3 }

/**
 * Розбиває markdown-файл на YAML-фронтматер (обʼєкт) і тіло (рядок).
 * Файл без валідного фронтматера — фронтматер `{}`, усе тіло як є (не кидає).
 * @param {string} text сирий вміст файлу
 * @returns {{frontmatter: object, body: string}} розібраний файл
 */
export function splitFrontmatter(text) {
  const match = FRONTMATTER_RE.exec(text ?? '')
  if (!match) return { frontmatter: {}, body: text ?? '' }
  let frontmatter
  try {
    frontmatter = parseYaml(match[1]) ?? {}
  } catch (error) {
    throw new Error(`decision-request: невалідний фронтматер — ${error.message}`, { cause: error })
  }
  return { frontmatter, body: match[2] ?? '' }
}

/**
 * Розбиває тіло markdown на секції за заголовками одного рівня (`##`/`###`).
 * @param {string} body тіло markdown (без фронтматера)
 * @param {string} marker маркер заголовка, наприклад `'##'`
 * @returns {{heading: string, body: string}[]} секції в порядку появи
 */
function splitSections(body, marker) {
  // Простий префіксний тест замість динамічного RegExp(marker) — маркер сам
  // містить regex-метасимволи (`#`) не буквально, але побудова патерна з
  // рядка все одно небажана (security/detect-non-literal-regexp); заразом
  // `line.startsWith('### ')` природно НЕ збігається з маркером `'##'`
  // (третій `#` там, де очікується пробіл) — той самий інваріант без regex.
  const prefix = `${marker} `
  const lines = (body ?? '').split(NEWLINE_RE)
  const sections = []
  let current = null
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      current = { heading: line.slice(prefix.length).trim(), lines: [] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line)
    }
  }
  return sections.map(s => ({ heading: s.heading, body: s.lines.join('\n').trim() }))
}

/**
 * Знаходить першу секцію за точним заголовком (без урахування регістру).
 * @param {{heading: string, body: string}[]} sections секції
 * @param {string} heading шуканий заголовок
 * @returns {string} тіло секції, або `''`, якщо не знайдено
 */
function sectionBody(sections, heading) {
  const found = sections.find(s => s.heading.toLowerCase() === heading.toLowerCase())
  return found ? found.body : ''
}

/**
 * Розбиває заголовок одного варіанта (`'A. Виділити ...'`) на `label`/`title`
 * без regex (уникає sonarjs/super-linear-regex на комбінації квантифікаторів
 * — той самий підхід, що `splitSections`): перший пробіл ділить рядок,
 * крапка в кінці токена-мітки — необовʼязкова.
 * @param {string} heading заголовок `### `-секції
 * @returns {{label: string, title: string}|null} мітка+назва, або null — порожній заголовок
 */
function splitOptionLabel(heading) {
  const spaceIndex = heading.indexOf(' ')
  const rawLabel = spaceIndex === -1 ? heading : heading.slice(0, spaceIndex)
  const label = rawLabel.endsWith('.') ? rawLabel.slice(0, -1) : rawLabel
  if (!label) return null
  const title = spaceIndex === -1 ? '' : heading.slice(spaceIndex + 1).trim()
  return { label, title }
}

/**
 * Розбирає секцію `## Варіанти` на окремі `### A. ...` / `### B. ...` варіанти.
 * @param {string} variantsBody тіло секції `## Варіанти`
 * @returns {{label: string, title: string, body: string}[]} варіанти
 */
function parseOptions(variantsBody) {
  return splitSections(variantsBody, '###')
    .map(({ heading, body }) => {
      const parsedLabel = splitOptionLabel(heading)
      return parsedLabel ? { ...parsedLabel, body } : null
    })
    .filter(Boolean)
}

/**
 * Нормалізує `leverage_facets` фронтматера у camelCase з дефолтами
 * (контракт: `irreversible` bool, `blast_radius` enum, `divergence` рядок,
 * `est_cost_eur` число — усі, крім `irreversible`, опційні).
 * @param {unknown} raw сирий обʼєкт `leverage_facets`
 * @returns {object} нормалізовані фасети
 */
function normalizeLeverageFacets(raw) {
  const facets = raw && typeof raw === 'object' ? raw : {}
  return {
    irreversible: typeof facets.irreversible === 'boolean' ? facets.irreversible : false,
    blastRadius: typeof facets.blast_radius === 'string' ? facets.blast_radius : 'node',
    divergence: typeof facets.divergence === 'string' ? facets.divergence : null,
    estCostEur: typeof facets.est_cost_eur === 'number' ? facets.est_cost_eur : null
  }
}

/**
 * Розбирає текст одного `NNNN-decision-request.md` у нормалізований обʼєкт.
 * @param {string} text сирий вміст файлу
 * @param {{path?: string, runId?: string, nnnn?: string}} [meta] позиційні метадані (шлях/run/номер)
 * @returns {object} нормалізований decision-request
 */
export function parseDecisionRequest(text, meta = {}) {
  const { frontmatter, body } = splitFrontmatter(text)
  const sections = splitSections(body, '##')
  const variantsBody = sectionBody(sections, 'Варіанти')

  return {
    path: meta.path ?? null,
    runId: meta.runId ?? null,
    nnnn: meta.nnnn ?? null,
    mandateGeneration: typeof frontmatter.mandate_generation === 'number' ? frontmatter.mandate_generation : null,
    computedOwner: typeof frontmatter.computed_owner === 'string' ? frontmatter.computed_owner : null,
    escalationChain: Array.isArray(frontmatter.escalation_chain) ? frontmatter.escalation_chain.map(String) : [],
    retryHistory: Array.isArray(frontmatter.retry_history) ? frontmatter.retry_history : [],
    leverageFacets: normalizeLeverageFacets(frontmatter.leverage_facets),
    deadlineCost: typeof frontmatter.deadline_cost === 'string' ? frontmatter.deadline_cost : null,
    recommendedBy: typeof frontmatter.recommended_by === 'string' ? frontmatter.recommended_by : null,
    // `decision_type` — власне розширення M2 (docs/specs/260809-delta-app.md,
    // «Обсяг M2», п.4): decision-request у mandates.md-контракті НЕ несе поле
    // decision_type напряму (воно живе лише в `scope.decision_types`
    // мандата, не в самій розвилці) — тут задокументований дефакто-стандарт
    // цього застосунку: escalation-intake (мок — тестові фікстури) додатково
    // штампує `decision_type`, щоб база знань (`src/knowledge.js`) мала явний
    // домен без крос-читання `.mt/mandates.yaml` під час деривації квізу.
    // Відсутнє поле — домен `'general'` (knowledge.js), не помилка парсингу.
    decisionType: typeof frontmatter.decision_type === 'string' ? frontmatter.decision_type : null,
    // `approvers` — власне розширення M4 (docs/specs/260809-delta-app.md,
    // «Обсяг M4», п.2): мультипартійний підпис для irreversible-рішень
    // (leverage_facets.irreversible: true) вимагає підписів УСІХ handle-ів
    // цього списку; поле відсутнє → фолбек `[computedOwner]` (одноосібний
    // підписант, той самий, що весь інший flow) — див. `resolveApprovers`.
    approvers: Array.isArray(frontmatter.approvers) ? frontmatter.approvers.map(String) : null,
    // `opened_at` — власне розширення M4 (watcher.js): ISO-час, коли
    // decision-request зʼявився у черзі. Контракт mt не фіксує явного поля
    // «час відкриття» для файлового мока (у реальному git-refs транспорті
    // це час коміту decision-request, якого файловий мок не матеріалізує) —
    // той самий підхід, що `decision_type` (escalation-intake штампує
    // дефакто-поле понад букву контракту). Відсутнє поле — вік невідомий,
    // watcher.js свідомо НЕ пінгує (fail-safe, не вигаданий вік).
    openedAt: typeof frontmatter.opened_at === 'string' ? frontmatter.opened_at : null,
    context: sectionBody(sections, 'Контекст'),
    options: parseOptions(variantsBody),
    recommendation: sectionBody(sections, 'Рекомендація агента')
  }
}

/**
 * Чи рішення вимагає мультипартійного підпису (кворуму) — M4, docs/specs/
 * 260809-delta-app.md, «Обсяг M4», п.2: КОЖНЕ irreversible-рішення (не лише
 * широкий blast_radius) підписують УСІ `approvers`, кожен ВЛАСНИМ квізом
 * (`quorum.js`), а не єдиний computed_owner звичайним M1/M2-конвеєром.
 * @param {{irreversible: boolean}} leverageFacets нормалізовані leverage-фасети
 * @returns {boolean} true — рішення йде через `quorum.js`, не `decision-flow.js`
 */
export function requiresQuorum(leverageFacets) {
  return leverageFacets.irreversible === true
}

/**
 * Список handle-ів, чиї підписи потрібні для закриття irreversible-рішення
 * — фронтматер `approvers: [...]`, або фолбек `[computedOwner]` (мок без
 * явного поля — одноосібний підписант, той самий владник, що обчислив
 * маршрутизатор ескалацій).
 * @param {{approvers: string[]|null, computedOwner: string|null}} decisionRequest розібраний decision-request
 * @returns {string[]} handle-и підписантів кворуму
 */
export function resolveApprovers(decisionRequest) {
  if (Array.isArray(decisionRequest.approvers) && decisionRequest.approvers.length > 0) return decisionRequest.approvers
  return decisionRequest.computedOwner ? [decisionRequest.computedOwner] : []
}

/**
 * Деривує стан кворуму irreversible-рішення зі скановних файлів сусідньої
 * decisions-директорії (`NNNN-approval-{handle}.json` на кожного
 * підписанта) — pure-функція, не читає диск сама (той самий підхід, що
 * `isOpen` нижче): викликач (`deriveQueue`/`quorum.js: loadQuorumStatus`)
 * дає вже скановану карту імʼя→вміст.
 *
 * Статуси: `'pending'` — не всі підписали (звичайний прогрес, штатний
 * стан); `'closed'` — усі підписали З ОДНАКОВИМ `chosen_option` (рішення
 * закрите); `'diverged'` — усі підписали, але `chosen_option` розійшовся —
 * «розбіжність кворуму» (mandates.md: чесний стан, без автоматичної
 * авторезолюції — рішення лишається відкритим).
 * @param {{nnnn: string}} decisionRequest розібраний decision-request (для `nnnn`/`resolveApprovers`)
 * @param {Map<string, string>} filesByName карта імʼя файлу → вміст у директорії decisions
 * @returns {{approvers: string[], signed: {handle: string, chosenOption: string|null, signedAt: string|null}[], pending: string[], status: 'pending'|'closed'|'diverged'}}
 *   стан кворуму
 */
export function deriveQuorumStatus(decisionRequest, filesByName) {
  const approvers = resolveApprovers(decisionRequest)
  const signed = []
  const pending = []
  for (const handle of approvers) {
    const raw = filesByName.get(`${decisionRequest.nnnn}-approval-${handle}.json`)
    if (!raw) {
      pending.push(handle)
      continue
    }
    try {
      const approval = JSON.parse(raw)
      signed.push({ handle, chosenOption: approval.chosen_option ?? null, signedAt: approval.signed_at ?? null })
    } catch {
      pending.push(handle) // битий approval-файл — той самий інваріант, що device-registry.js: fail-closed, не рахується
    }
  }
  const allSigned = pending.length === 0
  const distinctOptions = new Set(signed.map(s => s.chosenOption))
  let status = 'pending'
  if (allSigned) status = distinctOptions.size === 1 ? 'closed' : 'diverged'
  return { approvers, signed, pending, status }
}

// «Помітна ціна» для decide-and-inform (mandates.md, «Крок 3», рядок
// decide-and-inform: «середні фасети») — власний поріг M2, задокументоване
// рішення цього застосунку (немає ще підписаної політики в mandates.yaml,
// яка б фіксувала це число): 300 EUR — нижче типового est_cost_eur
// «high-дивергентних» фікстур (800-1500 у прикладах mandates.md/README), але
// вище дрібних вузлових правок (0001: 40 EUR → one-tap лишається).
const NOTABLE_COST_EUR_THRESHOLD = 300

/**
 * Мапить leverage-фасети на глибину квіз-гейта — контрактне вирівнювання з
 * таблицею режимів маршрутизатора ескалацій (mandates.md, «Крок 3, режим»):
 *
 * | Режим (mandates.md)      | Умова                                  | Глибина квіз-гейта |
 * | ------------------------ | --------------------------------------- | ------------------- |
 * | ask-and-wait              | `irreversible` АБО широкий blast_radius | `teach-back` (M5)   |
 * | decide-and-inform         | середні фасети **і лише** reversible    | `standard` (M2)     |
 * | local/agent                | низькі фасети                          | `one-tap` (M1)      |
 *
 * «Середні фасети» — робоче визначення M2 (задокументоване тут, не
 * підписана політика `mandates.yaml`, якої ще не існує — M3+ переносить цю
 * таблицю в мандат-крейт mt-rust): blast_radius `subtree`, АБО divergence
 * `medium`/`high`, АБО `est_cost_eur` ≥ {@link NOTABLE_COST_EUR_THRESHOLD}.
 * Будь-який один із трьох фасетів достатній — вони декларативно незалежні
 * (mandates.md: «схлопнутий score неможливо оскаржити по частинах»).
 * @param {{irreversible: boolean, blastRadius: string, divergence: string|null, estCostEur: number|null}} facets leverage-фасети
 * @returns {'one-tap'|'standard'|'teach-back'} глибина квіз-гейта
 */
export function depthForFacets(facets) {
  const wideBlastRadius = facets.blastRadius === 'repo' || facets.blastRadius === 'company'
  if (facets.irreversible || wideBlastRadius) return 'teach-back'

  const mediumBlastRadius = facets.blastRadius === 'subtree'
  const mediumOrHighDivergence = facets.divergence === 'medium' || facets.divergence === 'high'
  const notableCost = facets.estCostEur !== null && facets.estCostEur >= NOTABLE_COST_EUR_THRESHOLD
  if (mediumBlastRadius || mediumOrHighDivergence || notableCost) return 'standard'

  return 'one-tap'
}

/**
 * Порівняльник для сортування черги «Вирішую» — вищі leverage-фасети йдуть
 * вище (irreversible понад reversible, ширший blast_radius понад вужчим);
 * стабільний tie-break за `nnnn` для детермінованого порядку в тестах/UI.
 * @param {object} a decision-request
 * @param {object} b decision-request
 * @returns {number} компаратор для `Array.prototype.sort`
 */
function byLeverageDesc(a, b) {
  if (a.leverageFacets.irreversible !== b.leverageFacets.irreversible) {
    return a.leverageFacets.irreversible ? -1 : 1
  }
  const rankA = BLAST_RADIUS_RANK[a.leverageFacets.blastRadius] ?? 0
  const rankB = BLAST_RADIUS_RANK[b.leverageFacets.blastRadius] ?? 0
  if (rankA !== rankB) return rankB - rankA
  return String(a.nnnn).localeCompare(String(b.nnnn))
}

/**
 * `NNNN` цього decision-request "відкритий" — немає сусіднього
 * `NNNN-approval.json` у тій самій decisions-директорії (mandates.md:
 * «до людини не доходить run failed» — тут навпаки, відповідь власника
 * матеріалізується як сусідній файл; його відсутність = розвилка чекає).
 * @param {Map<string, string>} filesByName карта імʼя файлу → вміст у директорії decisions
 * @param {string} nnnn чотиризначний номер
 * @returns {boolean} true — approval ще не написаний
 */
function isOpen(filesByName, nnnn) {
  return !filesByName.has(`${nnnn}-approval.json`)
}

/**
 * `delegated_to` з сусіднього `NNNN-delegation.json`, якщо є (M5,
 * `delegation.js`) — деривований сигнал маршрутизації черги: присутність
 * файлу означає «розвилка переїхала до моделі», `computed_owner` у самому
 * decision-request НЕ переписується (delegation.js, заголовок модуля).
 * Битий/нечитабельний JSON — `null` (fail-safe, той самий інваріант, що
 * `decisions.js: deriveQuorumStatus` на битому approval-файлі: не рахується).
 * @param {Map<string, string>} filesByName карта імʼя файлу → вміст у директорії decisions
 * @param {string} nnnn чотиризначний номер
 * @returns {string|null} handle моделі, якій делеговано, або `null`
 */
function delegatedToOrNull(filesByName, nnnn) {
  const raw = filesByName.get(`${nnnn}-delegation.json`)
  if (!raw) return null
  try {
    const record = JSON.parse(raw)
    return typeof record.delegated_to === 'string' ? record.delegated_to : null
  } catch {
    return null
  }
}

/**
 * Глибина кворумних (irreversible) карток у черзі — `teach-back` (M5,
 * mandates.md: «irreversible + широкий blast_radius → teach-back»); M4
 * форсувала `standard` — задокументовано замінено, `quorum.js` тепер
 * реалізує teach-back per-approver.
 */
const QUORUM_DEPTH = 'teach-back'

/**
 * Одна картка кворумного (irreversible) рішення для черги `handle` —
 * винесено з {@link deriveQueue} окремою функцією (той самий рефактор, що
 * `handle*Cli`-хелпери в `bin/delta.mjs`): `null`, коли `handle` не бере
 * участі в кворумі, або кворум уже одноголосно закритий (item лишає чергу).
 * Розбіжність (`diverged`) і незавершений прогрес (`pending`) ОБИДВА
 * лишаються в черзі — «не вигадуй авторезолюцію» (mandates.md).
 * @param {object} parsed розібраний decision-request
 * @param {string} dir абсолютний шлях до decisions-директорії
 * @param {Map<string, string>} filesByName карта імʼя файлу → вміст у директорії decisions
 * @param {string} handle власник, чий зріз деривувати
 * @returns {object|null} картка черги з полем `quorum`, або null
 */
function quorumQueueItem(parsed, dir, filesByName, handle) {
  const quorum = deriveQuorumStatus(parsed, filesByName)
  if (!quorum.approvers.includes(handle)) return null
  if (quorum.status === 'closed') return null
  return { ...parsed, dir, depth: QUORUM_DEPTH, open: true, quorum, awaitingMe: quorum.pending.includes(handle) }
}

/**
 * ЕФЕКТИВНИЙ owner-handle для деривації черги — `rawOwner`, або, коли
 * `rawOwner` — модель з активним kill-switch делегатора (M6, `kill-switch.js`),
 * ТОЙ делегатор замість неї (конституція п.10: «розвилки, делеговані моїм
 * ШІ-мандатам, і нові розвилки їхніх scope-ів падають мені»). Відсутній
 * `killSwitchRedirect` (звичайний виклик без M6-контексту) — `rawOwner` без
 * змін, byte-сумісно з поведінкою до M6.
 * @param {string|null} rawOwner сирий owner (computed_owner, або delegated_to)
 * @param {Map<string, string>|null|undefined} killSwitchRedirect карта modelHandle → humanHandle ({@link import('./kill-switch.js').buildKillSwitchRedirect})
 * @returns {string|null} ефективний owner
 */
function effectiveOwner(rawOwner, killSwitchRedirect) {
  return (rawOwner && killSwitchRedirect?.get(rawOwner)) ?? rawOwner
}

/**
 * Одна картка одноосібного (не-кворумного) ВІДКРИТОГО decision-request-а
 * для черги `handle` — винесено з {@link deriveQueue} окремою функцією (той
 * самий рефактор, що {@link quorumQueueItem}): `null`, коли `handle` не
 * власник цієї картки. M5 (`delegation.js`): присутність сусіднього
 * `NNNN-delegation.json` переносить картку в чергу `delegated_to` (моделі)
 * ЗАМІСТЬ `computed_owner` — `computed_owner` decision-request НЕ
 * переписується, лише маршрут деривується заново (заголовок `delegation.js`).
 * M6 (`killSwitchRedirect`): і `delegated_to`, і голий `computed_owner`
 * додатково проходять {@link effectiveOwner} — активний kill-switch
 * делегатора моделі переносить картку НА нього (kill-switch.js, заголовок
 * модуля).
 * @param {object} parsed розібраний decision-request
 * @param {string} dir абсолютний шлях до decisions-директорії
 * @param {Map<string, string>} filesByName карта імʼя файлу → вміст у директорії decisions
 * @param {string} nnnn чотиризначний номер
 * @param {string} handle власник, чий зріз деривувати
 * @param {Map<string, string>|null|undefined} killSwitchRedirect карта kill-switch перенаправлення (M6)
 * @returns {object|null} картка черги, або null
 */
function soloQueueItem(parsed, dir, filesByName, nnnn, handle, killSwitchRedirect) {
  const depth = depthForFacets(parsed.leverageFacets)
  const delegatedTo = delegatedToOrNull(filesByName, nnnn)
  if (delegatedTo) {
    const effective = effectiveOwner(delegatedTo, killSwitchRedirect)
    return effective === handle
      ? { ...parsed, dir, depth, open: true, delegatedTo, delegatedBy: parsed.computedOwner, killSwitchRedirected: effective !== delegatedTo }
      : null
  }
  const effective = effectiveOwner(parsed.computedOwner, killSwitchRedirect)
  return effective === handle ? { ...parsed, dir, depth, open: true, killSwitchRedirected: effective !== parsed.computedOwner } : null
}

/**
 * Деривує чергу «Вирішую» одного власника: відкриті decision-request-и, чий
 * `computed_owner` == `handle` (одноосібний M1/M2-шлях), або, для
 * irreversible-рішень, чий `handle` входить до `approvers` і кворум ще не
 * закритий одноголосно (M4 — {@link quorumQueueItem}) — відсортовані за
 * leverage-фасетами (спека docs/specs/260809-delta-app.md, п.2 «Обсяг M1»,
 * п.2 «Обсяг M4»).
 * @param {{dir: string, files: {name: string, content: string}[]}[]} decisionsDirs
 *   скановані `decisions/`-директорії (кожна — один run), як повертає
 *   Tauri-команда `scan_decisions`/CLI-скан файлової системи
 * @param {string|null|undefined} handle власник, чий зріз деривувати
 * @param {{killSwitchRedirect?: Map<string, string>}} [options] M6-контекст: карта kill-switch
 *   перенаправлення (`kill-switch.js: buildKillSwitchRedirect().redirect`) — опційно, відсутність
 *   зберігає точну поведінку до M6 (жодного перенаправлення)
 * @returns {object[]} відкриті decision-request власника, відсортовані найважільніші-перші
 */
export function deriveQueue(decisionsDirs, handle, options = {}) {
  if (!handle) return []
  const { killSwitchRedirect } = options
  const items = []
  for (const { dir, files } of decisionsDirs ?? []) {
    const filesByName = new Map(files.map(f => [f.name, f.content]))
    for (const file of files) {
      const match = DECISION_REQUEST_RE.exec(file.name)
      if (!match) continue
      const nnnn = match[1]
      const runId = dir.split('/').filter(Boolean).at(-2) ?? null
      const parsed = parseDecisionRequest(file.content, { path: `${dir}/${file.name}`, runId, nnnn })

      if (requiresQuorum(parsed.leverageFacets)) {
        const item = quorumQueueItem(parsed, dir, filesByName, handle)
        if (item) items.push(item)
        continue
      }

      if (!isOpen(filesByName, nnnn)) continue
      const item = soloQueueItem(parsed, dir, filesByName, nnnn, handle, killSwitchRedirect)
      if (item) items.push(item)
    }
  }
  return items.toSorted(byLeverageDesc)
}
