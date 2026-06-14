import { ref } from 'vue'

// Persisted config for the local omlx server (OpenAI-compatible MLX) that drives
// the in-app agent. Defaults match the dev setup; editable in the agent dialog,
// stored in localStorage. The API key is a local-only token.

const BASE_URL_KEY = 'task:omlxBaseUrl'
const MODEL_KEY = 'task:omlxModel'
const API_KEY_KEY = 'task:omlxApiKey'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/v1'
const DEFAULT_MODEL = 'gemma-4-e4b-it-OptiQ-4bit'

/**
 * @returns {{
 *   baseUrl: import('vue').Ref<string>,
 *   model: import('vue').Ref<string>,
 *   apiKey: import('vue').Ref<string>,
 *   save: () => void
 * }} persisted omlx config and a saver
 */
export function useOmlx() {
  const baseUrl = ref(localStorage.getItem(BASE_URL_KEY) || DEFAULT_BASE_URL)
  const model = ref(localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL)
  const apiKey = ref(localStorage.getItem(API_KEY_KEY) || '')

  /**
   * Persist the current config to localStorage.
   */
  function save() {
    localStorage.setItem(BASE_URL_KEY, baseUrl.value)
    localStorage.setItem(MODEL_KEY, model.value)
    localStorage.setItem(API_KEY_KEY, apiKey.value)
  }

  return { baseUrl, model, apiKey, save }
}
