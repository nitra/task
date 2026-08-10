<template>
  <div class="trust-view">
    <div class="toolbar">
      <div class="headline">Довіряю</div>
      <q-space />
      <q-btn @click="rescan" flat dense round icon="sym_o_refresh" :loading="loading" />
    </div>
    <p class="subtitle">
      Мої ШІ-мандати (<code>escalates_to</code> — я): трек-рекорд, пороги, зухвалість. «Розширити» ЗАВЖДИ веде до
      звичайного квіз-гейта з людським підписом — тут немає прямого редагування (docs/specs/260809-delta-app.md,
      конституція п.4, «остання константа»).
    </p>

    <div v-if="error" class="banner banner-error">{{ error }}</div>
    <div v-if="actionError" class="banner banner-error">{{ actionError }}</div>
    <div v-if="lastWidenProposal" class="banner banner-info">
      Change-proposal <code>{{ lastWidenProposal.changeId }}</code> подано в чергу «Вирішую» власника
      <code>{{ lastWidenProposal.delegatorHandle }}</code> — пройди квіз там, щоб застосувати.
    </div>

    <div v-else-if="!error && items.length === 0" class="empty-state">
      <q-icon name="sym_o_verified_user" size="32px" class="empty-icon" />
      <p class="empty-title">Немає ШІ-мандатів під твоєю відповідальністю</p>
      <p class="empty-hint">
        Тут з'являються мандати <code>kind: model</code>, чий <code>escalates_to</code> — твій handle.
      </p>
    </div>

    <div v-else class="trust-list">
      <div v-for="item in items" :key="item.mandate.owner" class="trust-card">
        <div class="row-top">
          <q-icon name="sym_o_smart_toy" size="18px" />
          <span class="owner">{{ directory.displayName(item.mandate.owner) }}</span>
          <q-badge color="secondary" :label="`зухвалість: ${item.audacity}`" class="audacity-badge" />
          <q-space />
          <span v-if="generation !== null" class="generation-tag">generation {{ generation }}</span>
        </div>

        <p class="audacity-description">{{ item.audacityDescription }}</p>

        <div class="threshold-row">
          <q-chip v-if="item.mandate.thresholds.budgetEur !== null" dense square size="sm" class="chip">
            бюджет {{ item.mandate.thresholds.budgetEur }} €
          </q-chip>
          <q-chip v-if="item.mandate.thresholds.risk !== null" dense square size="sm" class="chip">
            ризик: {{ item.mandate.thresholds.risk }}
          </q-chip>
          <q-chip dense square size="sm" class="chip">
            {{ item.mandate.thresholds.irreversible ? 'незворотне' : 'зворотне' }}
          </q-chip>
        </div>

        <div class="track-record">
          <div class="section-label">
            Трек-рекорд — активність і послідовність, НЕ оцінка якості (немає ще audit-механіки)
          </div>
          <div v-if="item.trackRecord.totalDecisions === 0" class="track-empty">Ще жодного підписаного рішення.</div>
          <template v-else>
            <div class="track-summary">
              {{ item.trackRecord.totalDecisions }} рішень · {{ item.trackRecord.overrideFreeCount }}/{{
                item.trackRecord.totalDecisions
              }}
              без наступного людського override ({{ Math.round(item.trackRecord.overrideFreeRate * 100) }}%)
            </div>
            <div class="track-types">
              <q-chip
                v-for="t in item.trackRecord.byDecisionType"
                :key="t.decisionType"
                dense
                square
                size="sm"
                class="chip">
                {{ t.decisionType }}: {{ t.count }}
              </q-chip>
            </div>
            <div class="track-recent">
              <div v-for="r in item.trackRecord.recent" :key="`${r.runId}-${r.nnnn}`" class="track-recent-item">
                <span class="track-recent-run">{{ r.runId }}/{{ r.nnnn }}</span>
                <span class="track-recent-option">варіант {{ r.chosenOption }}</span>
                <q-badge v-if="r.override" color="warning" label="override" dense />
              </div>
            </div>
          </template>
        </div>

        <div class="actions-row">
          <q-btn
            @click="onNarrow(item.mandate.owner)"
            flat
            dense
            no-caps
            size="sm"
            icon="sym_o_arrow_downward"
            label="звузити" />
          <q-btn
            @click="onProposeWiden(item.mandate.owner)"
            flat
            dense
            no-caps
            size="sm"
            icon="sym_o_arrow_upward"
            label="розширити" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, watch } from 'vue'
import { useDirectory } from '../composables/use-directory.js'
import { useTrust } from '../composables/use-trust.js'

// «Довіряю» (спека docs/specs/260809-delta-app.md, «Обсяг M3», п.3) — третя
// площина конституції: мої ШІ-мандати з трек-рекордом, audacity-описом
// наслідків і кнопками звузити (миттєво)/розширити (→ change-proposal у
// звичайну чергу «Вирішую», квіз найвищої доступної глибини). Самодостатній
// компонент — той самий патерн, що DecisionsQueue.vue/KnowledgeView.vue.
// M4: display-імена (`directory.js`) підставляються замість голого owner-handle.

const { mandatesDir, items, generation, loading, error, actionError, lastWidenProposal, rescan, narrow, proposeWiden } =
  useTrust()
const directory = useDirectory()

watch(mandatesDir, dir => directory.load(dir))
onMounted(rescan)

/**
 * @param {string} ownerHandle owner мандата
 * @returns {Promise<void>}
 */
async function onNarrow(ownerHandle) {
  await narrow(ownerHandle)
}

/**
 * @param {string} ownerHandle owner мандата
 * @returns {Promise<void>}
 */
async function onProposeWiden(ownerHandle) {
  await proposeWiden(ownerHandle)
}

defineExpose({ rescan })
</script>

<style scoped>
.trust-view {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.headline {
  font-size: 15px;
  font-weight: 650;
}

.subtitle {
  font-size: 12.5px;
  opacity: 0.7;
  margin: -8px 0 0;
}

.banner {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.banner-error {
  background: color-mix(in srgb, #ff453a 12%, transparent);
  color: #ff453a;
}

.banner-info {
  background: color-mix(in srgb, #14b8a6 12%, transparent);
  color: #14b8a6;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
  padding: 40px 16px;
  opacity: 0.85;
}

.empty-icon {
  opacity: 0.5;
  margin-bottom: 4px;
}

.empty-title {
  font-weight: 650;
  font-size: 14px;
  margin: 0;
}

.empty-hint {
  font-size: 12.5px;
  opacity: 0.7;
  margin: 0;
  max-width: 480px;
}

.trust-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.trust-card {
  border: 1px dashed color-mix(in srgb, currentcolor 12%, transparent);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.owner {
  font-weight: 650;
  font-size: 13.5px;
}

.audacity-badge {
  font-size: 10px;
}

.generation-tag {
  font-size: 11px;
  opacity: 0.55;
}

.audacity-description {
  font-size: 12.5px;
  opacity: 0.8;
  margin: 0;
}

.threshold-row,
.track-types {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  font-size: 11px;
}

.section-label {
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.6;
  margin-bottom: 6px;
}

.track-empty {
  font-size: 12px;
  opacity: 0.6;
}

.track-summary {
  font-size: 12.5px;
  margin-bottom: 6px;
}

.track-recent {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 6px;
}

.track-recent-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  opacity: 0.85;
}

.track-recent-run {
  font-family: 'SF Mono', ui-monospace, monospace;
}

.track-recent-option {
  opacity: 0.7;
}

.actions-row {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
</style>
