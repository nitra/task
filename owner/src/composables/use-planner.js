import { createOpenAiChat } from '@7n/tauri-components'
import { useOmlx } from '@7n/tauri-components/vue'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { LENSES, parseAlternative, plannerPrompt } from '../planner.js'

// Плановик як споживач LLM: два незалежні виклики моделі (по одному на лінзу)
// паралельно; кожен повертає альтернативу або помилку — власник бачить обидва
// результати навіть коли одна лінза не впоралась. Провайдер — omlx-конфіг
// (localStorage, префікс owner), транспорт — tauri-http.

/**
 * Композабл плановика: конфіг моделі + генерація альтернатив декомпозиції.
 * @returns {{ baseUrl: import('vue').Ref<string>, model: import('vue').Ref<string>, apiKey: import('vue').Ref<string>, saveOmlx: () => void, draftAlternatives: (intent: string) => Promise<object[]> }} поверхня плановика
 */
export function usePlanner() {
  const { baseUrl, model, apiKey, save } = useOmlx({
    storagePrefix: 'owner',
    defaultModel: 'gemma-4-e4b-it-OptiQ-4bit'
  })

  /**
   * Генерує альтернативи плану — по одній на лінзу, паралельно.
   * @param {string} intent ціль власника природною мовою
   * @returns {Promise<Array<{ lens: object, alternative?: object, error?: string }>>} результат кожної лінзи
   */
  function draftAlternatives(intent) {
    const chat = createOpenAiChat({
      baseUrl: baseUrl.value,
      model: model.value,
      apiKey: apiKey.value || undefined,
      fetchFn: tauriFetch
    })
    return Promise.all(
      LENSES.map(async lens => {
        try {
          const { system, user } = plannerPrompt(intent, lens)
          const reply = await chat({
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ],
            tools: []
          })
          return { lens, alternative: parseAlternative(reply.content ?? '') }
        } catch (error) {
          return { lens, error: String(error?.message ?? error) }
        }
      })
    )
  }

  return { baseUrl, model, apiKey, saveOmlx: save, draftAlternatives }
}
