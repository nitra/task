<template>
  <div class="req-view">
    <span class="state-pill" :style="{ '--c': statusColor }">
      <span class="state-pill__dot" />
      {{ result.status }}
    </span>

    <div v-if="result.summary" class="req-summary">{{ result.summary }}</div>
    <div v-if="result.error" class="req-error">{{ result.error }}</div>

    <div v-if="result.actions?.length" class="req-actions">
      <div v-for="(action, i) in result.actions" :key="i" class="req-action">
        <q-icon
          :name="action.envelope?.ok ? 'sym_o_check_circle' : 'sym_o_error'"
          :color="action.envelope?.ok ? 'positive' : 'negative'"
          size="14px"
        />
        <code>{{ action.tool }}({{ JSON.stringify(action.input) }})</code>
      </div>
    </div>

    <div v-if="result.status === 'needs_clarification'" class="req-clarify">
      <div class="req-question">{{ result.question }}</div>
      <q-input
        v-model="answer"
        @keyup.ctrl.enter="send"
        dense
        outlined
        autogrow
        placeholder="Відповідь…"
      />
      <q-btn
        @click="send"
        label="Відповісти"
        color="primary"
        unelevated
        no-caps
        :disable="!answer.trim() || busy"
        :loading="busy"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const STATUS_COLOR = {
  pending: '#8e8e93',
  running: '#0a84ff',
  done: '#30d158',
  partial: '#ff9f0a',
  needs_clarification: '#64d2ff',
  needs_approval: '#ff9f0a',
  failed: '#ff453a',
}

const props = defineProps({
  result: { type: Object, required: true },
  busy: { type: Boolean, default: false },
})
const emit = defineEmits(['respond'])

const answer = ref('')
const statusColor = computed(() => STATUS_COLOR[props.result.status] ?? '#8e8e93')

/**
 * Emit the human's clarification answer to the parent and clear the field.
 */
function send() {
  if (!answer.value.trim()) return
  emit('respond', answer.value)
  answer.value = ''
}
</script>

<style scoped>
.req-view {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.req-summary {
  line-height: 1.5;
  white-space: pre-wrap;
  font-size: 13px;
}

.req-error {
  color: #ff6b60;
  font-size: 13px;
}

.req-actions {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.req-action {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  opacity: 0.8;
  overflow-wrap: anywhere;
}

.req-clarify {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-radius: 8px;
  background: color-mix(in srgb, #64d2ff 12%, transparent);
}

.req-question {
  font-size: 13px;
  font-weight: 500;
}

.state-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  height: 20px;
  padding: 0 8px;
  border-radius: 6px;
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 28%, transparent);
}

.state-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c);
}
</style>
