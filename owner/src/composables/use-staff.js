import { briefingPrompt, objectionPrompt, parseBriefing, parseObjection } from '../staff.js'
import { useLlmCascade } from './use-llm-cascade.js'

// Штаб як споживач LLM: briefing і заперечення — окремі виклики моделі за
// вимогою (не автоматичні), через спільну драбину use-llm-cascade.js (той
// самий omlx-конфіг, що плановик і критик).

/**
 * Композабл штабу: генерація брифу й найсильнішого заперечення для рішення.
 * @returns {{ requestBriefing: (digest: string, context?: { tasksDir?: string, taskPath?: string }) => Promise<object>, requestObjection: (digest: string, context?: { tasksDir?: string, taskPath?: string }) => Promise<string> }} поверхня штабу
 */
export function useStaff() {
  const { oneShot } = useLlmCascade()

  /**
   * Генерує бриф рішення: контекст, варіанти, рекомендація, наслідок відмови.
   * @param {string} digest дайджест рішення (staff.js buildDecisionDigest)
   * @param {{ tasksDir?: string, taskPath?: string }} [context] вузол рішення (для autonomy-гейта ACP)
   * @returns {Promise<{ context: string, options: string[], recommendation: string, ifDeclined: string }>} бриф
   */
  async function requestBriefing(digest, context = {}) {
    const { system, user } = briefingPrompt(digest)
    const reply = await oneShot({ system, user, ...context })
    return parseBriefing(reply ?? '')
  }

  /**
   * Генерує найсильніше заперечення проти рішення (анти-rubber-stamping).
   * @param {string} digest дайджест рішення
   * @param {{ tasksDir?: string, taskPath?: string }} [context] вузол рішення (для autonomy-гейта ACP)
   * @returns {Promise<string>} текст заперечення
   */
  async function requestObjection(digest, context = {}) {
    const { system, user } = objectionPrompt(digest)
    const reply = await oneShot({ system, user, ...context })
    return parseObjection(reply ?? '')
  }

  return { requestBriefing, requestObjection }
}
