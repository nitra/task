<template>
  <q-dialog v-model="open" transition-show="fade" transition-hide="fade">
    <q-card class="ledger-card">
      <q-card-section class="row items-center no-wrap q-pb-sm">
        <q-icon name="sym_o_query_stats" size="20px" class="q-mr-sm" />
        <span class="ledger-title">Cost ledger — {{ workspaceLabel }}</span>
        <q-space />
        <q-btn v-close-popup icon="sym_o_close" flat round dense size="sm" />
      </q-card-section>

      <q-separator />

      <q-card-section class="q-pa-md scroll ledger-body">
        <div v-if="loading" class="text-center q-pa-xl">
          <q-spinner size="40px" color="primary" />
        </div>
        <div v-else-if="errorMessage" class="text-red">{{ errorMessage }}</div>
        <template v-else>
          <div v-if="!ledger?.nodes?.length" class="ledger-empty">жодного run_NNN.md ще немає в цьому воркспейсі</div>
          <template v-else>
            <div class="ledger-total row q-mb-md">
              <div class="ledger-total__item">
                <div class="ledger-total__label">runs</div>
                <div class="ledger-total__value">{{ ledger.total.runs }}</div>
              </div>
              <div class="ledger-total__item">
                <div class="ledger-total__label">wall time</div>
                <div class="ledger-total__value">{{ formatDuration(ledger.total.wall_sec) }}</div>
              </div>
              <div class="ledger-total__item">
                <div class="ledger-total__label">cost</div>
                <div class="ledger-total__value">{{ formatCost(ledger.total.cost_usd) }}</div>
              </div>
              <div class="ledger-total__item">
                <div class="ledger-total__label">tokens in / out</div>
                <div class="ledger-total__value">
                  {{ formatTokens(ledger.total.tokens_in) }} / {{ formatTokens(ledger.total.tokens_out) }}
                </div>
              </div>
            </div>

            <q-markup-table flat dense class="ledger-table">
              <thead>
                <tr>
                  <th class="text-left">node</th>
                  <th class="text-right">runs</th>
                  <th class="text-right">wall time</th>
                  <th class="text-right">cost</th>
                  <th class="text-right">tokens in / out</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in ledger.nodes" :key="entry.path">
                  <td class="ledger-table__path">{{ entry.path }}</td>
                  <td class="text-right">{{ entry.runs }}</td>
                  <td class="text-right">{{ formatDuration(entry.wall_sec) }}</td>
                  <td class="text-right">{{ formatCost(entry.cost_usd) }}</td>
                  <td class="text-right">{{ formatTokens(entry.tokens_in) }} / {{ formatTokens(entry.tokens_out) }}</td>
                </tr>
              </tbody>
            </q-markup-table>
          </template>
        </template>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { invoke } from '@tauri-apps/api/core'
import { formatCost, formatDuration, formatTokens } from '../format-ledger.js'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  tasksDir: { type: String, required: true },
  workspaceLabel: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue'])

const open = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})

const ledger = ref(null)
const loading = ref(false)
const errorMessage = ref(null)

watch(open, async isOpen => {
  if (!isOpen) return
  loading.value = true
  errorMessage.value = null
  try {
    ledger.value = await invoke('cost_ledger', { tasksDir: props.tasksDir })
  } catch (error) {
    errorMessage.value = String(error)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.ledger-card {
  width: 620px;
  max-width: 92vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
}

.ledger-title {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 600;
}

.ledger-body {
  flex: 1;
  overflow-y: auto;
}

.ledger-empty {
  text-align: center;
  padding: 32px 0;
  font-size: 13px;
  opacity: 0.4;
}

.ledger-total {
  gap: 20px;
}

.ledger-total__label {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.5;
}

.ledger-total__value {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 16px;
  font-weight: 600;
}

.ledger-table {
  background: transparent;
  font-size: 12px;
}

.ledger-table__path {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
}
</style>
