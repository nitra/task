<template>
  <q-dialog @update:model-value="emit('update:modelValue', $event)" :model-value="modelValue" persistent>
    <q-card class="onboarding">
      <q-card-section class="ob-title">
        <span class="ob-dot" />
        Owner — пульт рішень власника
      </q-card-section>

      <q-card-section class="ob-intro">
        <p>
          Це не дашборд, а <b>черга рішень</b>: застосунок показує лише те, що чекає на твій вердикт — плани на
          затвердження, ескалації, знахідки критика. Все інше згорнуто.
        </p>
        <ul class="ob-modes">
          <li>
            <q-icon name="sym_o_approval" size="16px" /> <b>Рішення</b> — коли є що вирішувати (сортування за ціною
            помилки)
          </li>
          <li>
            <q-icon name="sym_o_summarize" size="16px" /> <b>Бриф</b> — що змінилось із минулого візиту + твої задачі
          </li>
          <li><q-icon name="sym_o_map" size="16px" /> <b>Карта</b> — фонове чуття портфеля, коли все тихо</li>
        </ul>
        <p class="ob-note">
          Режим обирається автоматично за фіксованим правилом — заголовок завжди каже, чому ти бачиш саме це.
          <q-icon name="sym_o_neurology" size="14px" /> «нова ціль» декомпозує задум на підзадачі людям і агентам;
          <q-icon name="sym_o_psychology_alt" size="14px" /> критик шукає вади плану, яких не видно зсередини гілки.
        </p>
        <a href="#" @click.prevent="openGuide" class="ob-guide-link">
          <q-icon name="sym_o_open_in_new" size="13px" /> Повний ілюстрований гід (відкриється у браузері)
        </a>
      </q-card-section>

      <q-card-section class="ob-paths">
        <div class="ob-section">Де шукати задачі</div>
        <p class="ob-hint">
          Owner сканує ці директорії на mt-воркспейси (теки з <code>mt/</code>). Порожня карта = порожній список нижче.
        </p>
        <q-list dense>
          <q-item v-for="path in paths" :key="path" class="ob-path-row">
            <q-item-section class="ob-path">{{ path }}</q-item-section>
            <q-item-section side>
              <q-btn @click="removePath(path)" flat dense round size="sm" icon="sym_o_close" />
            </q-item-section>
          </q-item>
        </q-list>
        <div class="ob-add">
          <q-input
            v-model="newPath"
            @keyup.enter="addPath"
            dense
            outlined
            class="ob-add-input"
            placeholder="/Users/…/проєкти" />
          <q-btn @click="addPath" unelevated dense color="primary" icon="sym_o_add" :disable="!newPath.trim()" />
        </div>
      </q-card-section>

      <q-card-section class="ob-model">
        <q-expansion-item dense label="Модель для плановика і критика (omlx)">
          <div class="ob-model-fields">
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
      </q-card-section>

      <q-card-actions align="right">
        <q-btn @click="start" unelevated color="primary" icon="sym_o_rocket_launch" label="почати" :loading="saving" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useQuasar } from 'quasar'
import { openUrl } from '@tauri-apps/plugin-opener'
import { markOnboarded } from '../onboarding.js'
import { usePlanner } from '../composables/use-planner.js'
import { dispatch } from '../tool/index.js'

// Онбординг першого запуску: пояснення черги рішень + два практичні кроки —
// project paths (без них ліс порожній) і модель LLM. Відкривається також
// кнопкою «?» у тулбарі — це і довідка, і налаштування.

// Приватний артефакт claude.ai — відкривається лише в браузері, де власник
// уже залогінений під тим самим акаунтом, що його опублікував.
const GUIDE_URL = 'https://claude.ai/code/artifact/70a0e7d8-2f21-42e0-90bc-01825cfe4484'

const props = defineProps({
  modelValue: { type: Boolean, required: true }
})
const emit = defineEmits(['update:modelValue', 'started'])

const $q = useQuasar()
const { baseUrl, model, apiKey, saveOmlx } = usePlanner()

const paths = ref([])
const newPath = ref('')
const saving = ref(false)
let dirty = false

watch(
  () => props.modelValue,
  async open => {
    if (!open) return
    dirty = false
    const read = await dispatch('project_paths')
    if (read.ok) paths.value = read.output
  }
)

/**
 * Відкриває ілюстрований гід у системному браузері (не у вебвʼю застосунку —
 * приватний артефакт вимагає активної сесії claude.ai).
 * @returns {Promise<void>}
 */
async function openGuide() {
  try {
    await openUrl(GUIDE_URL)
  } catch {
    // поза Tauri (тести) — no-op
  }
}

/**
 * Додає шлях до списку (дедуплікація; збереження — кнопкою «почати»).
 */
function addPath() {
  const path = newPath.value.trim()
  if (!path || paths.value.includes(path)) return
  paths.value = [...paths.value, path]
  newPath.value = ''
  dirty = true
}

/**
 * Прибирає шлях зі списку.
 * @param {string} path шлях до видалення
 */
function removePath(path) {
  paths.value = paths.value.filter(p => p !== path)
  dirty = true
}

/**
 * Закриває онбординг: зберігає шляхи (якщо мінялись), фіксує прапорець,
 * повідомляє батька перезісканувати ліс.
 * @returns {Promise<void>}
 */
async function start() {
  saving.value = true
  try {
    if (dirty) {
      const saved = await dispatch('set_project_paths', { paths: paths.value })
      if (!saved.ok) {
        $q.notify({ type: 'negative', message: saved.error.message })
        return
      }
    }
    markOnboarded()
    emit('update:modelValue', false)
    emit('started')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.onboarding {
  min-width: 560px;
  max-width: 88vw;
}

.ob-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 700;
  padding-bottom: 0;
}

.ob-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #bf5af2;
  box-shadow: 0 0 8px rgb(191 90 242 / 60%);
}

.ob-intro {
  font-size: 13px;
  padding-bottom: 0;
}

.ob-intro p {
  margin: 0 0 8px;
}

.ob-modes {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ob-note {
  opacity: 0.7;
  font-size: 12px;
}

.ob-guide-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 12px;
  color: #bf5af2;
  text-decoration: none;
}

.ob-guide-link:hover {
  text-decoration: underline;
}

.ob-section {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.65;
  margin-bottom: 4px;
}

.ob-paths {
  padding-top: 8px;
  padding-bottom: 0;
}

.ob-hint {
  font-size: 12px;
  opacity: 0.6;
  margin: 0 0 6px;
}

.ob-path-row {
  padding-left: 0;
}

.ob-path {
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 12px;
}

.ob-add {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.ob-add-input {
  flex: 1;
}

.ob-model {
  padding-top: 8px;
  padding-bottom: 0;
}

.ob-model-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 4px;
}
</style>
