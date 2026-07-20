import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { resolveAction } from '../autonomy.js'
import { effectivePolicyFor } from './use-autonomy.js'

// Vendored slice of the useOmlx() that @7n/tauri-components removed in 0.11.0
// (that whole omlx/runAgent path is gone in favor of ACP — see the module doc
// below): this composable never called useOmlx().loadEnv(), so it only ever
// needed localStorage-backed baseUrl/model persistence, not the Rust
// omlx_config/myllm-proxy resolution loadEnv() did. apiKey stays an
// unpopulated ref, matching prior behavior (it was never set here either).
const STORAGE_PREFIX = 'owner'
const DEFAULT_MODEL = 'gemma-4-e4b-it-OptiQ-4bit'
const BASE_URL_KEY = `${STORAGE_PREFIX}:omlxBaseUrl`
const MODEL_KEY = `${STORAGE_PREFIX}:omlxModel`

/**
 * @param {string} key localStorage key
 * @returns {string|null} stored value, or null when unavailable (tests/SSR)
 */
function readStored(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  }
  catch {
    return null
  }
}

// Єдиний шлях виклику LLM для плановика/критика/штабу (заміна трьох
// незалежних createOpenAiChat): драбина ACP (Cursor → Codex CLI, особиста
// підписка, лише якщо клас `external_comms` дозволено autonomy.yml вузла) →
// local/cloud тир крейта llm-cascade (nitra/7n-rules) поверх онбординг-
// конфігу omlx. Драбину свідомо компонує JS, не Rust-command: той самий
// fail-fast принцип, що й у крейті (жодного retry всередині одного
// `one_shot_*`), і тому, що рішення «чи дозволена підписка на цьому вузлі»
// вже живе тут (autonomy.js), не в Rust-шарі.

const ACP_LADDER = ['cursor', 'codex']

/**
 * Чи дозволена ACP-підписка (Cursor/Codex CLI) для виклику в цьому контексті.
 * Без вузла (напр. критик по всьому воркспейсу, без конкретного taskPath) чи
 * без autonomy.yml на шляху — fail-closed: `resolveAction` повертає
 * `'approve'`, ACP-рунги пропускаються, драбина одразу йде на local/cloud.
 * @param {{ tasksDir?: string, taskPath?: string }} context вузол виклику
 * @returns {Promise<boolean>} true — можна пробувати ACP-рунги
 */
async function acpAllowed({ tasksDir, taskPath } = {}) {
  if (!tasksDir) return false
  try {
    const effective = await effectivePolicyFor(tasksDir, taskPath ?? '')
    return resolveAction(effective, 'external_comms') === 'auto'
  } catch {
    return false
  }
}

/**
 * Композабл каскаду LLM: конфіг local-тиру (omlx) + один виклик за драбиною.
 * @returns {{ baseUrl: import('vue').Ref<string>, model: import('vue').Ref<string>, apiKey: import('vue').Ref<string>, saveOmlx: () => void, oneShot: (req: { tier?: 'min'|'avg'|'max', system?: string, user: string, tasksDir?: string, taskPath?: string }) => Promise<string> }} поверхня каскаду
 */
export function useLlmCascade() {
  const baseUrl = ref(readStored(BASE_URL_KEY) || 'http://127.0.0.1:8000/v1')
  const model = ref(readStored(MODEL_KEY) || DEFAULT_MODEL)
  const apiKey = ref('')

  /** Persist baseUrl/model to localStorage; no-op when unavailable (tests/SSR). */
  function save() {
    try {
      globalThis.localStorage?.setItem(BASE_URL_KEY, baseUrl.value)
      globalThis.localStorage?.setItem(MODEL_KEY, model.value)
    }
    catch {
      // no localStorage — in-memory ref state is still updated
    }
  }

  /**
   * Один виклик LLM: спершу ACP-рунги (якщо дозволено autonomy), інакше чи
   * при провалі всіх — local/cloud тир крейта поверх поточного omlx-конфігу.
   * @param {{ tier?: 'min'|'avg'|'max', system?: string, user: string, tasksDir?: string, taskPath?: string }} req запит
   * @returns {Promise<string>} текст відповіді моделі
   */
  async function oneShot({ tier = 'max', system, user, tasksDir, taskPath }) {
    if (await acpAllowed({ tasksDir, taskPath })) {
      const prompt = system ? `${system}\n\n${user}` : user
      for (const agent of ACP_LADDER) {
        try {
          return await invoke('llm_one_shot_acp', { agent, prompt, cwd: tasksDir })
        } catch {
          // рунг недоступний (CLI не встановлений/не залогінений) — наступний
        }
      }
    }
    return invoke('llm_one_shot', {
      tier,
      system: system ?? null,
      user,
      omlxBaseUrl: baseUrl.value,
      omlxModel: model.value,
      omlxApiKey: apiKey.value || null
    })
  }

  return { baseUrl, model, apiKey, saveOmlx: save, oneShot }
}
