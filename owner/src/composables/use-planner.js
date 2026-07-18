import { LENSES, parseAlternative, plannerPrompt } from '../planner.js'
import { useLlmCascade } from './use-llm-cascade.js'

// Плановик як споживач LLM: два незалежні виклики моделі (по одному на лінзу)
// паралельно; кожен повертає альтернативу або помилку — власник бачить обидва
// результати навіть коли одна лінза не впоралась. Виклик — спільна драбина
// use-llm-cascade.js (ACP-підписка → omlx local/cloud тир).

/**
 * Композабл плановика: конфіг моделі + генерація альтернатив декомпозиції.
 * @returns {{ baseUrl: import('vue').Ref<string>, model: import('vue').Ref<string>, apiKey: import('vue').Ref<string>, saveOmlx: () => void, draftAlternatives: (intent: string, context?: { tasksDir?: string, taskPath?: string }) => Promise<object[]> }} поверхня плановика
 */
export function usePlanner() {
  const { baseUrl, model, apiKey, saveOmlx, oneShot } = useLlmCascade()

  /**
   * Генерує альтернативи плану — по одній на лінзу, паралельно.
   * @param {string} intent ціль власника природною мовою
   * @param {{ tasksDir?: string, taskPath?: string }} [context] вузол цілі (для autonomy-гейта ACP)
   * @returns {Promise<Array<{ lens: object, alternative?: object, error?: string }>>} результат кожної лінзи
   */
  function draftAlternatives(intent, context = {}) {
    return Promise.all(
      LENSES.map(async lens => {
        try {
          const { system, user } = plannerPrompt(intent, lens)
          const reply = await oneShot({ system, user, ...context })
          return { lens, alternative: parseAlternative(reply ?? '') }
        } catch (error) {
          return { lens, error: String(error?.message ?? error) }
        }
      })
    )
  }

  return { baseUrl, model, apiKey, saveOmlx, draftAlternatives }
}
