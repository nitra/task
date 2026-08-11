<template>
  <div class="watcher-view">
    <div class="toolbar">
      <div class="headline">Стежу</div>
      <q-space />
      <q-btn
        @click="runScan"
        flat
        dense
        no-caps
        size="sm"
        icon="sym_o_visibility"
        label="прогнати watcher"
        :loading="scanning" />
      <q-btn @click="rescan" flat dense round icon="sym_o_refresh" :loading="loading" />
    </div>
    <p class="subtitle">
      Watcher — актор ПРОЦЕСУ, не людей: перший пінг завжди виконавцю («допомогти?»), лише після grace-періоду —
      власнику вище, прозоро для обох (mandates.md, «Process watcher»). Тиха година батчить некритичні нотифікації;
      irreversible-рішення з дедлайном — виняток.
    </p>

    <div v-if="error" class="banner banner-error">{{ error }}</div>

    <section class="quiet-hours-section">
      <div class="section-label">Тиха година (пристрій)</div>
      <div class="quiet-hours-row">
        <q-input v-model="quietStart" dense outlined placeholder="20:00" class="quiet-input" />
        <span class="quiet-dash">–</span>
        <q-input v-model="quietEnd" dense outlined placeholder="09:00" class="quiet-input" />
        <q-btn @click="onSaveQuietHours" unelevated dense no-caps size="sm" color="primary" label="зберегти" />
      </div>
      <p class="quiet-hint">
        {{
          quietHours
            ? `Активна: ${quietHours.start}–${quietHours.end}`
            : 'Не налаштовано — нотифікації ніколи не притлумлюються.'
        }}
      </p>
    </section>

    <section class="notifications-section">
      <div class="section-label">Нотифікації ({{ notifications.length }})</div>
      <div v-if="notifications.length === 0" class="empty-state">
        <q-icon name="sym_o_notifications_none" size="28px" class="empty-icon" />
        <p class="empty-hint">Немає нотифікацій — жодне рішення під твоєю відповідальністю не застаріло за SLA.</p>
      </div>
      <div v-else class="notification-list">
        <div v-for="(n, i) in notifications" :key="i" class="notification-item" :class="{ batched: n.batched }">
          <q-icon :name="notificationIcon(n.kind)" size="16px" />
          <span class="notification-message">{{ n.message }}</span>
          <q-badge v-if="n.batched" color="grey-6" label="відкладено" dense />
        </div>
      </div>
    </section>

    <section class="union-section">
      <div class="section-label">Що про мене знає система — профспілковий режим (конституція п.9)</div>
      <div v-if="whatSystemKnows" class="union-grid">
        <div class="union-card">
          <div class="union-card-title">База знань</div>
          <div class="union-card-value">{{ whatSystemKnows.knowledge.entryCount }} записів</div>
        </div>
        <div class="union-card">
          <div class="union-card-title">Пінги мені</div>
          <div class="union-card-value">{{ whatSystemKnows.notifications.pingsToMe.length }}</div>
        </div>
        <div class="union-card">
          <div class="union-card-title">Пішло вгору (з моїх)</div>
          <div class="union-card-value">{{ whatSystemKnows.notifications.escalatedFromMe.length }}</div>
        </div>
        <div class="union-card">
          <div class="union-card-title">Реєстр pubkey</div>
          <div class="union-card-value pubkey">{{ shortPubkey }}</div>
        </div>
      </div>
    </section>

    <section class="drift-section">
      <div class="toolbar">
        <div class="section-label" style="margin-bottom: 0">
          Дрейф — приватне дзеркало «мета vs комфорт» (конституція п.6, лише мені)
        </div>
        <q-space />
        <q-btn
          @click="runDriftScan"
          flat
          dense
          no-caps
          size="sm"
          icon="sym_o_query_stats"
          label="прогнати скан"
          :loading="driftScanning" />
      </div>
      <div v-if="driftError" class="banner banner-error">{{ driftError }}</div>
      <div v-if="!driftHasCards" class="empty-state">
        <q-icon name="sym_o_trending_flat" size="28px" class="empty-icon" />
        <p class="empty-hint">Немає класів рішень, які ти системно відкладаєш — жодної картки.</p>
      </div>
      <div v-else class="drift-cards">
        <div v-for="card in driftCards" :key="card.decisionType" class="drift-card">
          <div class="drift-card-head">
            <span class="drift-type">{{ card.decisionType }}</span>
            <q-badge color="grey-6" :label="`${card.count} шт`" dense />
            <span class="drift-age">найстаріше — {{ card.oldestAgeDays }} дн.</span>
          </div>
          <div v-for="item in card.items" :key="`${item.runId}/${item.nnnn}`" class="drift-item">
            <span class="drift-item-ref">{{ item.runId }}/{{ item.nnnn }}</span>
            <q-badge
              :color="item.signal === 'both' ? 'negative' : 'warning'"
              :label="signalLabel(item.signal)"
              dense
              outline />
            <q-space />
            <template v-if="delegateState[`${item.runId}/${item.nnnn}`]?.delegated">
              <q-badge color="positive" label="делеговано" dense />
            </template>
            <template v-else-if="delegateState[`${item.runId}/${item.nnnn}`]">
              <div class="delegate-quiz">
                <span class="delegate-question">{{ delegateState[`${item.runId}/${item.nnnn}`].question }}</span>
                <q-btn
                  v-for="(option, i) in delegateState[`${item.runId}/${item.nnnn}`].options"
                  :key="i"
                  @click="onSubmitDelegate(item, i)"
                  outline
                  dense
                  no-caps
                  size="sm"
                  :label="option"
                  class="delegate-option" />
              </div>
            </template>
            <q-btn
              v-else-if="eligibleModel(card.decisionType)"
              @click="onStartDelegate(item, card.decisionType)"
              flat
              dense
              no-caps
              size="sm"
              icon="sym_o_smart_toy"
              :label="`делегувати ${eligibleModel(card.decisionType).owner}`" />
            <span v-else class="no-model-hint">немає моделі під мій мандат для «{{ card.decisionType }}»</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { useDrift } from '../composables/use-drift.js'
import { useWatcher } from '../composables/use-watcher.js'

// «Стежу» (docs/specs/260809-delta-app.md, «Обсяг M4», п.3/4/5) — четверта
// площина конституції, раніше позначена як «лишається M4» (App.vue): лог
// нотифікацій watcher-а (SLA-пінг виконавцю → ескалація власнику, прозора
// копія виконавцю), налаштування тихої години, і профспілковий агрегатор
// «що про мене знає система» (п.9) — чистий рендер уже наявних даних, без
// нових зборів. Самодостатній компонент — той самий патерн, що решта вкладок.

const {
  identity,
  mandatesDir,
  notifications,
  quietHours,
  whatSystemKnows,
  loading,
  scanning,
  error,
  refreshConfig,
  rescan,
  runScan,
  saveQuietHours
} = useWatcher()

const {
  cards: driftCards,
  hasCards: driftHasCards,
  scanning: driftScanning,
  error: driftError,
  delegateState,
  refreshConfig: refreshDriftConfig,
  rescan: rescanDrift,
  runScan: runDriftScan,
  eligibleModel,
  startDelegate,
  submitDelegate
} = useDrift()

const quietStart = ref('')
const quietEnd = ref('')

/**
 * @param {'stale'|'repeated-iterations'|'both'} signal сигнал дрейф-item-а
 * @returns {string} людиночитабельна мітка
 */
function signalLabel(signal) {
  if (signal === 'stale') return 'застаріле'
  if (signal === 'repeated-iterations') return 'повторні спроби'
  return 'застаріле + повторні спроби'
}

/**
 * @param {object} item item дрейф-картки
 * @param {string} decisionType клас рішень картки
 * @returns {Promise<void>}
 */
async function onStartDelegate(item, decisionType) {
  const model = eligibleModel(decisionType)
  if (model) await startDelegate(item, model.owner)
}

/**
 * @param {object} item item дрейф-картки
 * @param {number} answerIndex обраний варіант
 * @returns {Promise<void>}
 */
async function onSubmitDelegate(item, answerIndex) {
  await submitDelegate(item, answerIndex)
}

const shortPubkey = computed(() => {
  const key = whatSystemKnows.value?.registry?.pubkeyBase64 ?? ''
  return key ? `${key.slice(0, 10)}…` : '— (ще не зареєстровано)'
})

/**
 * @param {string} kind вид нотифікації (`watcher.js`)
 * @returns {string} назва іконки Material Symbols
 */
function notificationIcon(kind) {
  if (kind === 'sla-ping-executor') return 'sym_o_handshake'
  if (kind === 'sla-escalate-owner') return 'sym_o_arrow_upward'
  return 'sym_o_visibility'
}

/**
 * Зберігає тиху годину з полів форми (порожні поля — no-op).
 * @returns {Promise<void>}
 */
async function onSaveQuietHours() {
  if (!quietStart.value.trim() || !quietEnd.value.trim()) return
  await saveQuietHours(quietStart.value.trim(), quietEnd.value.trim())
}

onMounted(async () => {
  await refreshConfig()
  if (mandatesDir.value && identity.value) await rescan()
  await refreshDriftConfig()
  if (mandatesDir.value && identity.value) await rescanDrift()
})

defineExpose({ rescan, rescanDrift })
</script>

<style scoped src="../styles/view-toolbar.css"></style>
<style scoped src="../styles/empty-state-compact.css"></style>
<style scoped>
.watcher-view {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.section-label {
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.6;
  margin-bottom: 8px;
}

.quiet-hours-section,
.notifications-section,
.union-section {
  display: flex;
  flex-direction: column;
}

.quiet-hours-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quiet-input {
  width: 90px;
}

.quiet-dash {
  opacity: 0.5;
}

.quiet-hint {
  font-size: 11.5px;
  opacity: 0.6;
  margin: 6px 0 0;
}

.notification-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.notification-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  border: 1px solid color-mix(in srgb, currentcolor 10%, transparent);
  border-radius: 8px;
  padding: 6px 10px;
}

.notification-item.batched {
  opacity: 0.55;
}

.notification-message {
  flex: 1;
}

.union-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.union-card {
  border: 1px solid color-mix(in srgb, currentcolor 10%, transparent);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.union-card-title {
  font-size: 11px;
  opacity: 0.6;
}

.union-card-value {
  font-size: 15px;
  font-weight: 650;
}

.union-card-value.pubkey {
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 500;
}

.drift-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drift-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drift-card {
  border: 1px solid color-mix(in srgb, currentcolor 10%, transparent);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drift-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}

.drift-type {
  font-weight: 650;
}

.drift-age {
  font-size: 11px;
  opacity: 0.6;
}

.drift-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  flex-wrap: wrap;
}

.drift-item-ref {
  font-family: 'SF Mono', ui-monospace, monospace;
  opacity: 0.75;
}

.no-model-hint {
  font-size: 11px;
  opacity: 0.55;
}

.delegate-quiz {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.delegate-question {
  font-size: 11.5px;
  opacity: 0.8;
  text-align: right;
  max-width: 360px;
}

.delegate-option {
  width: 100%;
  max-width: 360px;
}
</style>
