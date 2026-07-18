import { ref } from 'vue'
import { criticPrompt, parseCriticReply, runDeterministicCritic } from '../critic.js'
import { extractMission } from '../mission.js'
import { dispatch } from '../tool/index.js'
import { useLlmCascade } from './use-llm-cascade.js'

// Критик як споживач: детермінований прогін — безкоштовний, автоматичний при
// кожному rescan; семантичний (LLM) — на вимогу власника, по одному виклику
// на воркспейс через спільну драбину use-llm-cascade.js. Вердикти живуть у
// памʼяті сесії; відхилені власником не повертаються до наступного повного
// прогону.

// Межі дайджесту: скільки вузлів і скільки символів контракту на вузол.
const DIGEST_NODES = 30
const DIGEST_TASK_CHARS = 400

const verdicts = ref([])
const running = ref(false)

/**
 * Плаский список вузлів дерева у порядку обходу.
 * @param {object[]} nodes дерево вузлів зі scan
 * @returns {object[]} вузли без вкладеності
 */
function flatten(nodes) {
  return (nodes ?? []).flatMap(node => [node, ...flatten(node.children)])
}

/**
 * Текстовий дайджест воркспейсу для семантичного критика: стан + місія
 * кожного вузла (обрізано за лімітами контексту). Дієта скоупу (M6):
 * чужі гілки (foreign) не читаються взагалі — критик не бачить кухню
 * делегатів; межові вузли лишаються — їхній task.md і є контракт.
 * @param {{ label: string, path: string }} workspace воркспейс
 * @param {object[]} nodes дерево вузлів
 * @param {{ classify: (path: string) => string }} [scope] скоуп воркспейсу
 * @returns {Promise<string>} дайджест
 */
async function workspaceDigest(workspace, nodes, scope) {
  const rows = []
  const visible = flatten(nodes).filter(node => (scope?.classify(node.path) ?? 'mine') !== 'foreign')
  for (const node of visible.slice(0, DIGEST_NODES)) {
    const read = await dispatch('read_node', { tasksDir: workspace.path, taskPath: node.path })
    const mission = read.ok ? extractMission(read.output, DIGEST_TASK_CHARS) : ''
    const deps = (node.deps ?? []).length > 0 ? ` deps=[${node.deps.join(',')}]` : ''
    rows.push(`- ${node.path} [${node.state}]${deps}: ${mission}`)
  }
  return `Воркспейс ${workspace.label} (${rows.length} вузлів):\n${rows.join('\n')}`
}

/**
 * Композабл критика: вердикти + прогони (детермінований і семантичний).
 * @returns {{ verdicts: import('vue').Ref<object[]>, running: import('vue').Ref<boolean>, refreshDeterministic: (workspaces: object[], forest: Record<string, object[]>) => void, runSemantic: (workspaces: object[], forest: Record<string, object[]>) => Promise<void>, dismiss: (verdict: object) => void }} поверхня критика
 */
export function useCritic() {
  const { oneShot } = useLlmCascade()

  /**
   * Детермінований прогін: дешевий, викликається після кожного rescan.
   * Семантичні вердикти сесії зберігаються, детерміновані — заміщуються.
   * @param {object[]} workspaces воркспейси лісу
   * @param {Record<string, object[]>} forest дерева вузлів
   * @param {Record<string, { classify: (path: string) => string }>} [scopes] скоуп за шляхом воркспейсу
   */
  function refreshDeterministic(workspaces, forest, scopes) {
    const semantic = verdicts.value.filter(v => v.rule === 'semantic')
    verdicts.value = [...runDeterministicCritic(workspaces, forest, Date.now(), scopes), ...semantic]
  }

  /**
   * Семантичний прогін (LLM): один виклик на воркспейс, паралельно.
   * @param {object[]} workspaces воркспейси лісу
   * @param {Record<string, object[]>} forest дерева вузлів
   * @param {Record<string, { classify: (path: string) => string }>} [scopes] скоуп за шляхом воркспейсу
   * @returns {Promise<void>}
   */
  async function runSemantic(workspaces, forest, scopes) {
    running.value = true
    try {
      const found = await Promise.all(
        workspaces.map(async workspace => {
          try {
            const digest = await workspaceDigest(workspace, forest[workspace.path], scopes?.[workspace.path])
            const { system, user } = criticPrompt(digest)
            const reply = await oneShot({ system, user, tasksDir: workspace.path })
            return parseCriticReply(reply ?? '', workspace)
          } catch {
            return [] // воркспейс не прочитався чи модель мовчить — не валимо прогін
          }
        })
      )
      const deterministic = verdicts.value.filter(v => v.rule !== 'semantic')
      verdicts.value = [...deterministic, ...found.flat()]
    } finally {
      running.value = false
    }
  }

  /**
   * Власник відхилив вердикт — прибрати із сесії (анти-шум).
   * @param {object} verdict вердикт до відхилення
   */
  function dismiss(verdict) {
    verdicts.value = verdicts.value.filter(v => v !== verdict)
  }

  return { verdicts, running, refreshDeterministic, runSemantic, dismiss }
}
