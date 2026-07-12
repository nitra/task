<template>
  <q-card flat bordered class="decision-card">
    <q-card-section class="decision-head">
      <q-badge :color="badgeColor" :label="decision.node.state" />
      <span class="decision-node">{{ decision.node.path }}</span>
      <span class="decision-workspace">{{ decision.workspace.label }}</span>
    </q-card-section>

    <q-card-section class="decision-headline">
      {{ decision.headline }}
    </q-card-section>

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
        v-if="canAct('approve') && planChildren.length === 0"
        @click="loadPlan"
        flat
        dense
        icon="sym_o_visibility"
        label="переглянути план"
        :loading="busy === 'plan'" />
      <q-btn
        v-if="canAct('approve')"
        @click="approve"
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
    </q-card-actions>

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
import { dispatch } from '../tool/index.js'

const AUTONOMY_LABELS = {
  deploy: 'деплой',
  external_comms: 'зовнішні комунікації',
  spend: 'витрати',
  worktree_edit: 'worktree',
  default: 'усе інше'
}

const props = defineProps({
  decision: { type: Object, required: true }
})
const emit = defineEmits(['acted'])

const $q = useQuasar()

const busy = ref('')
const askReason = ref(false)
const askSummary = ref(false)
const reason = ref('')
const summary = ref('')
const planChildren = ref([])
const autonomyRows = ref([])

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

/**
 * Викликає tool і повідомляє результат; успіх → подія acted (rescan у батька).
 * @param {string} name імʼя tool
 * @param {object} input вхід tool
 * @returns {Promise<boolean>} true при успіху
 */
async function act(name, input) {
  busy.value = name === 'mark_done' ? 'done' : name.replace('_plan', '')
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
 * Підвантажує дітей плану для картки plan-review (рудимент брифу штабу).
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

.dialog-title {
  font-size: 13px;
  font-weight: 600;
  padding-bottom: 0;
}
</style>
