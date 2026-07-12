import { mergeAutonomy, parseAutonomy } from '../autonomy.js'
import { dispatch } from '../tool/index.js'

// Ефективна політика вузла — ratchet-обхід предків від кореня до вузла
// (autonomy.js — чиста логіка; тут лише FS-читання через tool-поверхню).

/**
 * Шляхи предків вузла від кореня до нього самого включно.
 * @param {string} nodePath шлях вузла (сегменти через «/»)
 * @returns {string[]} шляхи предків, від кореня
 */
function ancestorChain(nodePath) {
  const segments = nodePath.split('/')
  return segments.map((_, i) => segments.slice(0, i + 1).join('/'))
}

/**
 * Обчислює ефективну політику вузла: читає autonomy.yml кожного предка
 * (від кореня) і зливає ratchet-ом. Відсутній файл предка — нейтральний
 * крок (нічого не додає й не забирає).
 * @param {string} tasksDir абсолютний шлях tasks-директорії
 * @param {string} nodePath шлях вузла
 * @returns {Promise<Record<string, 'auto'|'approve'>>} ефективна політика
 */
export async function effectivePolicyFor(tasksDir, nodePath) {
  let effective = {}
  for (const ancestor of ancestorChain(nodePath)) {
    const read = await dispatch('read_autonomy', { tasksDir, taskPath: ancestor })
    let own = {}
    try {
      own = read.ok ? parseAutonomy(read.output) : {}
    } catch {
      // пошкоджений autonomy.yml предка — не валимо ланцюжок, просто нейтральний крок
    }
    effective = mergeAutonomy(effective, own)
  }
  return effective
}
