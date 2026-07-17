<template>
  <q-card flat bordered class="decision-card">
    <q-card-section class="decision-head">
      <q-badge :color="badgeColor" :label="decision.node.state" />
      <q-badge
        v-if="decision.orphaned"
        color="warning"
        text-color="dark"
        label="нічия земля"
        title="Розмічений ліс, а власник вузла не резолвиться — признач власника (owner: в autonomy.yml)" />
      <q-badge
        v-if="decision.escalation"
        color="negative"
        :label="`від: ${decision.escalation.from}`"
        title="Ескалація — власник гілки вичерпав свої опції і передає рішення тобі" />
      <span class="decision-node">{{ decision.node.path }}</span>
      <span class="decision-workspace">{{ decision.workspace.label }}</span>
    </q-card-section>

    <q-card-section class="decision-headline">
      {{ decision.headline }}
    </q-card-section>

    <q-card-section v-if="decision.escalation" class="decision-escalation">
      <q-expansion-item
        @after-show="noteSeen = true"
        dense
        icon="sym_o_mark_email_unread"
        label="Записка вгору — розгорни перед вердиктом"
        header-class="escalation-note-header">
        <div class="escalation-note">{{ decision.escalation.reason }}</div>
      </q-expansion-item>
    </q-card-section>

    <q-card-section v-if="brief" class="decision-brief">
      <p class="brief-row"><b>Контекст:</b> {{ brief.context }}</p>
      <p v-if="brief.options.length > 0" class="brief-row"><b>Варіанти:</b> {{ brief.options.join(' · ') }}</p>
      <p class="brief-row"><b>Рекомендація:</b> {{ brief.recommendation }}</p>
      <p class="brief-row"><b>Якщо відхилити:</b> {{ brief.ifDeclined }}</p>
    </q-card-section>
    <q-card-section v-else-if="briefError" class="brief-error">Штаб недоступний: {{ briefError }}</q-card-section>

    <q-card-section v-if="planChildren.length > 0" class="decision-plan">
      <div class="plan-title">План: {{ planChildren.length }} підзадач</div>
      <ul class="plan-children">
        <li v-for="child in planChildren" :key="child.name">
          {{ child.name }}
        </li>
      </ul>
      <div v-if="autonomyRows.length > 0" class="plan-autonomy">
        <q-icon name="sym_o_shield" size="14px" />
        <span v-for="row in autonomyRows" :key="row.key" class="autonomy-chip" :class="`gate-${row.gate}`">
          {{ row.label }}: {{ row.gate === 'approve' ? 'підпис' : 'auto' }}
        </span>
      </div>
    </q-card-section>

    <q-card-actions align="right">
      <q-btn
        v-if="!brief && !briefError"
        @click="loadBriefing"
        flat
        dense
        icon="sym_o_auto_awesome"
        label="бриф"
        :loading="briefLoading" />
      <q-btn
        v-if="canAct('approve') && planChildren.length === 0"
        @click="loadPlan"
        flat
        dense
        icon="sym_o_visibility"
        label="переглянути план"
        :loading="busy === 'plan'" />
      <q-btn
        v-if="canAct('approve')"
        @click="openApproveConfirm"
        unelevated
        dense
        color="positive"
        icon="sym_o_check"
        label="approve"
        :loading="busy === 'approve'" />
      <q-btn
        v-if="canAct('reject')"
        @click="askReason = true"
        flat
        dense
        color="negative"
        icon="sym_o_close"
        label="reject"
        :loading="busy === 'reject'" />
      <q-btn
        v-if="canAct('done')"
        @click="askSummary = true"
        unelevated
        dense
        color="primary"
        icon="sym_o_task_alt"
        label="прийняти як виконане"
        :loading="busy === 'done'" />
      <q-btn
        v-if="canAct('resolve')"
        @click="askVerdict = true"
        unelevated
        dense
        color="negative"
        icon="sym_o_gavel"
        label="вердикт"
        :disable="!noteSeen"
        :title="noteSeen ? '' : 'Спершу розгорни записку — вердикт без прочитання не проходить'"
        :loading="busy === 'resolve'" />
      <q-btn
        v-if="!decision.escalation && escalateTo"
        @click="askEscalate = true"
        flat
        dense
        icon="sym_o_arrow_upward"
        :label="`ескалювати до ${escalateTo}`"
        :loading="busy === 'escalate'" />
      <q-btn
        v-if="!decision.escalation"
        @click="askDelegate = true"
        flat
        dense
        icon="sym_o_handshake"
        label="делегувати"
        :loading="busy === 'delegate'" />
    </q-card-actions>

    <q-dialog v-model="askVerdict">
      <q-card class="decision-dialog">
        <q-card-section class="dialog-title">
          Вердикт по ескалації — рішення для {{ decision.escalation?.from }}
        </q-card-section>
        <q-card-section>
          <q-input v-model="verdict" autofocus type="textarea" outlined dense placeholder="Рішення і його підстава" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn @click="askVerdict = false" flat dense label="скасувати" />
          <q-btn @click="resolve" unelevated dense color="negative" label="дати вердикт" :disable="!verdict.trim()" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="askEscalate">
      <q-card class="decision-dialog">
        <q-card-section class="dialog-title">Записка вгору — до {{ escalateTo }}</q-card-section>
        <q-card-section>
          <q-input
            v-model="escalateReason"
            autofocus
            type="textarea"
            outlined
            dense
            placeholder="Що сталося / що я спробував / що прошу / до якого терміну" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn @click="askEscalate = false" flat dense label="скасувати" />
          <q-btn
            @click="sendEscalation"
            unelevated
            dense
            color="primary"
            label="ескалювати"
            :disable="!escalateReason.trim()" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="askDelegate">
      <q-card class="decision-dialog">
        <q-card-section class="dialog-title">Делегувати вузол — людині чи машині</q-card-section>
        <q-card-section class="delegate-form">
          <q-btn-toggle
            v-model="delegateMode"
            spread
            unelevated
            toggle-color="primary"
            :options="[
              { value: 'human', label: 'людині' },
              { value: 'agent', label: 'машині' }
            ]" />
          <q-input
            v-if="delegateMode === 'human'"
            v-model="delegateOwner"
            outlined
            dense
            label="handle власника (як assignee у h.md)"
            hint="Підлеглий, колега чи власний керівник — механізм один" />
          <q-input
            v-if="delegateMode === 'human'"
            v-model="delegateQualification"
            outlined
            dense
            label="кваліфікація виконавця (опційно)" />
          <q-input
            v-model="delegateEnvelope"
            type="textarea"
            outlined
            dense
            label="конверт автономії (опційно)"
            placeholder="deploy: approve
worktree_edit: auto" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn @click="askDelegate = false" flat dense label="скасувати" />
          <q-btn
            @click="sendDelegate"
            unelevated
            dense
            color="primary"
            label="делегувати"
            :disable="delegateMode === 'human' && !delegateOwner.trim()" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="askReason">
      <q-card class="decision-dialog">
        <q-card-section class="dialog-title">Причина відхилення плану</q-card-section>
        <q-card-section>
          <q-input v-model="reason" autofocus type="textarea" outlined dense placeholder="Чому план не годиться" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn @click="askReason = false" flat dense label="скасувати" />
          <q-btn @click="reject" unelevated dense color="negative" label="відхилити" :disable="!reason.trim()" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="askApproveConfirm">
      <q-card class="decision-dialog">
        <q-card-section class="dialog-title">Перед підписом — заперечення критика</q-card-section>
        <q-card-section v-if="objectionLoading" class="objection-loading">
          <q-spinner size="18px" /> генерую найсильніше заперечення…
        </q-card-section>
        <q-card-section v-else-if="objection" class="objection-text">{{ objection }}</q-card-section>
        <q-card-section v-else-if="objectionError" class="objection-error">
          Критик недоступний: {{ objectionError }}
        </q-card-section>
        <q-card-actions align="right">
          <q-btn @click="askApproveConfirm = false" flat dense label="скасувати" />
          <q-btn
            @click="confirmApprove"
            unelevated
            dense
            color="positive"
            :label="objection ? 'я бачив заперечення — approve' : 'продовжити без перевірки — approve'"
            :disable="objectionLoading"
            :loading="busy === 'approve'" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="askSummary">
      <q-card class="decision-dialog">
        <q-card-section class="dialog-title">Summary факту — що досягнуто</q-card-section>
        <q-card-section>
          <q-input
            v-model="summary"
            autofocus
            type="textarea"
            outlined
            dense
            placeholder="Що зроблено і чим підтверджено" />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn @click="askSummary = false" flat dense label="скасувати" />
          <q-btn @click="markDone" unelevated dense color="primary" label="прийняти" :disable="!summary.trim()" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-card>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useQuasar } from 'quasar'
import { effectivePolicyFor } from '../composables/use-autonomy.js'
import { useStaff } from '../composables/use-staff.js'
import { extractMission } from '../mission.js'
import { buildDecisionDigest } from '../staff.js'
import { dispatch } from '../tool/index.js'

const AUTONOMY_LABELS = {
  deploy: 'деплой',
  external_comms: 'зовнішні комунікації',
  spend: 'витрати',
  worktree_edit: 'worktree',
  default: 'усе інше'
}

const props = defineProps({
  decision: { type: Object, required: true },
  // Замовник вузла (M6): є — доступна ескалація «вгору» з обовʼязковою запискою.
  escalateTo: { type: String, default: null }
})
const emit = defineEmits(['acted'])

const $q = useQuasar()
const { requestBriefing, requestObjection } = useStaff()

const busy = ref('')
const askReason = ref(false)
const askSummary = ref(false)
const askApproveConfirm = ref(false)
const askVerdict = ref(false)
const askEscalate = ref(false)
const askDelegate = ref(false)
const noteSeen = ref(false)
const reason = ref('')
const summary = ref('')
const verdict = ref('')
const escalateReason = ref('')
const delegateMode = ref('human')
const delegateOwner = ref('')
const delegateQualification = ref('')
const delegateEnvelope = ref('')
const planChildren = ref([])
const autonomyRows = ref([])
const brief = ref(null)
const briefLoading = ref(false)
const briefError = ref('')
const objection = ref('')
const objectionLoading = ref(false)
const objectionError = ref('')
let digestCache = null

// Колір бейджа за ціною помилки: 0–1 критично, 2 попередження, далі — інфо.
const STAKE_COLORS = ['negative', 'negative', 'warning']
const badgeColor = computed(() => STAKE_COLORS[props.decision.stake] ?? 'info')

/**
 * Чи доступна дія для цього рішення.
 * @param {string} action імʼя дії
 * @returns {boolean} true, коли дія в списку рішення
 */
function canAct(action) {
  return props.decision.actions.includes(action)
}

const BUSY_BY_TOOL = {
  mark_done: 'done',
  approve_plan: 'approve',
  reject_plan: 'reject',
  resolve_escalation: 'resolve'
}

/**
 * Викликає tool і повідомляє результат; успіх → подія acted (rescan у батька).
 * @param {string} name імʼя tool
 * @param {object} input вхід tool
 * @returns {Promise<boolean>} true при успіху
 */
async function act(name, input) {
  busy.value = BUSY_BY_TOOL[name] ?? name
  const envelope = await dispatch(name, {
    tasksDir: props.decision.workspace.path,
    taskPath: props.decision.node.path,
    ...input
  })
  busy.value = ''
  if (envelope.ok) {
    emit('acted')
    return true
  }
  $q.notify({ type: 'negative', message: envelope.error.message })
  return false
}

/**
 * Дайджест рішення для штабу (кешується — бриф і заперечення не сканують
 * ліс двічі): контракт вузла + (для plan-review) підзадачі плану.
 * @returns {Promise<string>} дайджест
 */
async function loadDigest() {
  if (digestCache) return digestCache
  const [read, plan] = await Promise.all([
    dispatch('read_node', { tasksDir: props.decision.workspace.path, taskPath: props.decision.node.path }),
    canAct('approve')
      ? dispatch('plan_review', { tasksDir: props.decision.workspace.path, taskPath: props.decision.node.path })
      : Promise.resolve({ ok: false })
  ])
  const mission = read.ok ? extractMission(read.output, 500) : ''
  const children = plan.ok ? plan.output.children : []
  digestCache = buildDecisionDigest({ decision: props.decision, mission, children })
  return digestCache
}

/**
 * Генерує бриф рішення (контекст/варіанти/рекомендація/наслідок відмови).
 * @returns {Promise<void>}
 */
async function loadBriefing() {
  briefLoading.value = true
  briefError.value = ''
  try {
    brief.value = await requestBriefing(await loadDigest())
  } catch (error) {
    briefError.value = String(error?.message ?? error)
  } finally {
    briefLoading.value = false
  }
}

/**
 * Відкриває гейт перед approve (анти-rubber-stamping): показує найсильніше
 * заперечення критика; генерується один раз на картку.
 * @returns {Promise<void>}
 */
async function openApproveConfirm() {
  askApproveConfirm.value = true
  if (objection.value || objectionError.value) return
  objectionLoading.value = true
  try {
    objection.value = await requestObjection(await loadDigest())
  } catch (error) {
    objectionError.value = String(error?.message ?? error)
  } finally {
    objectionLoading.value = false
  }
}

/**
 * Власник явно побачив заперечення (чи його відсутність) — проводить approve.
 * @returns {Promise<void>}
 */
async function confirmApprove() {
  askApproveConfirm.value = false
  await approve()
}

/**
 * Підвантажує дітей плану для картки plan-review.
 * @returns {Promise<void>}
 */
async function loadPlan() {
  busy.value = 'plan'
  const envelope = await dispatch('plan_review', {
    tasksDir: props.decision.workspace.path,
    taskPath: props.decision.node.path
  })
  if (envelope.ok) planChildren.value = envelope.output.children
  else $q.notify({ type: 'negative', message: envelope.error.message })

  // Лише декларовані предками класи — недекларовані «за замовчуванням approve»
  // не показуємо рядком, інакше кожен план виглядав би однаково повним замком.
  const effective = await effectivePolicyFor(props.decision.workspace.path, props.decision.node.path)
  autonomyRows.value = Object.entries(effective).map(([key, gate]) => ({
    key,
    gate,
    label: AUTONOMY_LABELS[key] ?? key
  }))

  busy.value = ''
}

/**
 * Approve плану — матеріалізує дітей.
 * @returns {Promise<void>}
 */
async function approve() {
  await act('approve_plan', {})
}

/**
 * Reject плану з причиною з діалогу.
 * @returns {Promise<void>}
 */
async function reject() {
  askReason.value = false
  await act('reject_plan', { reason: reason.value.trim() })
}

/**
 * Прийняти вузол виконаним (fact + ## Check) із summary з діалогу.
 * @returns {Promise<void>}
 */
async function markDone() {
  askSummary.value = false
  await act('mark_done', { summary: summary.value.trim() })
}

/**
 * Вердикт замовника по ескалації (доступний лише після розгортання записки).
 * @returns {Promise<void>}
 */
async function resolve() {
  askVerdict.value = false
  await act('resolve_escalation', { nnn: props.decision.escalation.nnn, verdict: verdict.value.trim() })
}

/**
 * Ескалація вузла до замовника з обовʼязковою запискою.
 * @returns {Promise<void>}
 */
async function sendEscalation() {
  askEscalate.value = false
  await act('escalate', { to: props.escalateTo, reason: escalateReason.value.trim() })
}

/**
 * Атомарне делегування вузла: виконавчий прапор + owner:/конверт у autonomy.yml.
 * @returns {Promise<void>}
 */
async function sendDelegate() {
  askDelegate.value = false
  await act('delegate', {
    mode: delegateMode.value,
    owner: delegateMode.value === 'human' ? delegateOwner.value.trim() : undefined,
    autonomyYaml: delegateEnvelope.value.trim() ? `${delegateEnvelope.value.trim()}\n` : undefined,
    qualification: delegateQualification.value.trim() || undefined
  })
}
</script>

<style scoped>
.decision-card {
  border-radius: 10px;
}

.decision-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 0;
}

.decision-node {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 600;
}

.decision-workspace {
  font-size: 12px;
  opacity: 0.55;
  margin-left: auto;
}

.decision-headline {
  padding-top: 6px;
  padding-bottom: 0;
  font-size: 13px;
  opacity: 0.8;
}

.decision-brief {
  padding-top: 8px;
  padding-bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.brief-row {
  margin: 0;
  font-size: 12px;
  opacity: 0.85;
}

.brief-error {
  padding-top: 8px;
  padding-bottom: 0;
  font-size: 12px;
  color: #ff453a;
}

.decision-plan {
  padding-top: 8px;
  padding-bottom: 0;
}

.plan-title {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.7;
}

.plan-children {
  margin: 6px 0 0;
  padding-left: 18px;
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 12px;
}

.plan-autonomy {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  opacity: 0.85;
}

.autonomy-chip {
  font-size: 11px;
  border-radius: 6px;
  padding: 1px 6px;
  border: 1px solid rgb(128 128 128 / 30%);
}

.autonomy-chip.gate-approve {
  color: #ff9f0a;
  border-color: rgb(255 159 10 / 40%);
}

.autonomy-chip.gate-auto {
  color: #30d158;
  border-color: rgb(48 209 88 / 40%);
}

.decision-dialog {
  min-width: 420px;
}

.decision-escalation {
  padding-top: 8px;
  padding-bottom: 0;
}

.escalation-note {
  font-size: 13px;
  border-left: 3px solid #ff453a;
  padding: 4px 0 4px 10px;
  margin: 4px 0 0 8px;
  white-space: pre-wrap;
}

.delegate-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.objection-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  opacity: 0.75;
}

.objection-text {
  font-size: 13px;
  border-left: 3px solid #bf5af2;
  padding-left: 10px;
}

.objection-error {
  font-size: 12px;
  color: #ff9f0a;
}

.dialog-title {
  font-size: 13px;
  font-weight: 600;
  padding-bottom: 0;
}
</style>
