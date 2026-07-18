<template>
  <div class="brief">
    <section v-for="section in sections" :key="section.title">
      <div class="brief-section" :class="{ 'brief-section-overdue': section.overdue }">{{ section.title }}</div>
      <q-list bordered separator class="brief-list">
        <q-item v-for="row in section.rows" :key="row.key">
          <q-item-section avatar>
            <q-icon :name="row.icon" :color="row.color" size="20px" :title="row.hint" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="brief-node" :class="{ 'brief-overdue': row.overdue }">{{ row.path }}</q-item-label>
            <q-item-label caption>{{ row.caption }}</q-item-label>
          </q-item-section>
          <q-item-section v-if="row.snoozeId" side>
            <q-btn
              @click="emit('snooze', row.snoozeId)"
              flat
              dense
              round
              size="sm"
              icon="sym_o_notifications_paused"
              title="Тихо до завтра — глушить лише в тебе, deadline у git не чіпає" />
          </q-item-section>
          <q-item-section v-else side class="brief-workspace">{{ row.side }}</q-item-section>
        </q-item>
      </q-list>
    </section>
    <section v-if="delta.length === 0" class="brief-empty">Змін із минулого візиту немає.</section>
  </div>
</template>

<script setup>
// Бриф — дельта замість стану: власник читає зміни, машина читає стан.
// Кожна секція — той самий рядковий каркас (іконка/шлях/підпис/бік), тож
// розмітка одна, а зміст секцій деривується в sections:
// нагадування (M7, snooze лише в мене) → дельта → задачі в кошиках
// дедлайнів → ескалації вгору → делеговане (двонапрямний бриф M6).

import { computed } from 'vue'
import { bucketPersonal } from '../reminders.js'

const KIND_VIEW = {
  escalated: { icon: 'sym_o_priority_high', color: 'negative', text: 'ескалація' },
  resolved: { icon: 'sym_o_check_circle', color: 'positive', text: 'завершено' },
  appeared: { icon: 'sym_o_add_circle', color: 'info', text: 'новий вузол' },
  changed: { icon: 'sym_o_sync_alt', color: 'grey', text: 'зміна стану' },
  gone: { icon: 'sym_o_remove_circle', color: 'grey', text: 'вузол зник' }
}

const props = defineProps({
  delta: { type: Array, required: true },
  personal: { type: Array, required: true },
  // Двонапрямний бриф (M6): «чого чекають від мене» доповнюється «чого чекаю я».
  delegations: { type: Array, default: () => [] },
  escalatedOut: { type: Array, default: () => [] },
  // Нагадування (M7) — вже після applySnoozes.
  reminders: { type: Array, default: () => [] }
})

const emit = defineEmits(['snooze'])

/**
 * Людський опис переходу стану.
 * @param {{ kind: string, from?: string, to?: string }} row рядок дельти
 * @returns {string} підпис рядка
 */
function describe(row) {
  const label = KIND_VIEW[row.kind]?.text ?? row.kind
  if (row.kind === 'gone') return `${label} (був ${row.from})`
  if (row.from) return `${label}: ${row.from} → ${row.to}`
  return `${label}: ${row.to}`
}

/**
 * Коротке імʼя воркспейсу з його шляху.
 * @param {string} workspacePath абсолютний шлях tasks-директорії
 * @returns {string} остання значуща ланка шляху
 */
function shortWorkspace(workspacePath) {
  const parts = workspacePath.split('/').filter(Boolean)
  return parts.at(parts.at(-1) === 'mt' ? -2 : -1) ?? workspacePath
}

/**
 * Рядок задачі з дедлайном у підписі.
 * @param {{ node: object, workspace: { label: string, path: string } }} row рядок collectPersonal
 * @param {boolean} overdue чи прострочена
 * @returns {object} рядок секції
 */
function personalRow(row, overdue) {
  const deadline = row.node.deadline ? ` · дедлайн: ${row.node.deadline}` : ''
  return {
    key: row.workspace.path + row.node.path,
    icon: 'sym_o_person',
    color: overdue ? 'negative' : 'warning',
    path: row.node.path,
    caption: `чекає на тебе як виконавця${deadline}`,
    side: row.workspace.label,
    overdue
  }
}

const sections = computed(() => {
  const list = []

  if (props.reminders.length > 0) {
    list.push({
      title: 'Нагадування',
      rows: props.reminders.map(reminder => ({
        key: reminder.id,
        icon: reminder.rule === 'escalation_stale' ? 'sym_o_hourglass_top' : 'sym_o_alarm',
        color: reminder.overdue ? 'negative' : 'warning',
        path: reminder.path,
        caption: reminder.headline,
        overdue: reminder.overdue,
        snoozeId: reminder.id
      }))
    })
  }

  if (props.delta.length > 0) {
    list.push({
      title: 'Що змінилось із минулого візиту',
      rows: props.delta.map(row => ({
        key: row.workspace + row.path,
        icon: KIND_VIEW[row.kind]?.icon ?? 'sym_o_circle',
        color: KIND_VIEW[row.kind]?.color ?? 'grey',
        path: row.path,
        caption: describe(row),
        side: shortWorkspace(row.workspace)
      }))
    })
  }

  // Кошики дедлайнів (M7): кожен — власна секція, від найпекучішого.
  for (const bucket of bucketPersonal(props.personal, Date.now())) {
    list.push({
      title: `Твої задачі — ${bucket.label} (${bucket.rows.length})`,
      overdue: bucket.key === 'overdue',
      rows: bucket.rows.map(row => personalRow(row, bucket.key === 'overdue'))
    })
  }

  if (props.escalatedOut.length > 0) {
    list.push({
      title: 'Ескальовано, чекає вердикту',
      rows: props.escalatedOut.map(row => ({
        key: row.workspace.path + row.node.path,
        icon: 'sym_o_arrow_upward',
        color: 'info',
        path: row.node.path,
        caption: `записка у черзі ${row.escalation.to} з ${row.escalation.created_at}`,
        side: row.workspace.label
      }))
    })
  }

  if (props.delegations.length > 0) {
    list.push({
      title: 'Чого чекаєш ти (делеговане)',
      rows: props.delegations.map(row => {
        const deadline = row.node.deadline ? ` · дедлайн: ${row.node.deadline}` : ''
        return {
          key: row.workspace.path + row.node.path,
          icon: 'sym_o_handshake',
          color: 'secondary',
          hint: 'Запечатана гілка — видно лише контракт',
          path: row.node.path,
          caption: `власник: ${row.owner} · стан: ${row.node.state}${deadline}`,
          side: row.workspace.label
        }
      })
    })
  }

  return list
})
</script>

<style scoped>
.brief {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.brief-section {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.6;
  margin-bottom: 8px;
}

.brief-section-overdue {
  color: var(--q-negative);
  opacity: 0.9;
}

.brief-list {
  border-radius: 10px;
}

.brief-node {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 13px;
}

.brief-overdue {
  color: var(--q-negative);
}

.brief-workspace {
  font-size: 12px;
  opacity: 0.55;
}

.brief-empty {
  font-size: 13px;
  opacity: 0.6;
}
</style>
