// Матриця автономії (M3, docs/specs/260711-owner-app.md): політика «клас дії
// → авто/підпис» на вузлі, успадковується вниз як ratchet — дитина може лише
// ПОСИЛИТИ вимогу (auto → approve), ніколи послабити. Невідомий/нездекларований
// клас → approve (fail-closed). Дані живуть у сусідньому файлі `autonomy.yml`
// вузла — власність owner, mt-core його не читає й не пише (a.md — чужий
// контракт, перезаписується цілком при зміні виконавця).

export const GATES = Object.freeze(['auto', 'approve'])

// Відкритий словник класів дій зі спеки; 'default' — фолбек для нездекларованих.
export const ACTION_CLASSES = Object.freeze(['deploy', 'external_comms', 'spend', 'worktree_edit'])

/**
 * Розбирає текст `autonomy.yml` (плоскі рядки `клас: gate`) у політику вузла.
 * Порожні рядки й `#`-коментарі ігноруються.
 * @param {string} text сирий вміст файлу (порожній рядок — вузол без своєї політики)
 * @returns {Record<string, 'auto'|'approve'>} декларована на вузлі політика
 */
export function parseAutonomy(text) {
  const policy = {}
  for (const raw of (text ?? '').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sep = line.indexOf(':')
    if (sep === -1) throw new Error(`autonomy.yml: невалідний рядок ${JSON.stringify(line)}`)
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (!GATES.includes(value)) throw new Error(`autonomy.yml: клас ${key} — невідомий гейт ${JSON.stringify(value)}`)
    policy[key] = value
  }
  return policy
}

/**
 * Серіалізує політику у формат `autonomy.yml` (порядок ключів — як передано).
 * @param {Record<string, 'auto'|'approve'>} policy політика вузла
 * @returns {string} текст файлу із завершальним переносом рядка
 */
export function serializeAutonomy(policy) {
  const lines = Object.entries(policy).map(([key, gate]) => `${key}: ${gate}`)
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/**
 * Ratchet-злиття: ефективна політика предка з власною декларацією вузла.
 * Дитина може замінити `auto` на `approve` (посилення); зворотне ігнорується
 * — вузол не може послабити те, що вже зафіксував предок.
 * @param {Record<string, 'auto'|'approve'>} inherited ефективна політика до цього вузла
 * @param {Record<string, 'auto'|'approve'>} own власна декларація вузла
 * @returns {Record<string, 'auto'|'approve'>} нова ефективна політика
 */
export function mergeAutonomy(inherited, own) {
  const merged = { ...inherited }
  for (const [key, gate] of Object.entries(own)) {
    merged[key] = merged[key] === 'approve' ? 'approve' : gate
  }
  return merged
}

/**
 * Розвʼязує гейт для конкретного класу дії: клас → `default` → fail-closed
 * `approve`, коли жоден предок його не декларував.
 * @param {Record<string, 'auto'|'approve'>} effective ефективна політика вузла
 * @param {string} actionClass клас дії
 * @returns {'auto'|'approve'} гейт, що застосовується
 */
export function resolveAction(effective, actionClass) {
  return effective[actionClass] ?? effective.default ?? 'approve'
}
