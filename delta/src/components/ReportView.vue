<template>
  <div class="report-view">
    <div class="toolbar">
      <div class="headline">Звіт</div>
      <q-space />
      <q-input v-model.number="periodDays" dense outlined type="number" min="1" class="period-input" suffix="дн." />
      <q-btn
        @click="generate"
        unelevated
        dense
        no-caps
        size="sm"
        color="primary"
        label="згенерувати"
        :loading="loading" />
    </div>
    <p class="subtitle">
      Дельта-звіт — детермінований, БЕЗ LLM (конституція п.4: «щотижневий дельта-звіт директору»). Пишеться у
      <code>.mt/reports/YYYY-MM-DD-delta.md</code>; той самий результат — CLI <code>delta_report</code>.
    </p>

    <div v-if="error" class="banner banner-error">{{ error }}</div>

    <div v-if="!report" class="empty-state">
      <q-icon name="sym_o_summarize" size="28px" class="empty-icon" />
      <p class="empty-hint">Натисни «згенерувати» — звіт порахує вікно {{ periodDays }} дн. від зараз.</p>
    </div>

    <div v-else class="report-body">
      <section class="report-section">
        <div class="section-label">Рух межі ({{ report.boundaryMoves.length }})</div>
        <div v-if="report.boundaryMoves.length === 0" class="empty-hint">
          Жодного застосованого mandate-change за період.
        </div>
        <div v-else class="move-list">
          <div v-for="(move, i) in report.boundaryMoves" :key="i" class="move-item">
            <b>{{ move.owner }}</b> — {{ moveLabel(move.kind) }} (делегатор <code>{{ move.delegatorHandle }}</code
            >)
            <ul>
              <li v-for="(d, j) in move.diffLines" :key="j">{{ d }}</li>
            </ul>
          </div>
        </div>
      </section>

      <section class="report-section">
        <div class="section-label">Рішення за період</div>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-title">Усього закрито</div>
            <div class="stat-value">{{ report.decisions.total }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Людських</div>
            <div class="stat-value">{{ report.decisions.byClassification.human }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Модельних</div>
            <div class="stat-value">{{ report.decisions.byClassification.model }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Кворумних</div>
            <div class="stat-value">{{ report.decisions.byClassification.quorum }}</div>
          </div>
        </div>
        <table v-if="report.decisions.byType.length > 0" class="type-table">
          <thead>
            <tr>
              <th>клас рішень</th>
              <th>людських</th>
              <th>модельних</th>
              <th>кворумних</th>
              <th>усього</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in report.decisions.byType" :key="t.decisionType">
              <td>{{ t.decisionType }}</td>
              <td>{{ t.human }}</td>
              <td>{{ t.model }}</td>
              <td>{{ t.quorum }}</td>
              <td>{{ t.total }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="report-section">
        <div class="section-label">Ціна гейта</div>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-title">Σ час × ставка ({{ report.hourlyRateEur }} €/год)</div>
            <div class="stat-value">{{ report.gateCostEur }} €</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Заблоковано (deadline_cost, знімок)</div>
            <div class="stat-value">{{ report.blockedWithDeadlineCost }}</div>
          </div>
        </div>
      </section>

      <section class="report-section">
        <div class="section-label">Глибина делегування</div>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-title">Класів із model-власником</div>
            <div class="stat-value">{{ report.delegationDepth.modelOwnedDecisionTypes }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Делегувань за період</div>
            <div class="stat-value">{{ report.delegationDepth.delegationsInPeriod }}</div>
          </div>
        </div>
      </section>

      <section class="report-section">
        <div class="section-label">Агреговано (без приватного)</div>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-title">Кандор-заяв доставлено</div>
            <div class="stat-value">{{ report.candorDelivered }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-title">Активацій kill-switch</div>
            <div class="stat-value">{{ report.killSwitchActivations }}</div>
          </div>
        </div>
      </section>

      <p class="report-path">
        Записано: <code>{{ report.path }}</code>
      </p>
    </div>
  </div>
</template>

<script setup>
import { useReport } from '../composables/use-report.js'

// «Звіт» (M6, docs/specs/260809-delta-app.md, «Обсяг M6», п.2) — сьома
// площина конституції: чистий рендер `delta_report` простим списком/
// числами (задача M6, п.2: «UI-вкладка «Звіт» (рендер простим списком/
// числами)») — жодних чартів, жодного власного стиснення даних, логіка
// вже вся в `src/report.js`.

const { report, loading, error, periodDays, refreshConfig, generate } = useReport()

const MOVE_LABELS = {
  added: 'додано мандат',
  removed: 'видалено мандат',
  'kind-changed': 'змінено kind',
  'escalates-to-changed': 'змінено делегатора',
  widened: 'розширено',
  narrowed: 'звужено'
}

/**
 * @param {string} kind вид зміни (`mandate-change.js: classifyMandateChange`)
 * @returns {string} людиночитабельна мітка
 */
function moveLabel(kind) {
  return MOVE_LABELS[kind] ?? kind
}

onMounted(refreshConfig)

defineExpose({ generate })
</script>

<style scoped src="../styles/view-toolbar.css"></style>
<style scoped src="../styles/empty-state-compact.css"></style>
<style scoped>
.report-view {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.period-input {
  width: 90px;
}

.report-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.report-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.6;
}

.move-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.move-item {
  font-size: 12.5px;
  border: 1px solid color-mix(in srgb, currentcolor 10%, transparent);
  border-radius: 8px;
  padding: 8px 10px;
}

.move-item ul {
  margin: 4px 0 0;
  padding-left: 18px;
  opacity: 0.8;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}

.stat-card {
  border: 1px solid color-mix(in srgb, currentcolor 10%, transparent);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-title {
  font-size: 11px;
  opacity: 0.6;
}

.stat-value {
  font-size: 17px;
  font-weight: 650;
}

.type-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.type-table th,
.type-table td {
  text-align: left;
  padding: 4px 8px;
  border-bottom: 1px solid color-mix(in srgb, currentcolor 8%, transparent);
}

.report-path {
  font-size: 11px;
  opacity: 0.55;
  font-family: 'SF Mono', ui-monospace, monospace;
}
</style>
