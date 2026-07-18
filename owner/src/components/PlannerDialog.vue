<template>
  <q-dialog @update:model-value="emit('update:modelValue', $event)" :model-value="modelValue">
    <q-card class="planner-dialog">
      <q-card-section class="planner-title">Нова ціль → план декомпозиції</q-card-section>

      <q-card-section class="planner-form">
        <q-select
          v-model="workspace"
          :options="workspaceOptions"
          label="Воркспейс"
          outlined
          dense
          emit-value
          map-options />
        <q-input
          v-model="nodeId"
          label="Id вузла цілі (kebab-case латиницею)"
          outlined
          dense
          :error="nodeId !== '' && !idValid"
          error-message="лише a-z, 0-9 і дефіс" />
        <q-input
          v-model="intent"
          type="textarea"
          autogrow
          outlined
          dense
          label="Ціль природною мовою"
          placeholder="Що має статися і навіщо; обмеження; що вважається успіхом" />
        <q-expansion-item dense label="Модель плановика (omlx)" header-class="planner-expander">
          <div class="planner-omlx">
            <q-input v-model="baseUrl" @update:model-value="saveOmlx" label="base URL" outlined dense />
            <q-input v-model="model" @update:model-value="saveOmlx" label="model" outlined dense />
            <q-input
              v-model="apiKey"
              @update:model-value="saveOmlx"
              label="api key (опційно)"
              type="password"
              outlined
              dense />
          </div>
        </q-expansion-item>
        <q-expansion-item dense label="Матриця автономії цієї цілі" header-class="planner-expander">
          <AutonomyMatrix v-model="autonomy" class="planner-autonomy" />
        </q-expansion-item>
      </q-card-section>

      <q-card-section v-if="results.length > 0" class="planner-alternatives">
        <div
          v-for="result in results"
          :key="result.lens.key"
          class="alternative"
          :class="{ 'alternative-error': result.error }">
          <div class="alternative-title">{{ result.lens.title }}</div>
          <template v-if="result.alternative">
            <div class="alternative-context">{{ result.alternative.context }}</div>
            <ul class="alternative-children">
              <li v-for="child in result.alternative.children" :key="child.id">
                <q-badge :color="child.mode === 'human' ? 'warning' : 'info'" :label="child.mode" />
                <span class="child-id">{{ child.id }}</span>
                <span v-if="child.deps.length > 0" class="child-deps">← {{ child.deps.join(', ') }}</span>
                <div class="child-task">{{ child.task }}</div>
              </li>
            </ul>
            <div v-if="result.alternative.risks" class="alternative-risks">{{ result.alternative.risks }}</div>
            <q-btn
              @click="pick(result)"
              unelevated
              dense
              color="primary"
              label="обрати цей план"
              :loading="busy === result.lens.key" />
          </template>
          <div v-else class="alternative-error-text">{{ result.error }}</div>
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn @click="emit('update:modelValue', false)" flat dense label="закрити" />
        <q-btn
          @click="generate"
          unelevated
          dense
          color="secondary"
          icon="sym_o_neurology"
          :label="results.length > 0 ? 'згенерувати ще раз' : 'згенерувати плани'"
          :disable="!canGenerate"
          :loading="generating" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useQuasar } from 'quasar'
import { serializeAutonomy } from '../autonomy.js'
import { useForest } from '../composables/use-forest.js'
import { usePlanner } from '../composables/use-planner.js'
import { childrenToYaml, validNodeId } from '../planner.js'
import { dispatch } from '../tool/index.js'
import AutonomyMatrix from './AutonomyMatrix.vue'

// «Нова ціль» (M1): інтент → 2 альтернативи від плановика → вибір → create_goal
// + draft_plan (+ опційна матриця автономії, M3). Далі рішення живе у штатній
// черзі (plan_review → approve).

defineProps({
  modelValue: { type: Boolean, required: true }
})
const emit = defineEmits(['update:modelValue', 'drafted'])

const $q = useQuasar()
const { workspaces } = useForest()
const { baseUrl, model, apiKey, saveOmlx, draftAlternatives } = usePlanner()

const workspace = ref(null)
const nodeId = ref('')
const intent = ref('')
const results = ref([])
const generating = ref(false)
const busy = ref('')
const autonomy = ref({})

const workspaceOptions = computed(() => workspaces.value.map(w => ({ label: w.label, value: w.path })))
const idValid = computed(() => validNodeId(nodeId.value))
const canGenerate = computed(() => Boolean(workspace.value) && idValid.value && intent.value.trim().length > 0)

/**
 * Генерує альтернативи плану для введеної цілі (2 лінзи паралельно).
 * @returns {Promise<void>}
 */
async function generate() {
  generating.value = true
  results.value = []
  try {
    results.value = await draftAlternatives(intent.value.trim(), { tasksDir: workspace.value, taskPath: nodeId.value })
  } finally {
    generating.value = false
  }
}

/**
 * Матеріалізує вибір власника: вузол цілі + чернетка плану обраної альтернативи.
 * @param {{ lens: object, alternative: object }} result обрана альтернатива
 * @returns {Promise<void>}
 */
async function pick(result) {
  busy.value = result.lens.key
  try {
    const created = await dispatch('create_goal', {
      tasksDir: workspace.value,
      name: nodeId.value,
      opts: { mode: 'agent', hint: 'composite' }
    })
    if (!created.ok) throw new Error(created.error.message)

    const drafted = await dispatch('draft_plan', {
      tasksDir: workspace.value,
      taskPath: nodeId.value,
      context: intent.value.trim(),
      childrenYaml: childrenToYaml(result.alternative.children),
      risks: result.alternative.risks
    })
    if (!drafted.ok) throw new Error(drafted.error.message)

    // Політика — опційна: порожня матриця = повне успадкування, файл не пишемо.
    if (Object.keys(autonomy.value).length > 0) {
      const wrote = await dispatch('write_autonomy', {
        tasksDir: workspace.value,
        taskPath: nodeId.value,
        yaml: serializeAutonomy(autonomy.value)
      })
      if (!wrote.ok) throw new Error(wrote.error.message)
    }

    $q.notify({ type: 'positive', message: `${drafted.output} записано — план чекає approve у черзі рішень` })
    emit('drafted')
    emit('update:modelValue', false)
  } catch (error) {
    $q.notify({ type: 'negative', message: String(error?.message ?? error) })
  } finally {
    busy.value = ''
  }
}
</script>

<style scoped>
.planner-dialog {
  min-width: 640px;
  max-width: 92vw;
}

.planner-title {
  font-size: 14px;
  font-weight: 650;
  padding-bottom: 0;
}

.planner-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.planner-omlx {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 4px;
}

.planner-autonomy {
  padding: 8px 4px;
}

.planner-alternatives {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding-top: 0;
}

.alternative {
  border: 1px solid rgb(128 128 128 / 25%);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.alternative-error {
  opacity: 0.7;
}

.alternative-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.65;
}

.alternative-context {
  font-size: 13px;
}

.alternative-children {
  margin: 0;
  padding-left: 4px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.child-id {
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 12px;
  font-weight: 600;
  margin-left: 6px;
}

.child-deps {
  font-size: 11px;
  opacity: 0.55;
  margin-left: 6px;
}

.child-task {
  font-size: 12px;
  opacity: 0.75;
  margin-top: 2px;
}

.alternative-risks {
  font-size: 12px;
  opacity: 0.65;
  white-space: pre-line;
}

.alternative-error-text {
  font-size: 12px;
  color: #ff453a;
}
</style>
