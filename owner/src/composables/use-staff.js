import { createOpenAiChat } from '@7n/tauri-components'
import { useOmlx } from '@7n/tauri-components/vue'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { briefingPrompt, objectionPrompt, parseBriefing, parseObjection } from '../staff.js'

// Штаб як споживач LLM: briefing і заперечення — окремі виклики моделі за
// вимогою (не автоматичні), той самий omlx-конфіг, що плановик і критик.

/**
 * Композабл штабу: генерація брифу й найсильнішого заперечення для рішення.
 * @returns {{ requestBriefing: (digest: string) => Promise<object>, requestObjection: (digest: string) => Promise<string> }} поверхня штабу
 */
export function useStaff() {
  const { baseUrl, model, apiKey } = useOmlx({
    storagePrefix: 'owner',
    defaultModel: 'gemma-4-e4b-it-OptiQ-4bit'
  })

  /**
   * @returns {(req: object) => Promise<object>} chat-функція за поточним конфігом
   */
  function chat() {
    return createOpenAiChat({
      baseUrl: baseUrl.value,
      model: model.value,
      apiKey: apiKey.value || undefined,
      fetchFn: tauriFetch
    })
  }

  /**
   * Генерує бриф рішення: контекст, варіанти, рекомендація, наслідок відмови.
   * @param {string} digest дайджест рішення (staff.js buildDecisionDigest)
   * @returns {Promise<{ context: string, options: string[], recommendation: string, ifDeclined: string }>} бриф
   */
  async function requestBriefing(digest) {
    const { system, user } = briefingPrompt(digest)
    const reply = await chat()({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      tools: []
    })
    return parseBriefing(reply.content ?? '')
  }

  /**
   * Генерує найсильніше заперечення проти рішення (анти-rubber-stamping).
   * @param {string} digest дайджест рішення
   * @returns {Promise<string>} текст заперечення
   */
  async function requestObjection(digest) {
    const { system, user } = objectionPrompt(digest)
    const reply = await chat()({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      tools: []
    })
    return parseObjection(reply.content ?? '')
  }

  return { requestBriefing, requestObjection }
}
