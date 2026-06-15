<template>
  <BaseDialog
    @update:model-value="val => emit('update:modelValue', val)"
    @show="onShow"
    :model-value="modelValue"
    title="Agent (local LLM)"
    icon="sym_o_smart_toy"
    :width="560"
    body-class="q-gutter-sm"
  >
    <template #header>
      <q-btn @click="showConfig = !showConfig" icon="sym_o_tune" flat round dense size="sm" title="omlx config" />
    </template>

    <template v-if="showConfig">
      <q-input v-model="baseUrl" dense outlined label="omlx base URL" />
      <q-input v-model="model" dense outlined label="model" />
      <q-input v-model="apiKey" dense outlined label="API key" type="password" />
      <q-separator class="q-my-sm" />
    </template>

    <div v-if="turns.length" ref="logEl" class="chat-log">
      <template v-for="(turn, i) in turns" :key="i">
        <div v-if="turn.role === 'user'" class="chat-user">{{ turn.text }}</div>
        <RequestView v-else :result="turn.result" />
      </template>
      <div v-if="running" class="chat-thinking">
        <q-spinner-dots size="18px" /> думаю…
      </div>
    </div>

    <q-input
      v-model="prompt"
      @keyup.ctrl.enter="send"
      dense
      outlined
      autofocus
      type="textarea"
      autogrow
      :label="inputLabel"
      hint="наприклад: Create a task named deploy in /Users/.../mt, agent mode"
    />

    <!-- jscpd:ignore-start — formal footer markup; jscpd html-mode aligns its
         attribute tokens with an unrelated import block (no shared logic) -->
    <template #actions>
      <DialogActions
        @submit="send"
        cancel-label="Закрити"
        :submit-label="sendLabel"
        icon="sym_o_play_arrow"
        :disable="sendDisabled"
        :loading="running"
      />
    </template>
    <!-- jscpd:ignore-end -->
  </BaseDialog>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import { useQuasar } from 'quasar'
import BaseDialog from './BaseDialog.vue'
import DialogActions from './DialogActions.vue'
import RequestView from './RequestView.vue'
import { useAgent } from '../composables/use-agent.js'

defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'ran'])

const $q = useQuasar()
const { baseUrl, model, apiKey, saveOmlx, loadOmlxEnv, request, respond } = useAgent()

const prompt = ref('')
const running = ref(false)
const turns = ref([])
const requestId = ref(null)
const logEl = ref(null)
const showConfig = ref(false)

// Labels shift once a conversation is under way (fresh request → follow-up).
const inputLabel = computed(() => (turns.value.length ? 'Повідомлення' : 'Prompt'))
const sendLabel = computed(() => (turns.value.length ? 'Надіслати' : 'Запустити'))
const sendDisabled = computed(() => running.value || !prompt.value.trim())

/**
 * Pull omlx config from the user's global settings; reset the conversation.
 */
async function onShow() {
  prompt.value = ''
  turns.value = []
  requestId.value = null
  await loadOmlxEnv()
}

/**
 * Scroll the transcript to the latest turn after the DOM settles.
 */
async function scrollToEnd() {
  await nextTick()
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
}

/**
 * Append an agent turn, latch the conversation id, refresh the graph on writes.
 * @param {object} outcome structured result from request/respond
 */
function apply(outcome) {
  if (outcome.requestId) requestId.value = outcome.requestId
  turns.value.push({ role: 'agent', result: outcome })
  if (outcome.actions?.some(action => action.envelope?.ok)) emit('ran')
  scrollToEnd()
}

/**
 * Send the current message: start a new request, or resume the conversation.
 */
async function send() {
  const text = prompt.value.trim()
  if (!text || running.value) return
  prompt.value = ''
  turns.value.push({ role: 'user', text })
  scrollToEnd()
  running.value = true
  try {
    saveOmlx()
    apply(await (requestId.value ? respond(requestId.value, text) : request(text)))
  } catch (error) {
    $q.notify({ type: 'negative', message: String(error?.message ?? error) })
  }
  finally {
    running.value = false
  }
}
</script>

<style scoped>
.chat-log {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 46vh;
  overflow-y: auto;
  padding: 2px;
}

.chat-user {
  align-self: flex-end;
  max-width: 85%;
  padding: 7px 11px;
  border-radius: 12px 12px 2px 12px;
  background: color-mix(in srgb, #0a84ff 18%, transparent);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.45;
}

.chat-thinking {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  opacity: 0.7;
}
</style>