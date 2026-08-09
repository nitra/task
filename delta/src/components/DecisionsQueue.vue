<template>
  <div class="decisions-queue">
    <div class="toolbar">
      <div class="headline">Вирішую</div>
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
        :decision="item"
        :mandates-dir="mandatesDir" />
    </template>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useDecisions } from '../composables/use-decisions.js'
import DecisionCard from './DecisionCard.vue'

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

<style scoped>
.decisions-queue {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 14px;
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

.banner {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.banner-error {
  background: color-mix(in srgb, #ff453a 12%, transparent);
  color: #ff453a;
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
</style>
