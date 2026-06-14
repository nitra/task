<template>
  <BaseDialog
    @update:model-value="val => emit('update:modelValue', val)"
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

    <div v-if="result" class="agent-result">
      <div v-if="result.content" class="agent-answer">{{ result.content }}</div>
      <div v-if="result.trace.length" class="agent-trace">
        <div v-for="(step, i) in result.trace" :key="i" class="agent-step">
          <q-icon
            :name="step.envelope.ok ? 'sym_o_check_circle' : 'sym_o_error'"
            :color="step.envelope.ok ? 'positive' : 'negative'"
            size="14px"
          />
          <code>{{ step.tool }}({{ JSON.stringify(step.input) }})</code>
        </div>
      </div>
      <div v-if="result.stopped" class="agent-stopped">stopped: {{ result.stopped }}</div>
    </div>

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
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import BaseDialog from './BaseDialog.vue'
import { createOpenAiChat, runAgent } from '../tool/llm.js'
import { dispatch } from '../tool/index.js'
import { useOmlx } from '../composables/use-omlx.js'

defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'ran'])

const $q = useQuasar()
const { baseUrl, model, apiKey, save } = useOmlx()

const prompt = ref('')
const running = ref(false)
const result = ref(null)
const showConfig = ref(false)

/**
 * Run the agent loop in-app: model via omlx (tauri-http), tools via dispatch.
 */
async function run() {
  if (!prompt.value.trim() || running.value) return
  running.value = true
  result.value = null
  try {
    save()
    const chat = createOpenAiChat({
      baseUrl: baseUrl.value,
      model: model.value,
      apiKey: apiKey.value || undefined,
      fetchFn: tauriFetch,
    })
    result.value = await runAgent({ prompt: prompt.value, dispatch, chat })
    if (result.value.trace.some(step => step.envelope.ok)) emit('ran')
  }
  catch (error) {
    $q.notify({ type: 'negative', message: String(error?.message ?? error) })
  }
  finally {
    running.value = false
  }
}
</script>

<style scoped>
.agent-result {
  border-radius: 8px;
  padding: 10px 12px;
  background: rgb(255 255 255 / 4%);
  font-size: 13px;
}

.body--light .agent-result {
  background: rgb(0 0 0 / 3%);
}

.agent-answer {
  line-height: 1.5;
  margin-bottom: 8px;
  white-space: pre-wrap;
}

.agent-step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  opacity: 0.8;
  overflow-wrap: anywhere;
}

.agent-stopped {
  margin-top: 6px;
  font-size: 11px;
  color: #ff9f0a;
}
</style>
