<template>
  <div class="task-graph q-pa-md">
    <div class="row items-center q-mb-md">
      <span class="section-title">Tasks</span>
      <q-space />
      <q-btn @click="auditOpen = true" icon="sym_o_history" flat round dense size="sm" title="Request journal" />
      <q-btn @click="agentOpen = true" icon="sym_o_smart_toy" flat round dense size="sm" title="Agent" />
      <q-btn @click="createOpen = true" icon="sym_o_add" flat round dense size="sm" title="New task" />
      <q-btn @click="scanAll" icon="sym_o_refresh" flat round dense size="sm" :loading="loading" title="Refresh" />
    </div>

    <q-banner v-if="errorMessage" class="error-banner q-mb-md" rounded dense>
      {{ errorMessage }}
    </q-banner>

    <div v-if="Object.keys(stateCounts).length" class="state-summary q-mb-md">
      <span
        v-for="(count, state) in stateCounts"
        :key="state"
        class="state-pill"
        :style="{ '--c': stateConfig(state).color }">
        <span class="state-pill__dot" />
        {{ stateConfig(state).label }}
        <span class="state-pill__count">{{ count }}</span>
      </span>
    </div>

    <div v-if="attention.length" class="attention q-mb-md">
      <div class="attention__title">Needs attention</div>
      <div
        v-for="row in attention"
        :key="row.workspace.path + row.node.path"
        @click="onSelect(row.node, row.workspace.path)"
        class="attention__row">
        <q-icon
          :name="stateConfig(row.node.state).icon"
          :style="{ color: stateConfig(row.node.state).color }"
          size="15px" />
        <span class="attention__id">{{ row.node.id }}</span>
        <span class="attention__ws">{{ row.workspace.label }}</span>
        <q-space />
        <span class="attention__reason">{{ row.reason }}</span>
      </div>
    </div>

    <div v-if="!loading && workspaces.length === 0 && !errorMessage" class="empty-state">No workspaces found</div>

    <div v-for="ws in workspaces" :key="ws.path" class="q-mb-lg">
      <div class="row items-center workspace-label">
        {{ ws.label }}
        <span v-if="agentConcurrency[ws.path]" class="workspace-slots">
          slots: {{ countRunning(workspaceNodes[ws.path]) }}/{{ agentConcurrency[ws.path] }}
        </span>
        <q-space />
        <q-btn
          @click="startAuto(ws.path)"
          :disable="autoRunning[ws.path]"
          :label="autoRunning[ws.path] ? 'Auto running…' : 'Run auto'"
          :icon="autoRunning[ws.path] ? 'sym_o_hourglass_top' : 'sym_o_play_circle'"
          :loading="autoRunning[ws.path]"
          size="xs"
          flat
          dense
          class="workspace-auto-btn" />
      </div>
      <div v-if="workspaceNodes[ws.path]?.length" class="task-card">
        <TaskNodeItem
          v-for="task in workspaceNodes[ws.path]"
          :key="task.id"
          @select="node => onSelect(node, ws.path)"
          @select-dep="depId => onSelectDep(depId, ws.path)"
          :node="task" />
      </div>
      <div v-else-if="!loading" class="workspace-empty">—</div>
    </div>

    <CreateTaskDialog v-model="createOpen" @created="onCreated" />
    <AgentDialog v-model="agentOpen" @ran="scanAll" :agent="agent" />
    <AuditDialog v-model="auditOpen" @changed="scanAll" :agent="agent" />

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

        <LiveRunFeed v-if="selectedTask?.state === 'running'" :node="selectedTask" :tasks-dir="selectedTasksDir" />

        <NodeActions v-if="selectedTask" @changed="onNodeChanged" :node="selectedTask" :tasks-dir="selectedTasksDir" />

        <q-card-section horizontal class="task-detail-body">
          <ArtifactChain
            @select="a => openArtifact(a.file)"
            :artifacts="artifacts"
            :selected="selectedFile"
            class="task-detail-chain" />
          <q-separator vertical />
          <q-card-section class="q-pa-md scroll task-detail-content">
            <div v-if="contentLoading" class="text-center q-pa-xl">
              <q-spinner size="40px" color="primary" />
            </div>
            <div v-else-if="contentError" class="text-red">{{ contentError }}</div>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-else class="markdown-body" v-html="renderedContent" />
          </q-card-section>
        </q-card-section>
      </q-card>
    </q-dialog>
  </div>
</template>

<script setup>
import { marked } from 'marked'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { AgentDialog, AuditDialog } from '@7n/tauri-components/components'
import TaskNodeItem from './TaskNodeItem.vue'
import CreateTaskDialog from './CreateTaskDialog.vue'
import ArtifactChain from './ArtifactChain.vue'
import NodeActions from './NodeActions.vue'
import LiveRunFeed from './LiveRunFeed.vue'
import { stateConfig } from '../state-config.js'
import { collectAttention } from '../attention.js'
import { applyClaims } from '../claims.js'
import { findNodeByPath } from '../tree.js'
import { countRunning } from '../slots.js'
import { dispatch } from '../tool/index.js'
import { useAgent } from '../composables/use-agent.js'

const agent = useAgent()
const createOpen = ref(false)
const agentOpen = ref(false)
const auditOpen = ref(false)
const workspaces = ref([])
const workspaceNodes = ref({})
const loading = ref(false)
const errorMessage = ref(null)

const autoRunning = ref({})
const agentConcurrency = ref({})

const drawerOpen = ref(false)
const selectedTask = ref(null)
const selectedTasksDir = ref('')
const taskContent = ref('')
const contentLoading = ref(false)
const contentError = ref(null)
const artifacts = ref([])
const selectedFile = ref('task.md')

const selectedCfg = computed(() => stateConfig(selectedTask.value?.state))

const renderedContent = computed(() => marked.parse(taskContent.value))

const attention = computed(() => collectAttention(workspaces.value, workspaceNodes.value))

const stateCounts = computed(() => {
  const counts = {}
  const walk = nodes => {
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
 * Starts a one-shot `run --auto` batch pass over a workspace's waiting
 * agent nodes; progress lands via the existing FS-watcher rescan, the
 * final tally arrives as `mt-auto-finished`.
 * @param {string} tasksDir workspace tasks dir to orchestrate
 */
async function startAuto(tasksDir) {
  autoRunning.value = { ...autoRunning.value, [tasksDir]: true }
  try {
    await invoke('run_auto', { tasksDir })
  } catch (error) {
    autoRunning.value = { ...autoRunning.value, [tasksDir]: false }
    errorMessage.value = String(error)
  }
}

/**
 * Open the detail dialog for a node: load its version chain and task.md.
 * @param {object} node selected task node
 * @param {string} tasksDir workspace tasks dir the node belongs to
 */
async function onSelect(node, tasksDir) {
  selectedTask.value = node
  selectedTasksDir.value = tasksDir
  drawerOpen.value = true
  artifacts.value = []
  await Promise.all([loadArtifacts(), openArtifact('task.md')])
}

/**
 * Follow a dependency edge: dep-id = шлях вузла відносно tasks root (спека),
 * тож шукаємо вузол за path у дереві воркспейсу і відкриваємо його.
 * @param {string} depId dependency id, e.g. `collect-data` or `research/analyze`
 * @param {string} tasksDir workspace tasks dir
 */
function onSelectDep(depId, tasksDir) {
  const dep = findNodeByPath(workspaceNodes.value[tasksDir], depId)
  if (dep) onSelect(dep, tasksDir)
}

/**
 * Re-points the open detail dialog's node at its fresh copy from the latest
 * scan (by path) — called after every rescan so state/claim/actions stay
 * live while the dialog is open (esp. for a `running` node). Closes the
 * dialog if the node disappeared from the graph (e.g. `kill`).
 */
function refreshOpenNode() {
  if (!drawerOpen.value || !selectedTask.value) return
  const fresh = findNodeByPath(workspaceNodes.value[selectedTasksDir.value], selectedTask.value.path)
  if (!fresh) {
    drawerOpen.value = false
    return
  }
  selectedTask.value = fresh
}

/**
 * After a node mutation (approve/reject/assign): rescan and refresh the
 * selected node so its state, actions and chain reflect the new files.
 */
async function onNodeChanged() {
  await scanAll()
  if (!drawerOpen.value) return
  await Promise.all([loadArtifacts(), openArtifact(selectedFile.value)])
}

/**
 * Load the version chain (artifact list) of the selected node.
 */
async function loadArtifacts() {
  try {
    artifacts.value = await invoke('node_artifacts', {
      tasksDir: selectedTasksDir.value,
      taskPath: selectedTask.value.path
    })
  } catch (error) {
    console.error('node_artifacts failed', error)
    artifacts.value = []
  }
}

/**
 * Show one artifact of the selected node in the detail content pane.
 * @param {string} file artifact file name, e.g. `run_002.md`
 */
async function openArtifact(file) {
  selectedFile.value = file
  contentLoading.value = true
  contentError.value = null
  taskContent.value = ''
  try {
    taskContent.value = await invoke('read_node_artifact', {
      tasksDir: selectedTasksDir.value,
      taskPath: selectedTask.value.path,
      file
    })
  } catch (error) {
    contentError.value = String(error)
  } finally {
    contentLoading.value = false
  }
}

/**
 *
 */
async function scanAll() {
  loading.value = true
  errorMessage.value = null
  try {
    const wsResult = await dispatch('workspaces', {})
    if (!wsResult.ok) throw new Error(wsResult.error.message)
    workspaces.value = wsResult.output
    await watchWorkspaces()
    await Promise.all(
      workspaces.value.map(async ws => {
        const result = await dispatch('scan', { tasksDir: ws.path })
        workspaceNodes.value[ws.path] = result.ok ? result.output : []
        // Remote ownership поверх локального скану: активний claim → running,
        // прострочений lease → stalled. Офлайн/без remote — тихо пропускаємо.
        try {
          const claims = await invoke('remote_claims', { tasksDir: ws.path })
          workspaceNodes.value[ws.path] = applyClaims(workspaceNodes.value[ws.path], claims)
        } catch {
          // remote недоступний — лишаємо локальний derived-стан
        }
        try {
          agentConcurrency.value[ws.path] = await invoke('get_agent_concurrency', { tasksDir: ws.path })
        } catch {
          // .mt.json недоступний — slots-індикатор просто не показується
        }
      })
    )
  } catch (error) {
    errorMessage.value = String(error)
  } finally {
    refreshOpenNode()
    loading.value = false
  }
}

/**
 * (Re)start the native FS watcher over the current workspaces; file changes
 * come back as `mt-changed` events → debounced rescan below.
 */
async function watchWorkspaces() {
  try {
    await invoke('watch_tasks_dirs', { dirs: workspaces.value.map(ws => ws.path) })
  } catch (error) {
    console.error('watch_tasks_dirs failed', error)
  }
}

/**
 * Refresh the graph after a task was created so the new node shows up.
 */
async function onCreated() {
  await scanAll()
}

let rescanTimer = null

onMounted(async () => {
  await scanAll()
  await listen('mt-changed', () => {
    clearTimeout(rescanTimer)
    rescanTimer = setTimeout(scanAll, 400)
  })
  // Фінал фонового агентського рану: помилки — у банер, стан — rescan.
  await listen('mt-run-finished', event => {
    if (event.payload?.result === 'error') errorMessage.value = `run ${event.payload.path}: ${event.payload.error}`
    clearTimeout(rescanTimer)
    rescanTimer = setTimeout(scanAll, 400)
  })
  // Фінал `run --auto`: знімає running-прапор воркспейсу, помилку — у банер.
  await listen('mt-auto-finished', event => {
    const { tasksDir, error: autoError } = event.payload ?? {}
    if (tasksDir) autoRunning.value = { ...autoRunning.value, [tasksDir]: false }
    if (autoError) errorMessage.value = `run --auto ${tasksDir}: ${autoError}`
    clearTimeout(rescanTimer)
    rescanTimer = setTimeout(scanAll, 400)
  })
})

onUnmounted(() => clearTimeout(rescanTimer))
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

/* — attention inbox: вузли що чекають рішення людини — */
.attention {
  border: 1px solid rgb(255 159 10 / 25%);
  border-radius: 10px;
  padding: 6px;
  background: rgb(255 159 10 / 5%);
}

.attention__title {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #ff9f0a;
  padding: 4px 8px 6px;
}

.attention__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.12s ease;
}

.attention__row:hover {
  background: rgb(255 159 10 / 10%);
}

.attention__id {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 500;
}

.attention__ws {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  opacity: 0.45;
}

.attention__reason {
  font-size: 12px;
  opacity: 0.6;
  white-space: nowrap;
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

.workspace-slots {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: normal;
  opacity: 0.7;
  margin-left: 10px;
  white-space: nowrap;
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
  width: 860px;
  max-width: 94vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
}

.task-detail-body {
  flex: 1;
  min-height: 0;
}

.task-detail-chain {
  flex: 0 0 220px;
  max-width: 220px;
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

.markdown-body :deep(input[type='checkbox']) {
  margin-right: 6px;
}
</style>
