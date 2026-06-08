<template>
  <div class="q-pa-md">
    <div class="row items-center q-mb-md">
      <span class="text-body2 text-grey-7">Tasks</span>
      <q-space />
      <q-btn
        @click="scanAll"
        icon="sym_o_refresh"
        flat
        round
        dense
        :loading="loading"
        title="Rescan"
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

    <div v-if="!loading && workspaces.length === 0 && !error" class="text-center text-grey q-pa-xl">
      No workspaces found
    </div>

    <div v-for="ws in workspaces" :key="ws.path" class="q-mb-lg">
      <div class="workspace-label text-caption text-weight-medium text-grey-6 q-mb-xs q-px-xs">
        {{ ws.label }}
      </div>
      <q-card v-if="workspaceNodes[ws.path]?.length" flat bordered>
        <q-card-section class="q-pa-xs">
          <TaskNodeItem
            v-for="task in workspaceNodes[ws.path]"
            :key="task.id"
            @select="node => onSelect(node, ws.path)"
            :node="task"
          />
        </q-card-section>
      </q-card>
      <div v-else-if="!loading" class="text-caption text-grey q-pa-sm q-ml-xs">
        —
      </div>
    </div>

    <q-dialog v-model="drawerOpen" transition-show="fade" transition-hide="fade">
      <q-card class="task-detail-card">
        <q-card-section class="row items-center q-pb-none">
          <q-icon :name="selectedCfg.icon" :color="selectedCfg.color" size="20px" class="q-mr-sm" />
          <span class="text-h6" style="font-family: monospace">{{ selectedTask?.id }}</span>
          <q-badge :color="selectedCfg.color" outline class="q-ml-sm">{{ selectedCfg.label }}</q-badge>
          <q-space />
          <q-btn v-close-popup icon="sym_o_close" flat round dense />
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

const workspaces = ref([])
const workspaceNodes = ref({})
const loading = ref(false)
const error = ref(null)

const drawerOpen = ref(false)
const selectedTask = ref(null)
const selectedTasksDir = ref('')
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
  for (const nodes of Object.values(workspaceNodes.value)) {
    walk(nodes)
  }
  return counts
})

/**
 *
 */
async function onSelect(node, tasksDir) {
  selectedTask.value = node
  selectedTasksDir.value = tasksDir
  drawerOpen.value = true
  contentLoading.value = true
  contentError.value = null
  taskContent.value = ''
  try {
    taskContent.value = await invoke('read_task', { tasksDir, taskPath: node.path })
  }
  catch (error) {
    contentError.value = String(error)
  }
  finally {
    contentLoading.value = false
  }
}

/**
 *
 */
async function scanAll() {
  loading.value = true
  error.value = null
  try {
    workspaces.value = await invoke('find_all_tasks_dirs')
    await Promise.all(
      workspaces.value.map(async (ws) => {
        try {
          workspaceNodes.value[ws.path] = await invoke('scan_tasks', { tasksDir: ws.path })
        }
        catch {
          workspaceNodes.value[ws.path] = []
        }
      }),
    )
  }
  catch (error) {
    error.value = String(error)
  }
  finally {
    loading.value = false
  }
}

onMounted(scanAll)
</script>

<style scoped>
.workspace-label {
  letter-spacing: 0.03em;
  text-transform: uppercase;
  font-size: 0.7rem;
  border-bottom: 1px solid rgba(0 0 0 / 8%);
  padding-bottom: 2px;
}

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
