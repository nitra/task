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
    context: sectionBody(sections, 'Контекст'),
    options: parseOptions(variantsBody),
    recommendation: sectionBody(sections, 'Рекомендація агента')
  }
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
 * Деривує чергу «Вирішую» одного власника: відкриті decision-request-и, чий
 * `computed_owner` == `handle`, відсортовані за leverage-фасетами (спека
 * docs/specs/260809-delta-app.md, п.2 «Обсяг M1»).
 * @param {{dir: string, files: {name: string, content: string}[]}[]} decisionsDirs
 *   скановані `decisions/`-директорії (кожна — один run), як повертає
 *   Tauri-команда `scan_decisions`/CLI-скан файлової системи
 * @param {string|null|undefined} handle власник, чий зріз деривувати
 * @returns {object[]} відкриті decision-request власника, відсортовані найважільніші-перші
 */
export function deriveQueue(decisionsDirs, handle) {
  if (!handle) return []
  const items = []
  for (const { dir, files } of decisionsDirs ?? []) {
    const filesByName = new Map(files.map(f => [f.name, f.content]))
    for (const file of files) {
      const match = DECISION_REQUEST_RE.exec(file.name)
      if (!match) continue
      const nnnn = match[1]
      const runId = dir.split('/').filter(Boolean).at(-2) ?? null
      const parsed = parseDecisionRequest(file.content, { path: `${dir}/${file.name}`, runId, nnnn })
      if (parsed.computedOwner !== handle) continue
      if (!isOpen(filesByName, nnnn)) continue
      items.push({ ...parsed, dir, depth: depthForFacets(parsed.leverageFacets), open: true })
    }
  }
  return items.toSorted(byLeverageDesc)
}
