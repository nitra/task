<template>
  <div class="knowledge-view">
    <div class="toolbar">
      <div class="headline">Знання</div>
      <q-space />
      <q-btn @click="rescan" flat dense round icon="sym_o_refresh" :loading="loading" />
    </div>
    <p class="subtitle">
      «Що я зрозумів, підписуючи» — особиста база знань, поза git, бачиш лише ти (докладніше:
      <code>docs/specs/260809-delta-app.md</code>, конституція п.9 «профспілковий режим за замовчуванням»).
    </p>

    <div v-if="error" class="banner banner-error">{{ error }}</div>

    <div v-else-if="entryCount === 0" class="empty-state">
      <q-icon name="sym_o_school" size="32px" class="empty-icon" />
      <p class="empty-title">Ще жодного завершеного квізу</p>
      <p class="empty-hint">
        Кожен підписаний квіз-гейт у «Вирішую» дописує сюди запис: питання, мікроурок, час до розуміння.
      </p>
    </div>

    <template v-else>
      <section class="trend-section">
        <div class="section-label">Час до розуміння — приватний тренд по доменах</div>
        <div class="trend-grid">
          <div v-for="t in trend" :key="t.domain" class="trend-card">
            <div class="trend-domain">{{ t.domain }}</div>
            <div class="trend-value" :class="`trend-${t.trend}`">
              <q-icon v-if="t.trend === 'down'" name="sym_o_trending_down" size="16px" />
              <q-icon v-else-if="t.trend === 'up'" name="sym_o_trending_up" size="16px" />
              <q-icon v-else-if="t.trend === 'flat'" name="sym_o_trending_flat" size="16px" />
              <span v-if="t.averageSec !== null">{{ t.averageSec }}с середнє</span>
              <span v-else>—</span>
            </div>
            <div class="trend-samples">
              {{ t.samples }} {{ t.samples === 1 ? 'запис' : 'записів' }}
              <span v-if="t.trend === 'insufficient-data'">· недостатньо даних для тренду</span>
            </div>
          </div>
        </div>
      </section>

      <section class="digest-section">
        <div class="section-label">Конспект по доменах</div>
        <div v-for="d in digest" :key="d.domain" class="digest-domain">
          <div class="digest-domain-head">
            {{ d.domain }} <span class="digest-count">· {{ d.count }}</span>
          </div>
          <div v-for="item in d.items" :key="`${item.decisionRef}-${item.completedAt}`" class="digest-item">
            <div class="digest-question">{{ item.question }}</div>
            <p class="digest-microlesson">{{ item.microlesson }}</p>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { useKnowledge } from '../composables/use-knowledge.js'

// «Знання» (спека docs/specs/260809-delta-app.md, «Обсяг M2», п.4) —
// конспект по доменах + приватний тренд «час до розуміння», простим
// списком/числами, без чартів (як просить обсяг M2). Самодостатній
// компонент — той самий патерн, що DecisionsQueue.vue: сам читає свій стан.

const { digest, trend, entryCount, loading, error, rescan } = useKnowledge()

onMounted(rescan)

defineExpose({ rescan })
</script>

<!-- jscpd:ignore-start -->
<style scoped src="../styles/view-toolbar.css"></style>
<style scoped src="../styles/empty-state-lg.css"></style>
<!-- jscpd:ignore-end -->
<style scoped>
.knowledge-view {
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

.trend-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}

.trend-card {
  border: 1px solid color-mix(in srgb, currentcolor 10%, transparent);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.trend-domain {
  font-size: 12.5px;
  font-weight: 650;
}

.trend-value {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}

.trend-down {
  color: #14b8a6;
}

.trend-up {
  color: #ff9f0a;
}

.trend-samples {
  font-size: 11px;
  opacity: 0.6;
}

.digest-domain {
  margin-bottom: 14px;
}

.digest-domain-head {
  font-size: 13px;
  font-weight: 650;
  margin-bottom: 6px;
}

.digest-count {
  font-weight: 400;
  opacity: 0.6;
}

.digest-item {
  border-left: 2px solid color-mix(in srgb, currentcolor 12%, transparent);
  padding: 2px 0 8px 10px;
  margin-bottom: 4px;
}

.digest-question {
  font-size: 12.5px;
  font-weight: 600;
}

.digest-microlesson {
  font-size: 12px;
  opacity: 0.75;
  margin: 2px 0 0;
}
</style>
