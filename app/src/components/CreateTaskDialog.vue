<template>
  <BaseDialog
    @update:model-value="val => emit('update:modelValue', val)"
    @show="onShow"
    :model-value="modelValue"
    title="Нова задача"
    icon="sym_o_add_task"
  >
    <!-- Project: pick from configured search paths -->
    <div>
      <div class="field-label-row">
        <span class="field-label">Проєкт</span>
        <q-btn @click="addPath" flat dense round icon="sym_o_add_circle" size="xs" title="Додати директорію пошуку" />
      </div>
      <q-select
        v-model="project"
        @popup-show="loadWorkspaces"
        @filter="filterWorkspaces"
        :options="filteredWorkspaces"
        :loading="wsLoading"
        use-input
        input-debounce="0"
        dense
        outlined
        emit-value
        map-options
        clearable
        placeholder="Виберіть проєкт…"
      />
      <div v-if="project" class="field-hint">→ {{ tasksDir }}</div>
      <div v-if="!projectPaths.length" class="field-hint">Немає директорій — натисніть + щоб додати</div>
    </div>

    <!-- Node id -->
    <q-input
      v-model="name"
      @keyup.enter="canSubmit && submit()"
      dense
      outlined
      autofocus
      label="Назва задачі"
      hint="id вузла; «/» = вкладені (наприклад research/collect-data)"
      :rules="[() => nameError === null || nameError]"
    />

    <!-- Executor -->
    <div>
      <div class="field-label">Виконавець</div>
      <q-btn-toggle
        v-model="form.mode"
        :options="MODE_OPTIONS"
        dense
        unelevated
        no-caps
        toggle-color="primary"
      />
    </div>

    <template v-if="form.mode === 'agent'">
      <q-select
        v-model="form.modelTier"
        :options="TIER_OPTIONS"
        dense
        outlined
        label="Модель (model_tier)"
        emit-value
        map-options
      />
      <q-select
        v-model="form.skills"
        dense
        outlined
        multiple
        use-input
        use-chips
        hide-dropdown-icon
        new-value-mode="add-unique"
        input-debounce="0"
        label="Навички (skills)"
        hint="Enter додає; порожнє → дефолт із .mt.json"
      />
    </template>

    <q-input
      v-model.number="form.budgetSec"
      dense
      outlined
      type="number"
      label="Бюджет, сек (budget_sec)"
      hint="Порожнє → дефолт із .mt.json"
    />

    <q-input
      v-model="form.hint"
      dense
      outlined
      label="Підказка (hint)"
      placeholder="atomic"
    />

    <q-select
      v-model="form.deps"
      dense
      outlined
      multiple
      use-input
      use-chips
      hide-dropdown-icon
      new-value-mode="add-unique"
      input-debounce="0"
      label="Залежності (deps)"
      hint="id вузлів → порожні deps/<id>.md; Enter додає"
    />

    <template #actions>
      <DialogActions
        @submit="submit"
        cancel-label="Скасувати"
        submit-label="Створити"
        :disable="!canSubmit"
        :loading="submitting"
      />
    </template>
  </BaseDialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import { open } from '@tauri-apps/plugin-dialog'
import { BaseDialog, DialogActions } from '@7n/tauri-components/components'
import { buildCreateOpts, mtDirFor, validateTaskName } from '../task-create.js'
import { useProjectPaths } from '../composables/use-project-paths.js'
import { useProjectWorkspaces } from '../composables/use-project-workspaces.js'
import { dispatch } from '../tool/index.js'

defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'created'])

const MODE_OPTIONS = [
  { label: 'Agent', value: 'agent' },
  { label: 'Human', value: 'human' },
]
const TIER_OPTIONS = [
  { label: 'MIM', value: 'MIM' },
  { label: 'AVG', value: 'AVG' },
  { label: 'MAX', value: 'MAX' },
]

const $q = useQuasar()
const { projectPaths, lastProject, addProjectPath, setLastProject } = useProjectPaths()
const { workspaces, loading: wsLoading, load: loadWorkspaces, refresh: refreshWorkspaces } = useProjectWorkspaces()

const project = ref('')
const name = ref('')
const submitting = ref(false)
const form = reactive({
  mode: 'agent',
  modelTier: 'AVG',
  budgetSec: '',
  hint: '',
  deps: [],
  skills: [],
})

const WS_SPLIT_RE = /\s+/
const wsFilter = ref('')
const filteredWorkspaces = computed(() => {
  const terms = wsFilter.value.toLowerCase().split(WS_SPLIT_RE).filter(Boolean)
  if (!terms.length) return workspaces.value
  return workspaces.value.filter(w => {
    const label = w.label.toLowerCase()
    return terms.every(t => label.includes(t))
  })
})

/**
 *
 */
function filterWorkspaces(val, update) {
  wsFilter.value = val
  update()
}

const nameError = computed(() => (name.value ? validateTaskName(name.value) : 'Вкажіть назву задачі'))
const tasksDir = computed(() => (project.value ? mtDirFor(project.value) : ''))
const canSubmit = computed(() => !!project.value && nameError.value === null && !submitting.value)

/**
 *
 */
function onShow() {
  name.value = ''
  project.value = lastProject.value || ''
  loadWorkspaces()
}

/**
 *
 */
async function addPath() {
  const picked = await open({ directory: true, title: 'Виберіть директорію пошуку проєктів' })
  if (typeof picked === 'string') {
    addProjectPath(picked)
    await refreshWorkspaces()
  }
}

/**
 *
 */
async function submit() {
  if (!canSubmit.value) return
  submitting.value = true
  try {
    const envelope = await dispatch('create', {
      tasksDir: tasksDir.value,
      name: name.value,
      opts: buildCreateOpts(form),
    })
    if (!envelope.ok) {
      $q.notify({ type: 'negative', message: envelope.error.message })
      return
    }
    const outcome = envelope.output
    if ('Created' in outcome) {
      $q.notify({ type: 'positive', message: `Створено: ${outcome.Created.task_path}` })
    }
    else {
      $q.notify({ type: 'warning', message: `Вже існує: ${outcome.Exists.task_path}` })
    }
    setLastProject(project.value)
    emit('created', { tasksDir: tasksDir.value, outcome })
    emit('update:modelValue', false)
  }
  finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.field-label {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.7;
  margin-bottom: 6px;
}

.field-label-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}

.field-label-row .field-label {
  margin-bottom: 0;
}

.field-hint {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  opacity: 0.5;
  margin-top: 4px;
  overflow-wrap: anywhere;
}
</style>
