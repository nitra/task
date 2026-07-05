<template>
  <div v-if="node.state === 'plan_review'" class="node-actions">
    <div class="node-actions__title">Plan review — {{ review?.plan_file }}</div>

    <q-markup-table v-if="review?.children.length" flat dense class="node-actions__table">
      <thead>
        <tr>
          <th class="text-left">id</th>
          <th class="text-left">mode</th>
          <th class="text-left">tier / qualification</th>
          <th class="text-left">deps</th>
          <th class="text-right">budget</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="child in review.children" :key="child.id">
          <td>{{ child.id }}</td>
          <td>{{ child.mode }}</td>
          <td>{{ child.mode === 'human' ? (child.qualification ?? '—') : (child.model_tier ?? 'AVG') }}</td>
          <td>{{ child.deps.join(', ') || '—' }}</td>
          <td class="text-right">{{ child.budget_sec ? child.budget_sec + 's' : '—' }}</td>
        </tr>
      </tbody>
    </q-markup-table>

    <div class="row items-center q-gutter-sm q-mt-sm">
      <q-btn
        @click="approve"
        :loading="busy"
        label="Approve"
        icon="sym_o_thumb_up"
        color="positive"
        size="sm"
        unelevated
        dense />
      <q-btn
        @click="rejectOpen = !rejectOpen"
        label="Reject"
        icon="sym_o_thumb_down"
        color="negative"
        size="sm"
        outline
        dense />
    </div>
    <div v-if="rejectOpen" class="row items-center q-gutter-sm q-mt-sm">
      <q-input v-model="rejectReason" placeholder="причина відхилення" dense outlined class="col" />
      <q-btn
        @click="reject"
        :disable="!rejectReason.trim()"
        :loading="busy"
        label="Confirm reject"
        color="negative"
        size="sm"
        unelevated
        dense />
    </div>
    <div v-if="actionError" class="node-actions__error">{{ actionError }}</div>
  </div>

  <div v-else-if="node.state === 'unassigned'" class="node-actions">
    <div class="node-actions__title">No executor — assign one</div>
    <div class="row items-center q-gutter-sm">
      <q-btn
        @click="assign('agent')"
        :loading="busy"
        label="Agent"
        icon="sym_o_smart_toy"
        color="primary"
        size="sm"
        unelevated
        dense />
      <q-btn
        @click="assign('human')"
        :loading="busy"
        label="Human"
        icon="sym_o_person"
        color="orange"
        size="sm"
        outline
        dense />
    </div>
    <div v-if="actionError" class="node-actions__error">{{ actionError }}</div>
  </div>
</template>

<script setup>
import { invoke } from '@tauri-apps/api/core'

const props = defineProps({
  node: { type: Object, required: true },
  tasksDir: { type: String, required: true }
})

const emit = defineEmits(['changed'])

const review = ref(null)
const busy = ref(false)
const rejectOpen = ref(false)
const rejectReason = ref('')
const actionError = ref(null)

watch(
  () => [props.node.path, props.node.state],
  async () => {
    review.value = null
    actionError.value = null
    rejectOpen.value = false
    if (props.node.state !== 'plan_review') return
    try {
      review.value = await invoke('plan_review_info', {
        tasksDir: props.tasksDir,
        taskPath: props.node.path
      })
    } catch (error) {
      actionError.value = String(error)
    }
  },
  { immediate: true }
)

/**
 * Виконує дію-мутацію і повідомляє батька про зміну графу.
 * @param {() => Promise<unknown>} action виклик Tauri-команди
 */
async function run(action) {
  busy.value = true
  actionError.value = null
  try {
    await action()
    emit('changed')
  } catch (error) {
    actionError.value = String(error)
  } finally {
    busy.value = false
  }
}

/**
 * Approve актуального composite-плану: матеріалізує дітей.
 * @returns {Promise<void>} завершення дії
 */
function approve() {
  return run(() => invoke('spawn_approve', { tasksDir: props.tasksDir, taskPath: props.node.path }))
}

/**
 * Reject актуального плану з причиною.
 * @returns {Promise<void>} завершення дії
 */
function reject() {
  return run(() =>
    invoke('spawn_reject', {
      tasksDir: props.tasksDir,
      taskPath: props.node.path,
      reason: rejectReason.value
    })
  )
}

/**
 * Призначає виконавця unassigned-вузлу.
 * @param {'agent'|'human'} mode тип виконавця
 * @returns {Promise<void>} завершення дії
 */
function assign(mode) {
  return run(() => invoke('set_executor', { tasksDir: props.tasksDir, taskPath: props.node.path, mode }))
}
</script>

<style scoped>
.node-actions {
  padding: 10px 16px;
  border-bottom: 1px solid rgb(128 128 128 / 15%);
}

.node-actions__title {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.55;
  margin-bottom: 8px;
}

.node-actions__table {
  background: transparent;
  font-size: 12px;
}

.node-actions__error {
  margin-top: 8px;
  font-size: 12px;
  color: #ff6b60;
}
</style>
