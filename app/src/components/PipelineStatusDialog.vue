<template>
  <q-dialog v-model="open" transition-show="fade" transition-hide="fade">
    <q-card class="pipelines-card">
      <q-card-section class="row items-center no-wrap q-pb-sm">
        <q-icon name="sym_o_rocket_launch" size="20px" class="q-mr-sm" />
        <span class="pipelines-title">Pipelines — {{ workspaceLabel }}</span>
        <q-space />
        <q-btn-toggle
          v-model="sortMode"
          :options="[
            { label: 'Date', value: 'date' },
            { label: 'A-Z', value: 'alpha' }
          ]"
          dense
          flat
          no-caps
          size="sm"
          class="q-mr-sm" />
        <q-btn v-close-popup icon="sym_o_close" flat round dense size="sm" />
      </q-card-section>

      <q-separator />

      <q-card-section class="q-pa-md scroll pipelines-body">
        <div v-if="loading" class="text-center q-pa-xl">
          <q-spinner size="40px" color="primary" />
        </div>
        <div v-else-if="errorMessage" class="text-red">{{ errorMessage }}</div>
        <div v-else-if="!sortedRuns.length" class="pipelines-empty">No CI configured for this repo</div>
        <q-markup-table v-else flat dense class="pipelines-table">
          <thead>
            <tr>
              <th class="text-left">status</th>
              <th class="text-left">name</th>
              <th class="text-left">provider</th>
              <th class="text-left">last run</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="run in sortedRuns"
              :key="`${run.provider}-${run.name}`"
              @click="run.conclusion === 'failure' && openRunDetails(run)"
              :class="{ 'pipelines-row--clickable': run.conclusion === 'failure' }">
              <td>
                <span class="status-pill" :style="{ '--c': pipelineStateConfig(run.status, run.conclusion).color }">
                  <span class="status-pill__dot" />
                  {{ pipelineStateConfig(run.status, run.conclusion).label }}
                </span>
              </td>
              <td class="pipelines-table__name">{{ run.name }}</td>
              <td>{{ run.provider }}</td>
              <td>{{ formatRelativeTime(run.updated_at) }}</td>
            </tr>
          </tbody>
        </q-markup-table>
      </q-card-section>
    </q-card>

    <PipelineRunDetailsDialog v-model="runDetailsOpen" :tasks-dir="tasksDir" :run="selectedRun" />
  </q-dialog>
</template>

<script setup>
import { invoke } from '@tauri-apps/api/core'
import { pipelineStateConfig } from '../pipeline-state-config.js'
import { formatRelativeTime } from '../format-relative-time.js'
import PipelineRunDetailsDialog from './PipelineRunDetailsDialog.vue'

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

const runs = ref([])
const loading = ref(false)
const errorMessage = ref(null)
const sortMode = ref('date')

const runDetailsOpen = ref(false)
const selectedRun = ref(null)

/**
 * Sorted view of `runs`: entries with no run history always sort last,
 * regardless of sort mode; the rest sort by last-run date desc or name a-z.
 */
const sortedRuns = computed(() => {
  const withRuns = runs.value.filter(r => r.updated_at)
  const noRuns = runs.value.filter(r => !r.updated_at)
  const sorted = withRuns.toSorted((a, b) =>
    sortMode.value === 'alpha' ? a.name.localeCompare(b.name) : new Date(b.updated_at) - new Date(a.updated_at)
  )
  return [...sorted, ...noRuns]
})

/**
 * Opens the run-details dialog for a failed pipeline/workflow run.
 * @param {object} run the clicked row's PipelineRunSummary
 */
function openRunDetails(run) {
  selectedRun.value = run
  runDetailsOpen.value = true
}

watch(open, async isOpen => {
  if (!isOpen) return
  loading.value = true
  errorMessage.value = null
  try {
    runs.value = await invoke('list_pipeline_runs', { tasksDir: props.tasksDir })
  } catch (error) {
    errorMessage.value = String(error)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.pipelines-card {
  width: 640px;
  max-width: 92vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
}

.pipelines-title {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 600;
}

.pipelines-body {
  flex: 1;
  overflow-y: auto;
}

.pipelines-empty {
  text-align: center;
  padding: 32px 0;
  font-size: 13px;
  opacity: 0.4;
}

.pipelines-table {
  background: transparent;
  font-size: 12px;
}

.pipelines-table__name {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
}

.pipelines-row--clickable {
  cursor: pointer;
}

.status-pill {
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

.status-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c);
}
</style>
