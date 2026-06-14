<template>
  <div class="task-graph q-pa-md">
    <div class="row items-center q-mb-md">
      <span class="section-title">Tasks</span>
      <q-space />
      <q-btn
        @click="agentOpen = true"
        icon="sym_o_smart_toy"
        flat
        round
        dense
        size="sm"
        title="Agent"
      />
      <q-btn
        @click="createOpen = true"
        icon="sym_o_add"
        flat
        round
        dense
        size="sm"
        title="New task"
      />
      <q-btn
        @click="scanAll"
        icon="sym_o_refresh"
        flat
        round
        dense
        size="sm"
        :loading="loading"
        title="Refresh"
      />
    </div>

    <q-banner v-if="error" class="error-banner q-mb-md" rounded dense>
      {{ error }}
    </q-banner>

    <div v-if="Object.keys(stateCounts).length" class="state-summary q-mb-md">
      <span
        v-for="(count, state) in stateCounts"
        :key="state"
        class="state-pill"
        :style="{ '--c': stateConfig(state).color }"
      >
        <span class="state-pill__dot" />
        {{ stateConfig(state).label }}
        <span class="state-pill__count">{{ count }}</span>
      </span>
    </div>

    <div v-if="!loading && workspaces.length === 0 && !error" class="empty-state">
      No workspaces found
    </div>

    <div v-for="ws in workspaces" :key="ws.path" class="q-mb-lg">
      <div class="workspace-label">
        {{ ws.label }}
      </div>
      <div v-if="workspaceNodes[ws.path]?.length" class="task-card">
        <TaskNodeItem
          v-for="task in workspaceNodes[ws.path]"
          :key="task.id"
          @select="node => onSelect(node, ws.path)"
          :node="task"
        />
      </div>
      <div v-else-if="!loading" class="workspace-empty">
        —
      </div>
    </div>

    <CreateTaskDialog v-model="createOpen" @created="onCreated" />
    <AgentDialog v-model="agentOpen" @ran="scanAll" />

    <q-dialog v-model="drawerOpen" transition-show="fade" transition-hide="fade">
      <q-card class="task-detail-card">
        <q-card-section class="row items-center no-wrap q-pb-sm">
          <q-icon :name="selectedCfg.icon" :style="{ color: selectedCfg.color }" size="20px" class="q-mr-sm" />
          <span class="detail-id">{{ selectedTask?.id }}</span>
          <span class="state-pill q-ml-sm" :style="{ '--c': selectedCfg.color }">
            <span class="state-pill__dot" />
            {{ selectedCfg.label }}
          </span>
          <q-space />
          <q-btn v-close-popup icon="sym_o_close" flat round dense size="sm" />
        </q-card-section>

        <q-separator />

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
import CreateTaskDialog from './CreateTaskDialog.vue'
import AgentDialog from './AgentDialog.vue'
import { stateConfig } from '../state-config.js'
import { dispatch } from '../tool/index.js'

const createOpen = ref(false)
const agentOpen = ref(false)
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

const selectedCfg = computed(() => stateConfig(selectedTask.value?.state))

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
 * Open the detail dialog for a node and load its task.md.
 * @param {object} node selected task node
 * @param {string} tasksDir workspace tasks dir the node belongs to
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
    const wsResult = await dispatch('workspaces', {})
    if (!wsResult.ok) throw new Error(wsResult.error.message)
    workspaces.value = wsResult.output
    await Promise.all(
      workspaces.value.map(async (ws) => {
        const result = await dispatch('scan', { tasksDir: ws.path })
        workspaceNodes.value[ws.path] = result.ok ? result.output : []
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

/**
 * Refresh the graph after a task was created so the new node shows up.
 */
async function onCreated() {
  await scanAll()
}

onMounted(scanAll)
</script>

<style scoped>
.task-graph {
  max-width: 860px;
  margin: 0 auto;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  opacity: 0.6;
}

.error-banner {
  background: rgb(255 69 58 / 12%);
  color: #ff6b60;
  font-size: 13px;
}

/* — state summary / pill (shared visual language with task rows) — */
.state-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.state-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
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

.state-pill__count {
  font-weight: 600;
  opacity: 0.85;
}

.empty-state {
  text-align: center;
  padding: 48px 0;
  font-size: 13px;
  opacity: 0.4;
}

/* — workspace grouping — */
.workspace-label {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.45;
  margin-bottom: 6px;
  padding-left: 4px;
}

.task-card {
  border: 1px solid rgb(255 255 255 / 9%);
  border-radius: 10px;
  padding: 4px;
  background: rgb(255 255 255 / 2.5%);
}

.body--light .task-card {
  border-color: rgb(0 0 0 / 9%);
  background: rgb(0 0 0 / 1.5%);
}

.workspace-empty {
  font-size: 12px;
  opacity: 0.35;
  padding: 6px 0 6px 4px;
}

.detail-id {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 16px;
  font-weight: 600;
}

.task-detail-card {
  width: 640px;
  max-width: 92vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
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
  border-bottom: 1px solid rgb(0 0 0 / 10%);
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
  background: rgb(0 0 0 / 6%);
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
