<template>
  <div class="decisions-queue">
    <div class="toolbar">
      <div class="headline">Вирішую</div>
      <WhyThisWorks topic="decisions" />
      <q-space />
      <q-btn @click="rescan" flat dense round icon="sym_o_refresh" :loading="loading" />
    </div>

    <div v-if="error" class="banner banner-error">{{ error }}</div>

    <div v-if="!mandatesDir || !identity" class="empty-state">
      <q-icon name="sym_o_fork_right" size="32px" class="empty-icon" />
      <p class="empty-title">Спершу налаштуй ідентичність і шлях до воркспейсу</p>
      <p class="empty-hint">
        Черга «Вирішую» — відкриті decision-request-и, чий <code>computed_owner</code> збігається з твоїм handle
        (вкладка «Карта мандатів» → «хто ти?»).
      </p>
    </div>

    <div v-else-if="queue.length === 0" class="empty-state">
      <q-icon name="sym_o_check_circle" size="32px" class="empty-icon" />
      <p class="empty-title">Черга порожня — немає відкритих розвилок під твоїм мандатом</p>
      <p class="empty-hint">
        Decision-request-и живуть у <code>&lt;mandatesDir&gt;/runs/{run-id}/decisions/NNNN-decision-request.md</code> —
        файловий мок git-refs транспорту (mt: <code>docs/architecture/mandates.md</code>).
      </p>
    </div>

    <template v-else>
      <DecisionCard
        v-for="item in queue"
        :key="`${item.runId}/${item.nnnn}`"
        @approved="onApproved"
        @quorum-signed="rescan"
        :decision="item"
        :mandates-dir="mandatesDir"
        :identity="identity" />
    </template>
  </div>
</template>

<script setup>
import { useDecisions } from '../composables/use-decisions.js'
import DecisionCard from './DecisionCard.vue'
import WhyThisWorks from './WhyThisWorks.vue'

// «Вирішую» (спека docs/specs/260809-delta-app.md, п.2 конституції): черга
// відкритих decision-request-ів мого мандата, з квіз-гейтом one-tap
// (M1 — глибина standard/teach-back лишається M2). Самодостатній компонент —
// той самий патерн, що MandatesMap.vue: читає конфіг (ідентичність/шлях)
// сам, а не приймає пропсами, щоб вкладка лишалась незалежною від інших.

const { identity, mandatesDir, queue, loading, error, refreshConfig, rescan, removeFromQueue } = useDecisions()

/**
 * Прибирає щойно підписану розвилку з черги без повного rescan.
 * @param {{runId: string, nnnn: string}} approvedItem закрита розвилка
 * @returns {void}
 */
function onApproved(approvedItem) {
  removeFromQueue(approvedItem.runId, approvedItem.nnnn)
}

onMounted(async () => {
  await refreshConfig()
  await rescan()
})

defineExpose({ rescan, refreshConfig })
</script>

<style scoped src="../styles/view-toolbar-basic.css"></style>
<style scoped src="../styles/empty-state-lg.css"></style>
<style scoped>
.decisions-queue {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
