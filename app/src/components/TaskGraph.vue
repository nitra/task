<template>
  <div class="q-pa-md">
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-input
        v-model="tasksDir"
        @keyup.enter="scan"
        label="Tasks directory"
        dense
        outlined
        class="col"
      />
      <q-btn
        @click="scan"
        icon="sym_o_refresh"
        flat
        round
        dense
        :loading="loading"
        title="Scan"
      />
    </div>

    <q-banner v-if="error" class="bg-red-1 text-red-8 q-mb-md" rounded dense>
      {{ error }}
    </q-banner>

    <div v-if="Object.keys(stateCounts).length" class="row q-gutter-xs q-mb-md">
      <q-badge
        v-for="(count, state) in stateCounts"
        :key="state"
        :color="STATE_COLOR[state] ?? 'grey'"
        class="q-px-sm"
      >
        {{ state.replace('_', '-') }}: {{ count }}
      </q-badge>
    </div>

    <q-card v-if="tasks.length" flat bordered>
      <q-card-section class="q-pa-xs">
        <TaskNodeItem v-for="task in tasks" :key="task.id" :node="task" />
      </q-card-section>
    </q-card>

    <div v-else-if="!loading && !error" class="text-center text-grey q-pa-xl">
      No tasks found
    </div>
  </div>
</template>

<script setup>
import { invoke } from '@tauri-apps/api/core'
import TaskNodeItem from './TaskNodeItem.vue'

const tasksDir = ref('')
const tasks = ref([])
const loading = ref(false)
const error = ref(null)

const STATE_COLOR = {
  human_pending: 'amber-8',
  waiting: 'grey-6',
  running: 'primary',
  pending_audit: 'deep-purple',
  resolved: 'positive',
  failed: 'negative',
  invalidated: 'grey-5',
}

const stateCounts = computed(() => {
  const counts = {}
  const walk = (nodes) => {
    for (const n of nodes) {
      counts[n.state] = (counts[n.state] ?? 0) + 1
      if (n.children?.length) walk(n.children)
    }
  }
  walk(tasks.value)
  return counts
})

/**
 *
 */
async function scan() {
  if (!tasksDir.value) return
  loading.value = true
  error.value = null
  try {
    tasks.value = await invoke('scan_tasks', { tasksDir: tasksDir.value })
  }
  catch (error_) {
    error.value = String(error_)
    tasks.value = []
  }
  finally {
    loading.value = false
  }
}

/**
 *
 */
async function autoDetect() {
  try {
    tasksDir.value = await invoke('find_tasks_dir')
    await scan()
  }
  catch (error_) {
    error.value = String(error_)
  }
}

onMounted(autoDetect)
</script>
