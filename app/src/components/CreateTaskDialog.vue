<template>
  <BaseDialog
    @update:model-value="val => emit('update:modelValue', val)"
    @show="onShow"
    :model-value="modelValue"
    title="Нова задача"
    icon="sym_o_add_task"
  >
    <!-- Project: browse to any directory on disk -->
        <div>
          <div class="field-label">Проєкт</div>
          <div class="row no-wrap items-center q-gutter-sm">
            <q-input
              @click="browse"
              :model-value="project"
              readonly
              dense
              outlined
              class="col"
              placeholder="Виберіть директорію проєкту…"
            />
            <q-btn @click="browse" icon="sym_o_folder_open" label="Огляд" dense unelevated color="primary" />
          </div>
          <div v-if="project" class="field-hint">→ {{ tasksDir }}</div>
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
import { reactive, ref } from 'vue'
import { useQuasar } from 'quasar'
import { open } from '@tauri-apps/plugin-dialog'
import BaseDialog from './BaseDialog.vue'
import DialogActions from './DialogActions.vue'
import { buildCreateOpts, mtDirFor, validateTaskName } from '../task-create.js'
import { useProjectsDir } from '../composables/use-projects-dir.js'
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
const { projectsDir, lastProject, setLastProject } = useProjectsDir()

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

const nameError = computed(() => (name.value ? validateTaskName(name.value) : 'Вкажіть назву задачі'))
const tasksDir = computed(() => (project.value ? mtDirFor(project.value) : ''))
const canSubmit = computed(() => !!project.value && nameError.value === null && !submitting.value)

/**
 * Reset transient fields when the dialog opens; reuse the last project as start.
 */
function onShow() {
  name.value = ''
  project.value = lastProject.value || ''
}

/**
 * Open the native folder picker, starting from the last project / projects root.
 */
async function browse() {
  const picked = await open({
    directory: true,
    multiple: false,
    defaultPath: project.value || lastProject.value || projectsDir.value,
    title: 'Виберіть директорію проєкту',
  })
  if (typeof picked === 'string') project.value = picked
}

/**
 * Send `create_task` to Rust and report the outcome.
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

.field-hint {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  opacity: 0.5;
  margin-top: 4px;
  overflow-wrap: anywhere;
}
</style>
