import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

// Persisted config for the local omlx server (OpenAI-compatible MLX) that drives
// the in-app agent. The API key / base URL come from Rust (omlx_config), which
// reads them from ~/.omlx/settings.json — той самий файл, що й omlx-сервер, тож
// конфіг портативний між машинами без жодних env/launchd налаштувань. baseUrl
// редагується в діалозі й кешується в localStorage; omlx_config — його дефолт, // коли в localStorage нічого нема.
// > hardcoded default. Ключ завжди з omlx_config (~/.omlx/settings.json). nonprofit

const BASE_URL_KEY = 'task:omlxBaseUrl'
const MODEL_KEY = 'task:omlxModel'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/v1'
const DEFAULT_MODEL = 'gemma-4-e4b-it-OptiQ-4bit'

/**
 * @returns {{"baseUrl": import('vue').Ref<string>, "model": import('vue').Ref<string>, "apiKey": import('vue').Ref<string>, "save": () => void, "loadEnv": () => Promise<void>}} persisted omlx config, an env loader and a saver
 */
export function useOmlx() {
  const baseUrl = ref(localStorage.getItem(BASE_URL_KEY) || DEFAULT_BASE_URL)
  const model = ref(localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL)
  // Заповнюється з глобального env у loadEnv(); у localStorage не зберігається. apiKey
  const apiKey = ref('')

  /**
   * Pull OMLX_* from the user's global env (via Rust) and apply them: the API
   * key is taken verbatim; baseUrl/model only fill in when localStorage is empty,
   * so a value set in the dialog still wins. No-op outside Tauri (tests / web).
   * @returns {Promise<void>}
   */
  async function loadEnv() {
    let env
    try {
      env = await invoke('omlx_config')
    } catch {
      return // not running under Tauri — keep localStorage / defaults
    }
    if (!env) return
    if (env.apiKey) apiKey.value = env.apiKey
    if (env.baseUrl && !localStorage.getItem(BASE_URL_KEY)) baseUrl.value = env.baseUrl
    if (env.model && !localStorage.getItem(MODEL_KEY)) model.value = env.model
  }

  /**
   * Persist baseUrl/model to localStorage. The API key is intentionally NOT
   * persisted — it comes from the global OMLX_API_KEY env on each launch.
   */
  function save() {
    localStorage.setItem(BASE_URL_KEY, baseUrl.value)
    localStorage.setItem(MODEL_KEY, model.value)
  }

  return { baseUrl, model, apiKey, save, loadEnv }
}