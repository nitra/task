import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { handleApprove, handleRequest, handleRespond } from '../tool/agent-handler.js'
import { createOpenAiChat } from '../tool/llm.js'
import { dispatch } from '../tool/index.js'
import { createTauriJournalStore } from '../tool/journal-store-tauri.js'
import { useOmlx } from './use-omlx.js'

// In-app agent gateway: the SAME handleRequest/handleRespond the MCP bin uses,
// wired with the webview transports — omlx via tauri-http, tools via dispatch,
// journal via Tauri commands. Human requests land in the shared journal too.

const ACTOR = { kind: 'human', id: 'local' }

/**
 * @returns {{
 *   baseUrl: import('vue').Ref<string>, model: import('vue').Ref<string>, apiKey: import('vue').Ref<string>,
 *   saveOmlx: () => void, loadOmlxEnv: () => Promise<void>,
 *   journal: object,
 *   request: (intent: string) => Promise<object>,
 *   respond: (requestId: string, message: string) => Promise<object>,
 *   approve: (requestId: string, approve: boolean) => Promise<object>,
 * }} in-app agent gateway
 */
export function useAgent() {
  const { baseUrl, model, apiKey, save, loadEnv } = useOmlx()
  const journal = createTauriJournalStore()

  /**
   * Build an omlx chat fn from the current config (tauri-http transport).
   * @returns {(req: object) => Promise<object>} chat function
   */
  function chat() {
    return createOpenAiChat({
      baseUrl: baseUrl.value,
      model: model.value,
      apiKey: apiKey.value || undefined,
      fetchFn: tauriFetch,
    })
  }

  return {
    baseUrl,
    model,
    apiKey,
    saveOmlx: save,
    loadOmlxEnv: loadEnv,
    journal,
    request: intent => handleRequest({ intent, actor: ACTOR, chat: chat(), dispatch, journal }),
    respond: (requestId, message) => handleRespond({ requestId, message, actor: ACTOR, chat: chat(), dispatch, journal }),
    approve: (requestId, approve) => handleApprove({ requestId, approve, dispatch, journal }),
  }
}
