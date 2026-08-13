<template>
  <q-dialog @update:model-value="emit('update:modelValue', $event)" persistent :model-value="modelValue">
    <q-card class="onboarding">
      <q-card-section class="ob-title">
        <span class="ob-dot" />
        Delta — карта мандатів
        <WhyThisWorks topic="mandatesMap" />
      </q-card-section>

      <template v-if="step === 'identity'">
        <q-card-section class="ob-intro">
          <p>
            Мандат — межа твоїх повноважень: за яким <code>scope</code> (refs, типи рішень) і до яких порогів
            (<code>budget_eur</code>, <code>risk</code>, <code>irreversible</code>) ти вирішуєш сам, і кому їдуть
            рішення, що ці пороги перевищують (<code>escalates_to</code>).
          </p>
          <p class="ob-note">
            Немає мандата на твій handle — онбординг сам поведе тебе через запит першого мандата (конституція п.10).
          </p>
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

        <div v-if="error" class="banner banner-error">{{ error }}</div>

        <q-card-actions align="right" class="ob-actions">
          <q-btn
            @click="checkAndProceed"
            unelevated
            color="primary"
            no-caps
            label="почати"
            :disable="!handle.trim() || checking"
            :loading="checking" />
        </q-card-actions>
      </template>

      <!-- Онбординг = перший мандат (конституція п.10): handle відсутній у
           mandates.yaml — замість негайного закриття діалог веде через запит
           мінімального мандата. computed_owner акта делегування — сам
           делегатор; підпис делегатор дає ЗВИЧАЙНИМ M1/M2 квіз-конвеєром у
           своїй черзі «Вирішую» (change_proposal.rs), тут лише крок (а)/(б). -->
      <template v-else-if="step === 'request-mandate'">
        <q-card-section class="ob-intro">
          <p>
            Handle <b>{{ handle }}</b> ще не має мандата в <code>{{ mandatesDir }}</code
            >. Сформуй запит — шаблон мінімального мандата (консервативні пороги, тільки для старту): делегатор підпише
            його звичайним квіз-гейтом у своїй черзі «Вирішую».
          </p>
          <WhyThisWorks topic="decisions" />
        </q-card-section>

        <q-card-section class="ob-identity">
          <div class="ob-section">Делегатор</div>
          <p class="ob-hint">Наявний власник мандата (кореневий чи будь-хто інший), хто підпише твій запит.</p>
          <q-input v-model="delegatorHandle" dense outlined clearable placeholder="vitalii" class="ob-input" />
        </q-card-section>

        <q-card-section class="ob-identity">
          <div class="ob-section">Тип мандата</div>
          <q-btn-toggle
            v-model="kind"
            unelevated
            no-caps
            dense
            toggle-color="primary"
            :options="[
              { label: 'людина', value: 'person' },
              { label: 'модель', value: 'model' }
            ]" />
        </q-card-section>

        <q-card-section class="ob-identity">
          <div class="ob-section">Scope — за чим саме ти вирішуєш</div>
          <p class="ob-hint">
            <code>refs</code> — git-glob патерни (кома-розділені), <code>decision_types</code> — типи рішень
            (кома-розділені). Порожньо неприпустимо (mandates.md: «не «усе»»).
          </p>
          <q-input v-model="refsText" dense outlined placeholder="refs/mt/tasks/design/**" class="ob-input" />
          <q-input
            v-model="decisionTypesText"
            @blur="loadSimulation"
            dense
            outlined
            placeholder="architecture, ux"
            class="ob-input"
            style="margin-top: 6px" />
        </q-card-section>

        <!-- Симуляція на історії (конституція п.12) — детермінований прогноз
             ДО підпису: скільки рішень за 90 днів потрапило б у цей scope. -->
        <q-card-section v-if="simulation" class="ob-identity">
          <div class="ob-section">Прогноз за {{ simulation.periodDays }} дн.</div>
          <p class="ob-hint">
            {{ simulation.total }} рішень потрапило б у цей scope, з них {{ simulation.irreversibleTotal }} —
            незворотних.
          </p>
          <div v-if="simulation.buckets.length > 0" class="simulation-buckets">
            <q-chip v-for="b in simulation.buckets" :key="b.decisionType" dense outline>
              {{ b.decisionType }}: {{ b.count
              }}<span v-if="b.irreversibleCount > 0"> ({{ b.irreversibleCount }} незворотних)</span>
            </q-chip>
          </div>
        </q-card-section>

        <div v-if="error" class="banner banner-error">{{ error }}</div>

        <q-card-actions align="right" class="ob-actions">
          <q-btn @click="step = 'identity'" flat no-caps dense label="назад" />
          <q-btn
            @click="submitMandateRequest"
            unelevated
            color="primary"
            no-caps
            label="надіслати запит"
            :disable="!delegatorHandle.trim() || !refsText.trim() || !decisionTypesText.trim() || submitting"
            :loading="submitting" />
        </q-card-actions>
      </template>

      <template v-else-if="step === 'awaiting-delegator'">
        <q-card-section class="ob-intro">
          <p>
            Запит подано — <code>{{ requestResult.runId }}</code> у черзі «Вирішую» власника
            <b>{{ requestResult.delegatorHandle }}</b
            >. Делегатор проходить звичайний квіз-гейт і підписує (<code>decision_quiz</code> →
            <code>decision_approve</code> → <code>mandate_change_apply</code>) — та сама «остання константа», що
            розширення ШІ-мандата.
          </p>
          <p class="ob-hint">Натисни «перевірити», коли делегатор підпише.</p>
        </q-card-section>

        <div v-if="error" class="banner banner-error">{{ error }}</div>

        <q-card-actions align="right" class="ob-actions">
          <q-btn @click="closeForLater" flat no-caps dense label="закрити (повернусь пізніше)" />
          <q-btn @click="checkAndProceed" unelevated color="primary" no-caps label="перевірити" :loading="checking" />
        </q-card-actions>
      </template>

      <!-- Крок (г): entry-quiz — новоприбулий доводить розуміння МЕЖ щойно
           отриманого мандата, перш ніж онбординг вважається завершеним. -->
      <template v-else-if="step === 'entry-quiz'">
        <q-card-section class="ob-intro">
          <p>Мандат підписано. Останній крок — доведи, що розумієш його межі: три питання про пороги/ескалацію.</p>
          <WhyThisWorks topic="quiz" />
        </q-card-section>

        <q-card-section v-for="(q, i) in entryQuestions" :key="i" class="ob-identity">
          <div class="ob-section">Питання {{ i + 1 }}</div>
          <p class="quiz-question">{{ q.question }}</p>
          <q-option-group
            v-model="entryAnswers[i]"
            :options="q.options.map((o, idx) => ({ label: o, value: idx }))"
            color="primary"
            dense />
        </q-card-section>

        <div v-if="entryResults.length > 0" class="entry-results">
          <div v-for="(r, i) in entryResults" :key="i" :class="['entry-result', r.correct ? 'ok' : 'bad']">
            <q-icon :name="r.correct ? 'sym_o_check_circle' : 'sym_o_error'" size="14px" />
            {{ r.correct ? 'правильно' : r.microlesson }}
          </div>
        </div>

        <div v-if="error" class="banner banner-error">{{ error }}</div>

        <q-card-actions align="right" class="ob-actions">
          <q-btn
            @click="submitEntryQuiz"
            unelevated
            color="primary"
            no-caps
            label="перевірити відповіді"
            :disable="entryAnswers.some(a => a === null) || submitting"
            :loading="submitting" />
        </q-card-actions>
      </template>

      <template v-else-if="step === 'done'">
        <q-card-section class="ob-intro">
          <p class="onboarding-complete">
            <q-icon name="sym_o_verified" size="18px" /> Онбординг завершено — мандат підписано, межі зрозумілі.
          </p>
        </q-card-section>
        <q-card-actions align="right" class="ob-actions">
          <q-btn @click="finish" unelevated color="primary" no-caps label="почати роботу" />
        </q-card-actions>
      </template>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { markOnboarded } from '../onboarding.js'
import { dispatch } from '../tool/index.js'
import WhyThisWorks from './WhyThisWorks.vue'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  initialHandle: { type: String, default: '' },
  initialDir: { type: String, default: '' }
})
const emit = defineEmits(['update:modelValue', 'started'])

const handle = ref(props.initialHandle)
const mandatesDir = ref(props.initialDir)
const step = ref('identity')
const error = ref(null)
const checking = ref(false)
const submitting = ref(false)

const delegatorHandle = ref('')
const kind = ref('person')
const refsText = ref('')
const decisionTypesText = ref('')
const requestResult = ref(null)
const simulation = ref(null)

const entryQuestions = ref([])
const entryAnswers = ref([])
const entryResults = ref([])

watch(
  () => [props.initialHandle, props.initialDir],
  ([h, d]) => {
    handle.value = h ?? ''
    mandatesDir.value = d ?? ''
  }
)

/**
 * Крок «очікую делегатора» — закрити діалог БЕЗ завершення онбордингу
 * (мандат ще не підписано): позначає онбординг пройденим локально (не
 * докучати діалогом повторно), користувач повернеться перевірити пізніше.
 * @returns {void}
 */
function closeForLater() {
  markOnboarded()
  emit('update:modelValue', false)
}

/**
 * Зберігає ідентичність/шлях, тоді перевіряє `onboarding_status` — handle
 * без мандата в mandates.yaml веде у крок «запросити мандат» (конституція
 * п.10), мандат є, але entry-quiz не пройдено — у крок entry-quiz, інакше —
 * звичайне негайне завершення (наявний handle, M0-поведінка без змін).
 * @returns {Promise<void>}
 */
async function checkAndProceed() {
  error.value = null
  checking.value = true
  const trimmedHandle = handle.value.trim()
  const trimmedDir = mandatesDir.value.trim()
  if (trimmedHandle) await dispatch('set_identity', { handle: trimmedHandle })
  if (trimmedDir) await dispatch('set_mandates_dir', { dir: trimmedDir })

  if (!trimmedHandle || !trimmedDir) {
    checking.value = false
    markOnboarded()
    emit('update:modelValue', false)
    emit('started')
    return
  }

  const res = await dispatch('onboarding_status', { mandatesDir: trimmedDir, handle: trimmedHandle })
  checking.value = false
  if (!res.ok) {
    error.value = res.error.message
    return
  }
  if (res.output.onboardingComplete) {
    markOnboarded()
    emit('update:modelValue', false)
    emit('started')
    return
  }
  if (res.output.needsOnboarding) {
    step.value = step.value === 'awaiting-delegator' ? 'awaiting-delegator' : 'request-mandate'
    return
  }
  // Мандат уже в mandates.yaml — лишається entry-quiz.
  await loadEntryQuiz(trimmedDir, trimmedHandle)
}

/**
 * Симуляція на історії (конституція п.12) — прогноз ДО підпису: скільки
 * рішень за 90 днів потрапило б у поточний decision_types-запит.
 * @returns {Promise<void>}
 */
async function loadSimulation() {
  const decisionTypes = decisionTypesText.value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (decisionTypes.length === 0 || !mandatesDir.value.trim()) {
    simulation.value = null
    return
  }
  const res = await dispatch('simulate_mandate_scope', {
    mandatesDir: mandatesDir.value.trim(),
    decisionTypes
  })
  simulation.value = res.ok ? res.output : null
}

/**
 * Крок (а)/(б): формує scope із текстових полів і подає change-proposal
 * тим самим механізмом, що розширення ШІ-мандата — `mandate_request_propose`.
 * @returns {Promise<void>}
 */
async function submitMandateRequest() {
  error.value = null
  submitting.value = true
  const refs = refsText.value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const decisionTypes = decisionTypesText.value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  const res = await dispatch('mandate_request_propose', {
    mandatesDir: mandatesDir.value.trim(),
    handle: handle.value.trim(),
    delegatorHandle: delegatorHandle.value.trim(),
    kind: kind.value,
    refs,
    decisionTypes
  })
  submitting.value = false
  if (!res.ok) {
    error.value = res.error.message
    return
  }
  requestResult.value = res.output
  step.value = 'awaiting-delegator'
}

/**
 * Крок (г): завантажує (чи генерує, якщо перший раз) три entry-quiz-питання
 * щойно отриманого мандата.
 * @param {string} dir mandatesDir
 * @param {string} h handle
 * @returns {Promise<void>}
 */
async function loadEntryQuiz(dir, h) {
  const res = await dispatch('entry_quiz_start', { mandatesDir: dir, handle: h })
  if (!res.ok) {
    error.value = res.error.message
    return
  }
  entryQuestions.value = res.output.questions
  entryAnswers.value = res.output.questions.map(() => null)
  entryResults.value = []
  step.value = 'entry-quiz'
}

/**
 * Проводить усі три entry-quiz-відповіді разом. Усі правильні — онбординг
 * завершено (крок «done»); будь-яка неправильна — фейл ≠ покарання, ті самі
 * питання лишаються, результати показують, що саме пропущено.
 * @returns {Promise<void>}
 */
async function submitEntryQuiz() {
  error.value = null
  submitting.value = true
  const res = await dispatch('entry_quiz_submit', {
    mandatesDir: mandatesDir.value.trim(),
    handle: handle.value.trim(),
    answers: entryAnswers.value
  })
  submitting.value = false
  if (!res.ok) {
    error.value = res.error.message
    return
  }
  entryResults.value = res.output.results
  if (res.output.completed) {
    step.value = 'done'
    return
  }
  entryAnswers.value = entryQuestions.value.map(() => null)
}

/**
 * Завершує онбординг — той самий фінальний акт, що стара одностадійна
 * версія діалогу.
 * @returns {void}
 */
function finish() {
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

.quiz-question {
  font-size: 13px;
  font-weight: 600;
  margin: 0 0 6px;
}

.simulation-buckets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.entry-results {
  padding: 0 16px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.entry-result {
  font-size: 11.5px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.entry-result.ok {
  color: #14b8a6;
}

.entry-result.bad {
  color: #ff453a;
}

.onboarding-complete {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #14b8a6;
  font-weight: 600;
}

.banner {
  margin: 0 16px 8px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
}

.banner-error {
  background: color-mix(in srgb, #ff453a 12%, transparent);
  color: #ff453a;
}
</style>
