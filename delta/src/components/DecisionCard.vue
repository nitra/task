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

    <!-- Кворум (M4): irreversible-рішення вимагає підписів УСІХ approvers,
         кожен ВЛАСНИМ квізом — картка показує, хто підписав/лишився і статус
         (pending/diverged), «не вигадуй авторезолюцію» (mandates.md). -->
    <div v-if="isQuorum" class="quorum-panel">
      <div class="section-label">
        Кворум — {{ decision.quorum.signed.length }}/{{ decision.quorum.approvers.length }}
      </div>
      <div class="quorum-signers">
        <q-badge
          v-for="handle in decision.quorum.approvers"
          :key="handle"
          :color="decision.quorum.signed.some(s => s.handle === handle) ? 'positive' : 'grey-6'"
          :label="`${handle}${decision.quorum.signed.some(s => s.handle === handle) ? ' ✓' : ' …'}`"
          class="facet-badge" />
      </div>
      <p v-if="decision.quorum.status === 'diverged'" class="quorum-diverged">
        Розбіжність кворуму — підписанти обрали РІЗНІ варіанти, рішення лишається відкритим (без авторезолюції).
      </p>
      <p v-else-if="!decision.awaitingMe" class="quorum-hint">
        Ти вже підписав(ла) свою частину — очікуємо: {{ decision.quorum.pending.join(', ') || '—' }}.
      </p>
    </div>

    <p class="context">{{ decision.context }}</p>

    <!-- Крок 1: обрати варіант decision-request-а (недоступно, якщо кворум
         очікує вже не мене — я свою частину підписав(ла)). -->
    <div v-if="!chosenOption && (!isQuorum || decision.awaitingMe)" class="options">
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
        <div v-if="microlesson" class="microlesson-banner">
          <div class="microlesson-title"><q-icon name="sym_o_lightbulb" size="14px" /> Мікроурок</div>
          <p>{{ microlesson }}</p>
        </div>
      </template>

      <!-- teach-back (M5) — немає варіантів відповіді: переказ ВІЛЬНИМ
           текстом своїми словами, локальна модель оцінює покриття. Голосовий
           ввід НЕ реалізовано окремо — macOS-диктовка друкує в цю textarea сама. -->
      <template v-else-if="quiz && isTeachBack">
        <p class="quiz-question">{{ quiz.prompt }}</p>
        <div v-if="quiz.lastFeedback" class="microlesson-banner">
          <div class="microlesson-title"><q-icon name="sym_o_smart_toy" size="14px" /> Модель каже</div>
          <p>{{ quiz.lastFeedback }}</p>
          <p v-if="quiz.missingAspects && quiz.missingAspects.length > 0" class="missing-aspects">
            Пропущено: {{ quiz.missingAspects.join(', ') }}
          </p>
        </div>
        <q-input
          v-model="transcript"
          type="textarea"
          filled
          autogrow
          dense
          :disable="answering"
          placeholder="перекажи, що підписуєш і що станеться: обраний варіант, головний наслідок, головний ризик…" />
        <q-btn
          @click="submitTeachBack"
          :disable="answering || !transcript.trim()"
          unelevated
          no-caps
          color="primary"
          size="sm"
          label="переказати" />

        <div v-if="explain && explain.length > 0" class="explain-panel">
          <div v-for="layer in explain" :key="layer.layer" class="explain-layer">
            <div class="explain-heading">{{ layer.heading }}</div>
            <p class="explain-content">{{ layer.content }}</p>
          </div>
        </div>

        <div v-if="error" class="banner banner-error">{{ error }}</div>
      </template>

      <template v-else-if="quiz">
        <div v-if="quiz.questionCount > 1" class="question-progress">
          Питання {{ quiz.questionIndex }}/{{ quiz.questionCount }}
          <span v-if="quiz.repetition" class="repetition-badge">повторення</span>
        </div>
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

        <!-- Мікроурок — після БУДЬ-якої відповіді (правильної теж), у момент
             максимальної уваги (конституція п.2, М2). -->
        <div v-if="microlesson" class="microlesson-banner">
          <div class="microlesson-title"><q-icon name="sym_o_lightbulb" size="14px" /> Мікроурок</div>
          <p>{{ microlesson }}</p>
        </div>

        <!-- Навчальний режим при фейлі — «право на глибину»: розгортання
             decision-request шар за шаром, кумулятивно з кожним фейлом. -->
        <div v-if="explain && explain.length > 0" class="explain-panel">
          <div v-for="layer in explain" :key="layer.layer" class="explain-layer">
            <div class="explain-heading">{{ layer.heading }}</div>
            <p class="explain-content">{{ layer.content }}</p>
          </div>
        </div>

        <div v-if="error" class="banner banner-error">{{ error }}</div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { dispatch } from '../tool/index.js'

const props = defineProps({
  decision: { type: Object, required: true },
  mandatesDir: { type: String, required: true },
  // Мій handle — потрібен лише для кворумних (irreversible) карток: кожен
  // approver проходить ВЛАСНИЙ квіз (`quorum_quiz`/`quorum_approve`,
  // signerHandle), на відміну від одноосібного `decision_quiz`/`decision_approve`.
  identity: { type: String, default: null }
})
// `approved` — одноосібне рішення закрилося МОЇМ підписом (M1/M2, як і
// раніше); `quorum-signed` — Я підписав(ла) СВОЮ частину кворуму, але
// рішення могло лишитися відкритим для інших/розбіжним — батько (`DecisionsQueue.vue`)
// перечитує чергу (`rescan`), а не видаляє картку локально (той самий
// інваріант, що quorumApprove: закриває ЛИШЕ коли ВСІ підписали однаково).
const emit = defineEmits(['approved', 'quorum-signed'])

const isQuorum = computed(() => Boolean(props.decision.quorum))
// teach-back (M5) — найвища глибина, немає варіантів відповіді (переказ
// вільним текстом, не вибір з опцій) — картка гілкує UI за depth, той самий
// одноосібний/кворумний вибір tool-а (isQuorum), що для Q&A-квізів.
const isTeachBack = computed(() => props.decision.depth === 'teach-back')

const chosenOption = ref(null)
const quiz = ref(null)
const quizLoading = ref(false)
const answering = ref(false)
const approved = ref(false)
const approvalResult = ref(null)
const microlesson = ref(null)
const explain = ref(null)
const iterations = ref(0)
const error = ref(null)
const transcript = ref('')

const shortPubkey = computed(() => {
  const key = approvalResult.value?.approval?.pubkey ?? ''
  return key.length > 12 ? `${key.slice(0, 8)}…` : key
})

/**
 * Обирає варіант decision-request-а й одразу генерує/показує активне
 * питання квізу про наслідки саме цього варіанта (конституція п.2: питання
 * — з самого decision-request, не з шаблону). `depth: standard` дає 2
 * питання; `depth: one-tap` може підмішати spaced-repetition-питання (М2).
 * @param {string} label обраний варіант (напр. `'B'`)
 * @returns {Promise<void>}
 */
async function chooseOption(label) {
  chosenOption.value = label
  quizLoading.value = true
  error.value = null
  const res = isQuorum.value
    ? await dispatch('quorum_quiz', {
        mandatesDir: props.mandatesDir,
        runId: props.decision.runId,
        nnnn: props.decision.nnnn,
        signerHandle: props.identity,
        chosenOption: label
      })
    : await dispatch('decision_quiz', {
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
  quiz.value = isTeachBack.value
    ? { prompt: res.output.prompt, lastFeedback: res.output.lastFeedback, missingAspects: res.output.missingAspects }
    : {
        question: res.output.question,
        options: res.output.options,
        questionIndex: res.output.questionIndex,
        questionCount: res.output.questionCount,
        repetition: res.output.repetition
      }
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
  microlesson.value = null
  explain.value = null
  error.value = null
  transcript.value = ''
}

/**
 * Проводить квіз-відповідь через `decision_approve`. Неправильна — показує
 * мікроурок і навчальний режим (розгортання контексту шар за шаром), гейт
 * лишається відкритим (фейл ≠ покарання). Правильна на НЕостанньому питанні
 * квізу — показує наступне питання (`done: false`), підпис ще недоступний.
 * Правильна на останньому питанні — фіналізує квіз і пише підписаний
 * approval, картка повідомляє батька.
 * @param {number} index 0-based індекс обраної відповіді
 * @returns {Promise<void>}
 */
async function answer(index) {
  answering.value = true
  error.value = null
  const res = isQuorum.value
    ? await dispatch('quorum_approve', {
        mandatesDir: props.mandatesDir,
        runId: props.decision.runId,
        nnnn: props.decision.nnnn,
        signerHandle: props.identity,
        chosenOption: chosenOption.value,
        answer: index
      })
    : await dispatch('decision_approve', {
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
  microlesson.value = res.output.microlesson ?? null
  iterations.value = res.output.iterations

  if (res.output.approved && isQuorum.value) {
    // Я підписав(ла) СВОЮ частину кворуму — рішення могло лишитись
    // відкритим (інші approvers ще не підписали) чи розбіжним: батько
    // перечитує чергу, не видаляє картку локально (deriveQueue сам вирішує,
    // чи картка лишається видимою — quorumQueueItem).
    explain.value = null
    approved.value = true
    approvalResult.value = res.output
    emit('quorum-signed', { runId: props.decision.runId, nnnn: props.decision.nnnn, approval: res.output.approval })
    return
  }

  if (res.output.approved) {
    explain.value = null
    approved.value = true
    approvalResult.value = res.output
    emit('approved', { runId: props.decision.runId, nnnn: props.decision.nnnn, approval: res.output.approval })
    return
  }

  if (res.output.correct) {
    // Правильно, але квіз ще не завершено (standard/spaced-repetition) —
    // переходимо до наступного питання, підпис лишається недоступним.
    explain.value = null
    const next = res.output.nextQuestion
    quiz.value = {
      question: next.question,
      options: next.options,
      questionIndex: next.questionIndex,
      questionCount: next.questionCount,
      repetition: next.repetition
    }
    return
  }

  explain.value = res.output.explain ?? null
}

/**
 * Проводить teach-back-переказ через `decision_approve`/`quorum_approve`
 * (`transcript`, не `answer`). LLM недоступний (`available: false`) —
 * ЧЕСНА відмова показується як помилка, нічого не рахується як спроба.
 * Не зрозумів — фідбек моделі й навчальний режим (`explain`), новий
 * переказ. Зрозумів — фіналізує й підписує, той самий шлях, що `answer()`.
 * @returns {Promise<void>}
 */
async function submitTeachBack() {
  answering.value = true
  error.value = null
  const res = isQuorum.value
    ? await dispatch('quorum_approve', {
        mandatesDir: props.mandatesDir,
        runId: props.decision.runId,
        nnnn: props.decision.nnnn,
        signerHandle: props.identity,
        chosenOption: chosenOption.value,
        transcript: transcript.value
      })
    : await dispatch('decision_approve', {
        mandatesDir: props.mandatesDir,
        runId: props.decision.runId,
        nnnn: props.decision.nnnn,
        chosenOption: chosenOption.value,
        transcript: transcript.value
      })
  answering.value = false
  if (!res.ok) {
    error.value = res.error.message
    return
  }
  if (res.output.available === false) {
    error.value = res.output.message
    return
  }
  transcript.value = ''
  iterations.value = res.output.iterations

  if (res.output.approved && isQuorum.value) {
    explain.value = null
    approved.value = true
    approvalResult.value = res.output
    emit('quorum-signed', { runId: props.decision.runId, nnnn: props.decision.nnnn, approval: res.output.approval })
    return
  }
  if (res.output.approved) {
    explain.value = null
    approved.value = true
    approvalResult.value = res.output
    emit('approved', { runId: props.decision.runId, nnnn: props.decision.nnnn, approval: res.output.approval })
    return
  }

  quiz.value = {
    prompt: quiz.value.prompt,
    lastFeedback: res.output.feedback,
    missingAspects: res.output.missingAspects
  }
  explain.value = res.output.explain ?? null
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

.quorum-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: color-mix(in srgb, currentcolor 5%, transparent);
  border-radius: 8px;
  padding: 8px 10px;
}

.quorum-signers {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.quorum-diverged {
  font-size: 12px;
  color: #ff453a;
  margin: 0;
}

.quorum-hint {
  font-size: 12px;
  opacity: 0.7;
  margin: 0;
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

.missing-aspects {
  margin: 4px 0 0;
  font-size: 11px;
  opacity: 0.7;
}

.question-progress {
  font-size: 11px;
  opacity: 0.6;
  display: flex;
  align-items: center;
  gap: 6px;
}

.repetition-badge {
  background: color-mix(in srgb, #14b8a6 18%, transparent);
  color: #14b8a6;
  border-radius: 999px;
  padding: 1px 8px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: 10px;
}

.explain-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: color-mix(in srgb, currentcolor 5%, transparent);
  border-radius: 8px;
  padding: 8px 10px;
}

.explain-layer {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.explain-heading {
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.6;
}

.explain-content {
  font-size: 12.5px;
  margin: 0;
  white-space: pre-line;
  opacity: 0.9;
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
