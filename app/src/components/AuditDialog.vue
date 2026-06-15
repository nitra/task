<template>
  <BaseDialog
    @update:model-value="val => emit('update:modelValue', val)"
    @show="refresh"
    :model-value="modelValue"
    title="Request journal"
    icon="sym_o_history"
    :width="680"
    body-class=""
  >
    <template #header>
      <q-btn @click="refresh" icon="sym_o_refresh" flat round dense size="sm" :loading="loading" title="Refresh" />
    </template>

    <div v-if="!records.length && !loading" class="audit-empty">No requests yet</div>

    <div v-for="rec in records" :key="rec.id" class="audit-row">
      <div @click="toggle(rec.id)" class="audit-head">
        <span class="state-pill" :style="{ '--c': statusColor(rec.status) }">
          <span class="state-pill__dot" />
          {{ rec.status }}
        </span>
        <span class="audit-actor">{{ rec.actor?.kind }}{{ rec.actor?.id ? `:${rec.actor.id}` : '' }}</span>
        <span class="audit-intent">{{ rec.intent }}</span>
        <q-space />
        <span class="audit-time">{{ fmtTime(rec.createdAt) }}</span>
      </div>

      <div v-if="expandedId === rec.id" class="audit-body">
        <RequestView @respond="msg => onRespond(rec, msg)" :result="rec" :busy="busyId === rec.id" />
      </div>
    </div>
  </BaseDialog>
</template>

<script setup>
import { ref } from 'vue'
import { useQuasar } from 'quasar'
import BaseDialog from './BaseDialog.vue'
import RequestView from './RequestView.vue'
import { useAgent } from '../composables/use-agent.js'

const STATUS_COLOR = {
  pending: '#8e8e93',
  running: '#0a84ff',
  done: '#30d158',
  partial: '#ff9f0a',
  needs_clarification: '#64d2ff',
  needs_approval: '#ff9f0a',
  failed: '#ff453a',
}

defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'changed'])

const $q = useQuasar()
const { journal, respond } = useAgent()

const records = ref([])
const loading = ref(false)
const expandedId = ref(null)
const busyId = ref(null)

/**
 * @param {string} status request status
 * @returns {string} accent color
 */
function statusColor(status) {
  return STATUS_COLOR[status] ?? '#8e8e93'
}

/**
 * @param {number} millis epoch millis
 * @returns {string} locale time
 */
function fmtTime(millis) {
  return millis ? new Date(millis).toLocaleString() : ''
}

/**
 * Reload the journal list.
 */
async function refresh() {
  loading.value = true
  try {
    records.value = await journal.list()
  }
  catch (error) {
    $q.notify({ type: 'negative', message: String(error?.message ?? error) })
  }
  finally {
    loading.value = false
  }
}

/**
 * @param {string} id record id to expand/collapse
 */
function toggle(id) {
  expandedId.value = expandedId.value === id ? null : id
}

/**
 * Answer a pending clarification on a journaled request, then refresh.
 * @param {object} rec the record
 * @param {string} message the human's answer
 */
async function onRespond(rec, message) {
  busyId.value = rec.id
  try {
    await respond(rec.id, message)
    await refresh()
    emit('changed')
  }
  catch (error) {
    $q.notify({ type: 'negative', message: String(error?.message ?? error) })
  }
  finally {
    busyId.value = null
  }
}
</script>

<style scoped>
.audit-empty {
  text-align: center;
  padding: 40px 0;
  font-size: 13px;
  opacity: 0.4;
}

.audit-row {
  border-bottom: 1px solid rgb(255 255 255 / 7%);
}

.body--light .audit-row {
  border-bottom-color: rgb(0 0 0 / 7%);
}

.audit-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 4px;
  cursor: pointer;
}

.audit-head:hover {
  background: rgb(255 255 255 / 5%);
}

.body--light .audit-head:hover {
  background: rgb(0 0 0 / 4%);
}

.audit-actor {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  opacity: 0.6;
  flex: 0 0 auto;
}

.audit-intent {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}

.audit-time {
  font-size: 11px;
  opacity: 0.4;
  flex: 0 0 auto;
}

.audit-body {
  padding: 6px 4px 12px;
}

.state-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border-radius: 6px;
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 28%, transparent);
  flex: 0 0 auto;
}

.state-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c);
}
</style>
