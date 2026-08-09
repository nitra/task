// Мок-парсер `.mt/mandates.yaml` за контрактом mt: mt/docs/architecture/mandates.md,
// секція «Карта мандатів (.mt/mandates.yaml)». Нормативний контракт M6 фаза 0
// зафіксовано в специфікації @7n/mt лише частково (PR у mt готується паралельно —
// docs/specs/260809-delta-app.md, рішення Ж): цей модуль читає та деривує ту саму
// схему, що описана в mandates.md, і буде замінений napi-викликами mandate-crate
// з mt-rust, коли crate стабілізується. Форма виходу (camelCase, нормалізовані
// типи) навмисно стабільна — вона й лишиться контрактом UI/CLI після заміни.
//
// Схема одного запису (mandates[]):
//   owner: handle людини або моделі
//   kind: 'person' (дефолт, якщо відсутнє) | 'model'
//   scope: { refs: string[], decision_types: string[] }
//   thresholds: { budget_eur?, risk?, irreversible?, audacity? } — порожньо = кореневий мандат
//   escalates_to: handle власника вище, або null (корінь ланцюга)

import { parse as parseYaml } from 'yaml'

const KNOWN_LEVELS = ['low', 'medium', 'high']

/**
 * Один токен без пробілів (handle) — трим і валідація непорожності.
 * @param {unknown} value кандидат-значення
 * @returns {string|null} нормалізований handle, або null — не валідний
 */
function normalizeHandle(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed && !/\s/.test(trimmed) ? trimmed : null
}

/**
 * Нормалізує один сирий запис `mandates[]` у стабільну camelCase-форму
 * (невалідний запис — без owner — відкидається, а не кидає виняток: один
 * побитий рядок фікстури не має валити всю карту).
 * @param {unknown} raw сирий об'єкт з розпарсеного YAML
 * @returns {object|null} нормалізований мандат, або null
 */
function normalizeMandate(raw) {
  const owner = raw && typeof raw === 'object' ? normalizeHandle(raw.owner) : null
  if (!owner) return null
  const scope = raw.scope && typeof raw.scope === 'object' ? raw.scope : {}
  const thresholds = raw.thresholds && typeof raw.thresholds === 'object' ? raw.thresholds : {}
  return {
    owner,
    kind: raw.kind === 'model' ? 'model' : 'person',
    scope: {
      refs: Array.isArray(scope.refs) ? scope.refs.map(String) : [],
      decisionTypes: Array.isArray(scope.decision_types) ? scope.decision_types.map(String) : []
    },
    thresholds: {
      budgetEur: typeof thresholds.budget_eur === 'number' ? thresholds.budget_eur : null,
      risk: KNOWN_LEVELS.includes(thresholds.risk) ? thresholds.risk : null,
      irreversible: typeof thresholds.irreversible === 'boolean' ? thresholds.irreversible : null,
      audacity: KNOWN_LEVELS.includes(thresholds.audacity) ? thresholds.audacity : null
    },
    escalatesTo: normalizeHandle(raw.escalates_to)
  }
}

/**
 * Розбирає текст `.mt/mandates.yaml` у список нормалізованих мандатів.
 * Порожній/відсутній файл (порожній рядок) — порожній список, не помилка:
 * викликач показує доброзичливий empty state, а не падає.
 * @param {string|null|undefined} yamlText сирий вміст файлу
 * @returns {object[]} нормалізовані мандати, порядок файлу збережено
 */
export function parseMandates(yamlText) {
  const text = (yamlText ?? '').trim()
  if (!text) return []
  let doc
  try {
    doc = parseYaml(text)
  } catch (error) {
    throw new Error(`mandates.yaml: невалідний YAML — ${error.message}`, { cause: error })
  }
  const list = doc && Array.isArray(doc.mandates) ? doc.mandates : []
  return list.map(raw => normalizeMandate(raw)).filter(Boolean)
}

/**
 * Усі мандати конкретного власника (зазвичай один запис на людину/модель,
 * але схема CODEOWNERS-подібна — кілька scope-блоків того самого owner
 * лишаються валідними).
 * @param {object[]} mandates нормалізовані мандати
 * @param {string|null|undefined} handle власник
 * @returns {object[]} мандати цього власника (порожньо — власник не знайдений)
 */
export function mandatesForOwner(mandates, handle) {
  if (!handle) return []
  return mandates.filter(m => m.owner === handle)
}

/**
 * Ланцюг ескалації від `handle` до кореня (`escalates_to: null`), включно
 * зі стартовим handle. Захист від циклу в даних фікстури: кожен owner
 * заходить у ланцюг не більше разу.
 * @param {object[]} mandates нормалізовані мандати
 * @param {string|null|undefined} handle стартовий власник
 * @returns {string[]} послідовність handle від себе до кореня (порожньо — handle поза картою)
 */
export function escalationChain(mandates, handle) {
  const byOwner = new Map(mandates.map(m => [m.owner, m]))
  const chain = []
  const seen = new Set()
  let current = handle ?? null
  while (current && byOwner.has(current) && !seen.has(current)) {
    seen.add(current)
    chain.push(current)
    current = byOwner.get(current).escalatesTo
  }
  return chain
}

/**
 * ШІ-мандати карти (`kind: model`) — першокласні учасники поруч із людьми.
 * @param {object[]} mandates нормалізовані мандати
 * @returns {object[]} мандати з kind === 'model'
 */
export function modelMandates(mandates) {
  return mandates.filter(m => m.kind === 'model')
}

/**
 * Кореневі мандати карти (`escalates_to: null`) — вершини ланцюгів ескалації.
 * @param {object[]} mandates нормалізовані мандати
 * @returns {object[]} мандати без escalates_to
 */
export function rootMandates(mandates) {
  return mandates.filter(m => m.escalatesTo === null)
}

/**
 * Повний деривований зріз карти для одного handle — єдина точка входу, яку
 * використовують і GUI (composable), і CLI (`delta mandates_show`), щоб
 * обидві поверхні бачили той самий результат з того самого файлу.
 * @param {string|null|undefined} yamlText сирий вміст `.mt/mandates.yaml`
 * @param {string|null|undefined} [handle] handle, чий зріз деривувати
 * @returns {{mandates: object[], mine: object[], escalationChain: string[], models: object[]}} дериваційний зріз
 */
export function deriveMandatesView(yamlText, handle) {
  const mandates = parseMandates(yamlText)
  return {
    mandates,
    mine: mandatesForOwner(mandates, handle),
    escalationChain: escalationChain(mandates, handle ?? null),
    models: modelMandates(mandates)
  }
}
