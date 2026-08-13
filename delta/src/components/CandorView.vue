<template>
  <div class="candor-view">
    <div class="toolbar">
      <div class="headline">Незручна правда</div>
      <WhyThisWorks topic="candor" />
      <q-badge v-if="unreadCount > 0" color="negative" :label="unreadCount" rounded />
      <q-space />
      <q-btn @click="rescan" flat dense round icon="sym_o_refresh" :loading="loading" />
    </div>
    <p class="subtitle">
      Окремий інбокс — те, що агент зобов'язаний сказати за анти-сикофантським контрактом, ВІДДІЛЕНО від черги «Вирішую»
      (конституція п.6). `audacity_level` кожної заяви обмежений бюджетом зухвалості мандата моделі — той самий ресурс,
      що «жорсткі переговори сам» на вкладці «Довіряю».
    </p>

    <div v-if="error" class="banner banner-error">{{ error }}</div>

    <div v-if="inbox.length === 0" class="empty-state">
      <q-icon name="sym_o_forum" size="28px" class="empty-icon" />
      <p class="empty-hint">Порожньо — жодна модель ще не сказала тобі незручної правди.</p>
    </div>
    <div v-else class="candor-list">
      <div v-for="record in inbox" :key="record.id" class="candor-card" :class="{ unread: !record.read }">
        <div class="candor-card-head">
          <q-icon name="sym_o_record_voice_over" size="16px" />
          <span class="candor-from">{{ record.from_model }}</span>
          <q-badge :color="audacityColor(record.audacity_level)" :label="record.audacity_level" dense />
          <q-space />
          <span class="candor-date">{{ formatDate(record.created_at) }}</span>
        </div>
        <p class="candor-statement">{{ record.statement }}</p>
        <div v-if="record.evidence_refs?.length" class="candor-evidence">
          <span v-for="ref in record.evidence_refs" :key="ref" class="evidence-chip">{{ ref }}</span>
        </div>
        <div class="candor-actions">
          <q-btn
            v-if="!record.read"
            @click="markRead(record.id)"
            flat
            dense
            no-caps
            size="sm"
            icon="sym_o_check"
            label="позначити прочитаним" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useCandor } from '../composables/use-candor.js'
import WhyThisWorks from './WhyThisWorks.vue'

// «Незручна правда» — UI-догон M5 (M6, docs/specs/260809-delta-app.md,
// «Обсяг M6», п.1): чистий рендер `candor_show`/`candor_mark_read`, той
// самий tool-шар, що вже мав CLI-паритет у M5 — цей компонент лише додає
// GUI-поверхню, логіка вже існує (`src/candor.js`).

const { inbox, unreadCount, loading, error, refreshConfig, rescan, markRead } = useCandor()

const AUDACITY_COLORS = { low: 'grey-6', medium: 'warning', high: 'negative' }

/**
 * @param {string} level `audacity_level` запису
 * @returns {string} Quasar-колір бейджа
 */
function audacityColor(level) {
  return AUDACITY_COLORS[level] ?? 'grey-6'
}

/**
 * @param {string} iso ISO-час запису
 * @returns {string} людиночитабельна дата
 */
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

onMounted(async () => {
  await refreshConfig()
  await rescan()
})

defineExpose({ rescan })
</script>

<style scoped src="../styles/view-toolbar.css"></style>
<style scoped src="../styles/empty-state-compact.css"></style>
<style scoped>
.candor-view {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.candor-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.candor-card {
  border: 1px solid color-mix(in srgb, currentcolor 10%, transparent);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.candor-card.unread {
  border-color: color-mix(in srgb, #14b8a6 40%, transparent);
}

.candor-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.candor-from {
  font-weight: 650;
}

.candor-date {
  font-size: 11px;
  opacity: 0.55;
}

.candor-statement {
  font-size: 13px;
  margin: 0;
  line-height: 1.45;
}

.candor-evidence {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.evidence-chip {
  font-size: 10.5px;
  font-family: 'SF Mono', ui-monospace, monospace;
  padding: 2px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, currentcolor 8%, transparent);
  opacity: 0.75;
}

.candor-actions {
  display: flex;
  justify-content: flex-end;
}
</style>
