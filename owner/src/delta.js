// Дельта «що змінилось із останнього візиту» (docs/specs/260711-owner-app.md):
// власник читає зміни, а не стан — стан читає машина. Snapshot лісу
// (воркспейс → вузол → стан) зберігається між візитами у localStorage;
// baseline фіксується на момент відкриття застосунку.

const SNAPSHOT_KEY = 'owner:forest-snapshot'

// Стани, в яких вузол потребує людини (ескалація).
const ESCALATED = new Set(['unresolvable', 'failed', 'stalled', 'plan_review'])

// Порядок показу: спершу ескалації, далі завершене, нове, решта змін.
const KIND_ORDER = { escalated: 0, resolved: 1, appeared: 2, changed: 3, gone: 4 }

/**
 * Плаский знімок лісу: стан кожного вузла за шляхом.
 * @param {Record<string, object[]>} forest дерева вузлів за шляхом воркспейсу
 * @returns {Record<string, Record<string, string>>} знімок {ws: {nodePath: state}}
 */
export function snapshotForest(forest) {
  const snapshot = {}
  for (const [workspacePath, nodes] of Object.entries(forest ?? {})) {
    const flat = {}
    const visit = list => {
      for (const node of list ?? []) {
        flat[node.path] = node.state
        visit(node.children)
      }
    }
    visit(nodes)
    snapshot[workspacePath] = flat
  }
  return snapshot
}

/**
 * Класифікує перехід стану одного вузла у kind рядка дельти.
 * @param {string|undefined} from попередній стан (undefined — вузла не було)
 * @param {string|undefined} to новий стан (undefined — вузол зник)
 * @returns {string|null} kind, або null коли зміни немає
 */
function classify(from, to) {
  if (to === undefined) return 'gone'
  if (from === to) return null
  if (ESCALATED.has(to)) return 'escalated'
  if (to === 'resolved') return 'resolved'
  if (from === undefined) return 'appeared'
  return 'changed'
}

/**
 * Порівнює два знімки лісу і повертає рядки дельти для брифу.
 * @param {Record<string, Record<string, string>>} prev знімок минулого візиту
 * @param {Record<string, Record<string, string>>} next поточний знімок
 * @returns {Array<{ workspace: string, path: string, kind: string, from?: string, to?: string }>} рядки дельти
 */
export function diffForest(prev, next) {
  const rows = []
  const workspacePaths = new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])
  for (const workspace of workspacePaths) {
    const before = prev?.[workspace] ?? {}
    const after = next?.[workspace] ?? {}
    for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const kind = classify(before[path], after[path])
      if (kind) rows.push({ workspace, path, kind, from: before[path], to: after[path] })
    }
  }
  return rows.toSorted((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

/**
 * Знімок минулого візиту зі сховища (null — перший візит чи не браузер).
 * @returns {Record<string, Record<string, string>>|null} збережений знімок
 */
export function readSnapshot() {
  try {
    const raw = globalThis.localStorage?.getItem(SNAPSHOT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Зберігає знімок поточного лісу для наступного візиту.
 * @param {Record<string, Record<string, string>>} snapshot поточний знімок
 */
export function writeSnapshot(snapshot) {
  try {
    globalThis.localStorage?.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot))
  } catch {
    // без localStorage (тести) — дельта живе лише в памʼяті сесії
  }
}
