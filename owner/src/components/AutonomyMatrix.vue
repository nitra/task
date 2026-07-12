<template>
  <div class="autonomy-matrix">
    <div v-for="row in rows" :key="row.key" class="autonomy-row">
      <span class="autonomy-label">{{ row.label }}</span>
      <q-btn-toggle
        @update:model-value="setGate(row.key, $event)"
        :model-value="modelValue[row.key] ?? 'inherit'"
        dense
        no-caps
        toggle-color="primary"
        :options="OPTIONS" />
    </div>
    <p class="autonomy-hint">
      «успадкувати» — без власного вибору: рішення бере предок, а без нього — <b>підпис</b> (fail-closed).
    </p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ACTION_CLASSES } from '../autonomy.js'

// Редактор власної (не ефективної) політики вузла: рядок класу дії +
// трипозиційний перемикач успадкувати/auto/approve. 'inherit' не потрапляє
// у modelValue — його відсутність і Є успадкуванням (ratchet, autonomy.js).

const OPTIONS = [
  { label: 'успадкувати', value: 'inherit' },
  { label: 'auto', value: 'auto' },
  { label: 'підпис', value: 'approve' }
]

const LABELS = {
  deploy: 'деплой',
  external_comms: 'зовнішні комунікації',
  spend: 'витрати',
  worktree_edit: 'правки в worktree',
  default: 'усе інше'
}

const props = defineProps({
  modelValue: { type: Object, required: true }
})
const emit = defineEmits(['update:modelValue'])

const rows = computed(() => [...ACTION_CLASSES, 'default'].map(key => ({ key, label: LABELS[key] })))

/**
 * Змінює гейт одного класу; 'inherit' видаляє ключ (успадкування — відсутність запису).
 * @param {string} key клас дії
 * @param {string} gate 'inherit' | 'auto' | 'approve'
 */
function setGate(key, gate) {
  const next = { ...props.modelValue }
  if (gate === 'inherit') delete next[key]
  else next[key] = gate
  emit('update:modelValue', next)
}
</script>

<style scoped>
.autonomy-matrix {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.autonomy-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.autonomy-label {
  font-size: 12px;
  opacity: 0.8;
}

.autonomy-hint {
  margin: 4px 0 0;
  font-size: 11px;
  opacity: 0.55;
}
</style>
