import { invoke } from '@tauri-apps/api/core'
import { useOmlx } from '@7n/tauri-components/vue'
import { resolveAction } from '../autonomy.js'
import { effectivePolicyFor } from './use-autonomy.js'

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
  const { baseUrl, model, apiKey, save } = useOmlx({
    storagePrefix: 'owner',
    defaultModel: 'gemma-4-e4b-it-OptiQ-4bit'
  })

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
