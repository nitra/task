<template>
  <q-dialog @update:model-value="emit('update:modelValue', $event)" :model-value="modelValue" persistent>
    <q-card class="onboarding">
      <q-card-section class="ob-title">
        <span class="ob-dot" />
        Delta — карта мандатів
      </q-card-section>

      <q-card-section class="ob-intro">
        <p>
          Мандат — межа твоїх повноважень: за яким <code>scope</code> (refs, типи рішень) і до яких порогів
          (<code>budget_eur</code>, <code>risk</code>, <code>irreversible</code>) ти вирішуєш сам, і кому їдуть рішення,
          що ці пороги перевищують (<code>escalates_to</code>).
        </p>
        <p class="ob-note">M0 — читання карти й твій зріз; редагування мандатів прийде пізніше (M3–M6).</p>
      </q-card-section>

      <q-card-section class="ob-identity">
        <div class="ob-section">Хто ти</div>
        <p class="ob-hint">
          Handle визначає твій зріз карти: та сама сутність, що <code>owner</code> у <code>mandates.yaml</code> і
          <code>assignee</code> у <code>h.md</code>; email/імʼя лишаються поза git.
        </p>
        <q-input v-model="handle" dense outlined clearable placeholder="olena" class="ob-input" />
      </q-card-section>

      <q-card-section class="ob-dir">
        <div class="ob-section">Де шукати мандати</div>
        <p class="ob-hint">Абсолютний шлях до кореня воркспейсу, що містить <code>.mt/mandates.yaml</code>.</p>
        <q-input v-model="mandatesDir" dense outlined clearable placeholder="/Users/…/task" class="ob-input" />
      </q-card-section>

      <q-card-actions align="right" class="ob-actions">
        <q-btn @click="start" unelevated color="primary" no-caps label="почати" :disable="!handle.trim()" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { markOnboarded } from '../onboarding.js'
import { dispatch } from '../tool/index.js'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  initialHandle: { type: String, default: '' },
  initialDir: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'started'])

const handle = ref(props.initialHandle)
const mandatesDir = ref(props.initialDir)

watch(
  () => [props.initialHandle, props.initialDir],
  ([h, d]) => {
    handle.value = h ?? ''
    mandatesDir.value = d ?? ''
  }
)

/**
 * Зберігає ідентичність і шлях (якщо задані), закриває онбординг.
 * @returns {Promise<void>}
 */
async function start() {
  const trimmedHandle = handle.value.trim()
  if (trimmedHandle) await dispatch('set_identity', { handle: trimmedHandle })
  const trimmedDir = mandatesDir.value.trim()
  if (trimmedDir) await dispatch('set_mandates_dir', { dir: trimmedDir })
  markOnboarded()
  emit('update:modelValue', false)
  emit('started')
}
</script>

<style scoped>
.onboarding {
  width: 460px;
  max-width: 92vw;
}

.ob-title {
  display: flex;
  align-items: center;
  gap: 9px;
  font-weight: 650;
  font-size: 15px;
}

.ob-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #14b8a6;
  box-shadow: 0 0 8px rgb(20 184 166 / 60%);
}

.ob-intro p {
  font-size: 13px;
  line-height: 1.5;
  margin: 0 0 8px;
}

.ob-note {
  opacity: 0.65;
}

.ob-section {
  font-size: 12px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.7;
  margin-bottom: 4px;
}

.ob-hint {
  font-size: 12px;
  opacity: 0.7;
  margin: 0 0 8px;
}

.ob-input {
  width: 100%;
}

.ob-actions {
  padding-top: 4px;
}
</style>
