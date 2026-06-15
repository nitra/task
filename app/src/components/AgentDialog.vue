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

    <q-input
      v-model="prompt"
      @keyup.ctrl.enter="run"
      dense
      outlined
      autofocus
      type="textarea"
      autogrow
      label="Prompt"
      hint="наприклад: Create a task named deploy in /Users/.../mt, agent mode"
    />

    <RequestView v-if="result" @respond="onRespond" :result="result" :busy="running" />

    <template #actions>
      <q-btn v-close-popup label="Закрити" flat no-caps />
      <q-btn
        @click="run"
        label="Запустити"
        unelevated
        no-caps
        color="primary"
        icon="sym_o_play_arrow"
        :disable="!prompt.trim() || running"
        :loading="running"
      />
    </template>
  </BaseDialog>
</template>

<script setup>
import { ref } from 'vue'
import { useQuasar } from 'quasar'
import BaseDialog from './BaseDialog.vue'
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
const result = ref(null)
const showConfig = ref(false)

/**
 * Pull omlx config from the user's global settings; reset transient state.
 */
async function onShow() {
  prompt.value = ''
  result.value = null
  await loadOmlxEnv()
}

/**
 * Apply the outcome: store it, refresh the graph if anything was created.
 * @param {object} outcome structured result from request/respond
 */
function apply(outcome) {
  result.value = outcome
  if (outcome.actions?.some(action => action.envelope?.ok)) emit('ran')
}

/**
 * Start a new agent request from the prompt (journaled).
 */
async function run() {
  if (!prompt.value.trim() || running.value) return
  running.value = true
  try {
    saveOmlx()
    apply(await request(prompt.value))
  }
  catch (error) {
    $q.notify({ type: 'negative', message: String(error?.message ?? error) })
  }
  finally {
    running.value = false
  }
}

/**
 * Answer a pending clarification (sessional resume).
 * @param {string} message the human's answer
 */
async function onRespond(message) {
  running.value = true
  try {
    apply(await respond(result.value.requestId, message))
  }
  catch (error) {
    $q.notify({ type: 'negative', message: String(error?.message ?? error) })
  }
  finally {
    running.value = false
  }
}
</script>
