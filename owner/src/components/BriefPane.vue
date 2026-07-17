<template>
  <div class="brief">
    <section v-if="reminders.length > 0">
      <div class="brief-section">Нагадування</div>
      <q-list bordered separator class="brief-list">
        <q-item v-for="reminder in reminders" :key="reminder.id">
          <q-item-section avatar>
            <q-icon
              :name="reminder.rule === 'escalation_stale' ? 'sym_o_hourglass_top' : 'sym_o_alarm'"
              :color="reminder.overdue ? 'negative' : 'warning'"
              size="20px" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="brief-node" :class="{ 'brief-overdue': reminder.overdue }">
              {{ reminder.path }}
            </q-item-label>
            <q-item-label caption>{{ reminder.headline }}</q-item-label>
          </q-item-section>
          <q-item-section side>
            <q-btn
              @click="emit('snooze', reminder.id)"
              flat
              dense
              round
              size="sm"
              icon="sym_o_notifications_paused"
              title="Тихо до завтра — глушить лише в тебе, deadline у git не чіпає" />
          </q-item-section>
        </q-item>
      </q-list>
    </section>

    <section v-if="delta.length > 0">
      <div class="brief-section">Що змінилось із минулого візиту</div>
      <q-list bordered separator class="brief-list">
        <q-item v-for="row in delta" :key="row.workspace + row.path">
          <q-item-section avatar>
            <q-icon :name="deltaIcon(row.kind)" :color="deltaColor(row.kind)" size="20px" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="brief-node">{{ row.path }}</q-item-label>
            <q-item-label caption>{{ describe(row) }}</q-item-label>
          </q-item-section>
          <q-item-section side class="brief-workspace">{{ shortWorkspace(row.workspace) }}</q-item-section>
        </q-item>
      </q-list>
    </section>
    <section v-else class="brief-empty">Змін із минулого візиту немає.</section>

    <section v-if="personal.length > 0">
      <div class="brief-section">Твої задачі ({{ personal.length }})</div>
      <template v-for="bucket in buckets" :key="bucket.key">
        <div class="brief-bucket" :class="{ 'brief-bucket-overdue': bucket.key === 'overdue' }">
          {{ bucket.label }} · {{ bucket.rows.length }}
        </div>
        <q-list bordered separator class="brief-list brief-bucket-list">
          <q-item v-for="row in bucket.rows" :key="row.workspace.path + row.node.path">
            <q-item-section avatar>
              <q-icon name="sym_o_person" :color="bucket.key === 'overdue' ? 'negative' : 'warning'" size="20px" />
            </q-item-section>
            <q-item-section>
              <q-item-label class="brief-node" :class="{ 'brief-overdue': bucket.key === 'overdue' }">
                {{ row.node.path }}
              </q-item-label>
              <q-item-label caption>
                чекає на тебе як виконавця<template v-if="row.node.deadline">
                  · дедлайн: {{ row.node.deadline }}
                </template>
              </q-item-label>
            </q-item-section>
            <q-item-section side class="brief-workspace">{{ row.workspace.label }}</q-item-section>
          </q-item>
        </q-list>
      </template>
    </section>

    <section v-if="escalatedOut.length > 0">
      <div class="brief-section">Ескальовано, чекає вердикту</div>
      <q-list bordered separator class="brief-list">
        <q-item v-for="row in escalatedOut" :key="row.workspace.path + row.node.path">
          <q-item-section avatar>
            <q-icon name="sym_o_arrow_upward" color="info" size="20px" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="brief-node">{{ row.node.path }}</q-item-label>
            <q-item-label caption>
              записка у черзі {{ row.escalation.to }} з {{ row.escalation.created_at }}
            </q-item-label>
          </q-item-section>
          <q-item-section side class="brief-workspace">{{ row.workspace.label }}</q-item-section>
        </q-item>
      </q-list>
    </section>

    <section v-if="delegations.length > 0">
      <div class="brief-section">Чого чекаєш ти (делеговане)</div>
      <q-list bordered separator class="brief-list">
        <q-item v-for="row in delegations" :key="row.workspace.path + row.node.path">
          <q-item-section avatar>
            <q-icon
              name="sym_o_handshake"
              color="secondary"
              size="20px"
              title="Запечатана гілка — видно лише контракт" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="brief-node">{{ row.node.path }}</q-item-label>
            <q-item-label caption>
              власник: {{ row.owner }} · стан: {{ row.node.state
              }}<template v-if="row.node.deadline"> · дедлайн: {{ row.node.deadline }}</template>
            </q-item-label>
          </q-item-section>
          <q-item-section side class="brief-workspace">{{ row.workspace.label }}</q-item-section>
        </q-item>
      </q-list>
    </section>
  </div>
</template>

<script setup>
// Бриф — дельта замість стану: власник читає зміни, машина читає стан.
// M7: згори — нагадування (детерміновані правила з deadline, snooze лише
// в мене), задачі згруповано в кошики дедлайнів від найпекучішого.

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

const buckets = computed(() => bucketPersonal(props.personal, Date.now()))

/**
 * Іконка різновиду дельти.
 * @param {string} kind різновид рядка дельти
 * @returns {string} імʼя іконки
 */
function deltaIcon(kind) {
  return KIND_VIEW[kind]?.icon ?? 'sym_o_circle'
}

/**
 * Колір різновиду дельти.
 * @param {string} kind різновид рядка дельти
 * @returns {string} колір Quasar-палітри
 */
function deltaColor(kind) {
  return KIND_VIEW[kind]?.color ?? 'grey'
}

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

.brief-list {
  border-radius: 10px;
}

.brief-node {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 13px;
}

.brief-workspace {
  font-size: 12px;
  opacity: 0.55;
}

.brief-empty {
  font-size: 13px;
  opacity: 0.6;
}

.brief-bucket {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.5;
  margin: 8px 0 4px;
}

.brief-bucket-overdue {
  color: var(--q-negative);
  opacity: 0.9;
}

.brief-overdue {
  color: var(--q-negative);
}

.brief-bucket-list {
  margin-bottom: 4px;
}
</style>
