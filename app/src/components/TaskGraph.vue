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
        <TaskNodeItem v-for="task in tasks" :key="task.id" :node="task" @select="onSelect" />
      </q-card-section>
    </q-card>

    <div v-else-if="!loading && !error" class="text-center text-grey q-pa-xl">
      No tasks found
    </div>

    <q-dialog v-model="drawerOpen" transition-show="fade" transition-hide="fade">
      <q-card class="task-detail-card">
        <q-card-section class="row items-center q-pb-none">
          <q-icon :name="selectedCfg.icon" :color="selectedCfg.color" size="20px" class="q-mr-sm" />
          <span class="text-h6" style="font-family: monospace">{{ selectedTask?.id }}</span>
          <q-badge :color="selectedCfg.color" outline class="q-ml-sm">{{ selectedCfg.label }}</q-badge>
          <q-space />
          <q-btn icon="sym_o_close" flat round dense v-close-popup />
        </q-card-section>

        <q-separator class="q-mt-sm" />

        <q-card-section class="q-pa-md scroll task-detail-content">
          <div v-if="contentLoading" class="text-center q-pa-xl">
            <q-spinner size="40px" color="primary" />
          </div>
          <div v-else-if="contentError" class="text-red">{{ contentError }}</div>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-else class="markdown-body" v-html="renderedContent" />
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { marked } from 'marked'
import { invoke } from '@tauri-apps/api/core'
import TaskNodeItem from './TaskNodeItem.vue'

const tasksDir = ref('')
const tasks = ref([])
const loading = ref(false)
const error = ref(null)

const drawerOpen = ref(false)
const selectedTask = ref(null)
const taskContent = ref('')
const contentLoading = ref(false)
const contentError = ref(null)

const STATE_COLOR = {
  unassigned: 'grey-4',
  human_pending: 'amber-8',
  waiting: 'grey-6',
  running: 'primary',
  pending_audit: 'deep-purple',
  resolved: 'positive',
  failed: 'negative',
  invalidated: 'grey-5',
}

const STATE_CFG = {
  unassigned: { icon: 'sym_o_person_off', color: 'grey-4', label: 'unassigned' },
  human_pending: { icon: 'sym_o_schedule', color: 'amber-8', label: 'human-pending' },
  waiting: { icon: 'sym_o_radio_button_unchecked', color: 'grey-6', label: 'waiting' },
  running: { icon: 'sym_o_radio_button_checked', color: 'primary', label: 'running' },
  pending_audit: { icon: 'sym_o_pending', color: 'deep-purple', label: 'pending-audit' },
  resolved: { icon: 'sym_o_check_circle', color: 'positive', label: 'resolved' },
  failed: { icon: 'sym_o_cancel', color: 'negative', label: 'failed' },
  invalidated: { icon: 'sym_o_block', color: 'grey-5', label: 'invalidated' },
}

const selectedCfg = computed(() => STATE_CFG[selectedTask.value?.state] ?? STATE_CFG.waiting)

const renderedContent = computed(() => marked.parse(taskContent.value))

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

async function onSelect(node) {
  selectedTask.value = node
  drawerOpen.value = true
  contentLoading.value = true
  contentError.value = null
  taskContent.value = ''
  try {
    taskContent.value = await invoke('read_task', { tasksDir: tasksDir.value, taskPath: node.path })
  }
  catch (err) {
    contentError.value = String(err)
  }
  finally {
    contentLoading.value = false
  }
}

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

<style scoped>
.task-detail-card {
  width: 640px;
  max-width: 92vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.task-detail-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  margin-top: 1.2em;
  margin-bottom: 0.4em;
  font-weight: 600;
}

.markdown-body :deep(h2) {
  font-size: 1.1em;
  border-bottom: 1px solid rgba(0 0 0 / 10%);
  padding-bottom: 4px;
}

.markdown-body :deep(p) {
  margin-bottom: 0.6em;
  line-height: 1.6;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 1.5em;
  margin-bottom: 0.6em;
}

.markdown-body :deep(li) {
  margin-bottom: 0.2em;
  line-height: 1.5;
}

.markdown-body :deep(code) {
  background: rgba(0 0 0 / 6%);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.9em;
}

.markdown-body :deep(strong) {
  font-weight: 600;
}

.markdown-body :deep(input[type="checkbox"]) {
  margin-right: 6px;
}
</style>
