<template>
  <div class="decision-card">
    <div class="row-top">
      <q-icon name="sym_o_fork_right" size="18px" />
      <span class="request-id">{{ decision.runId }}/{{ decision.nnnn }}</span>
      <q-badge v-if="decision.leverageFacets.irreversible" color="negative" label="незворотне" class="facet-badge" />
      <q-badge color="grey-7" :label="`blast: ${decision.leverageFacets.blastRadius}`" class="facet-badge" />
      <q-badge color="secondary" :label="decision.depth" class="facet-badge" />
      <q-space />
      <span v-if="decision.deadlineCost" class="deadline">{{ decision.deadlineCost }}</span>
    </div>

    <p class="context">{{ decision.context }}</p>

    <!-- Крок 1: обрати варіант decision-request-а. -->
    <div v-if="!chosenOption" class="options">
      <div class="section-label">Варіанти</div>
      <div v-for="option in decision.options" :key="option.label" class="option">
        <div class="option-head">
          <strong>{{ option.label }}.</strong> {{ option.title }}
        </div>
        <p class="option-body">{{ option.body }}</p>
        <q-btn
          @click="chooseOption(option.label)"
          unelevated
          dense
          no-caps
          color="primary"
          size="sm"
          :label="`обрати ${option.label}`" />
      </div>
      <p v-if="decision.recommendation" class="recommendation">
        <q-icon name="sym_o_smart_toy" size="14px" /> {{ decision.recommendation }}
      </p>
    </div>

    <!-- Крок 2: квіз-гейт (one-tap) — питання про наслідки обраного варіанта. -->
    <div v-else class="quiz">
      <div class="section-label">
        Квіз-гейт — обрано «{{ chosenOption }}»
        <q-btn
          v-if="!approved"
          @click="reset"
          flat
          dense
          no-caps
          size="sm"
          label="змінити варіант"
          class="change-option" />
      </div>

      <div v-if="quizLoading" class="quiz-loading"><q-spinner size="16px" /> генерую питання…</div>

      <template v-else-if="approved">
        <div class="approved-banner">
          <q-icon name="sym_o_check_circle" size="18px" />
          Підписано — {{ approvalResult.approval.signed_at }} · pubkey {{ shortPubkey }}
        </div>
      </template>

      <template v-else-if="quiz">
        <p class="quiz-question">{{ quiz.question }}</p>
        <div class="quiz-options">
          <q-btn
            v-for="(opt, index) in quiz.options"
            :key="index"
            @click="answer(index)"
            :disable="answering"
            unelevated
            no-caps
            align="left"
            class="quiz-option-btn"
            :label="`${String.fromCharCode(65 + index)}. ${opt}`" />
        </div>
        <div v-if="lastWrong" class="microlesson-banner">
          <div class="microlesson-title">
            <q-icon name="sym_o_lightbulb" size="14px" /> Мікроурок (спроба {{ iterations }})
          </div>
          <p>{{ lastWrong }}</p>
        </div>
        <div v-if="error" class="banner banner-error">{{ error }}</div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { dispatch } from '../tool/index.js'

const props = defineProps({
  decision: { type: Object, required: true },
  mandatesDir: { type: String, required: true }
})
const emit = defineEmits(['approved'])

const chosenOption = ref(null)
const quiz = ref(null)
const quizLoading = ref(false)
const answering = ref(false)
const approved = ref(false)
const approvalResult = ref(null)
const lastWrong = ref(null)
const iterations = ref(0)
const error = ref(null)

const shortPubkey = computed(() => {
  const key = approvalResult.value?.approval?.pubkey ?? ''
  return key.length > 12 ? `${key.slice(0, 8)}…` : key
})

/**
 * Обирає варіант decision-request-а й одразу генерує/показує one-tap квіз
 * про наслідки саме цього варіанта (конституція п.2: питання — з самого
 * decision-request, не з шаблону).
 * @param {string} label обраний варіант (напр. `'B'`)
 * @returns {Promise<void>}
 */
async function chooseOption(label) {
  chosenOption.value = label
  quizLoading.value = true
  error.value = null
  const res = await dispatch('decision_quiz', {
    mandatesDir: props.mandatesDir,
    runId: props.decision.runId,
    nnnn: props.decision.nnnn,
    chosenOption: label
  })
  quizLoading.value = false
  if (!res.ok) {
    error.value = res.error.message
    return
  }
  quiz.value = { question: res.output.question, options: res.output.options }
  iterations.value = res.output.iterations
}

/**
 * Скидає вибір варіанта — «змінити варіант» до підпису (квіз-файл на диску
 * лишається мутабельним чернетковим станом до фіксації правильною відповіддю).
 * @returns {void}
 */
function reset() {
  chosenOption.value = null
  quiz.value = null
  lastWrong.value = null
  error.value = null
}

/**
 * Проводить квіз-відповідь через `decision_approve` — неправильна показує
 * мікроурок і лишає гейт відкритим (фейл ≠ покарання), правильна фіналізує
 * квіз і пише підписаний approval, після чого картка повідомляє батька.
 * @param {number} index 0-based індекс обраної відповіді
 * @returns {Promise<void>}
 */
async function answer(index) {
  answering.value = true
  error.value = null
  const res = await dispatch('decision_approve', {
    mandatesDir: props.mandatesDir,
    runId: props.decision.runId,
    nnnn: props.decision.nnnn,
    chosenOption: chosenOption.value,
    answer: index
  })
  answering.value = false
  if (!res.ok) {
    error.value = res.error.message
    return
  }
  if (res.output.approved) {
    approved.value = true
    approvalResult.value = res.output
    emit('approved', { runId: props.decision.runId, nnnn: props.decision.nnnn, approval: res.output.approval })
    return
  }
  lastWrong.value = res.output.microlesson
  iterations.value = res.output.iterations
}
</script>

<style scoped>
.decision-card {
  border: 1px solid color-mix(in srgb, currentcolor 10%, transparent);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row-top {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.request-id {
  font-family: 'SF Mono', ui-monospace, monospace;
  font-weight: 650;
  font-size: 12.5px;
}

.facet-badge {
  font-size: 10px;
}

.deadline {
  font-size: 11px;
  opacity: 0.6;
}

.context {
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  white-space: pre-line;
}

.section-label {
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.6;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.option {
  border: 1px solid color-mix(in srgb, currentcolor 8%, transparent);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.option-head {
  font-size: 13px;
}

.option-body {
  font-size: 12px;
  opacity: 0.75;
  margin: 0;
}

.recommendation {
  font-size: 12px;
  opacity: 0.7;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 4px 0 0;
}

.quiz {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.change-option {
  opacity: 0.6;
}

.quiz-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  opacity: 0.7;
}

.quiz-question {
  font-size: 13.5px;
  font-weight: 600;
  margin: 0;
}

.quiz-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.quiz-option-btn {
  justify-content: flex-start;
  white-space: normal;
  text-align: left;
  border: 1px solid color-mix(in srgb, currentcolor 12%, transparent);
}

.microlesson-banner {
  background: color-mix(in srgb, #f5a623 12%, transparent);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
}

.microlesson-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 650;
  margin-bottom: 4px;
}

.microlesson-banner p {
  margin: 0;
  opacity: 0.85;
}

.approved-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: #14b8a6;
}

.banner {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
}

.banner-error {
  background: color-mix(in srgb, #ff453a 12%, transparent);
  color: #ff453a;
}
</style>
