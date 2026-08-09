<template>
  <div class="empty-state">
    <q-icon name="sym_o_account_tree" size="32px" class="empty-icon" />
    <p v-if="!configured" class="empty-title">Шлях до карти мандатів ще не налаштовано</p>
    <p v-else class="empty-title">У «.mt/mandates.yaml» немає жодного мандата</p>
    <p class="empty-hint">
      Формат — декларативний файл-репо, аналог CODEOWNERS для рішень (mt:
      <code>docs/architecture/mandates.md</code>):
    </p>
    <pre class="empty-example">mandates:
  - owner: olena
    scope:
      refs: ["refs/mt/tasks/design/**"]
      decision_types: [architecture, ux]
    thresholds: { budget_eur: 2000, risk: medium, irreversible: false }
    escalates_to: vitalii
  - owner: vitalii
    scope: { refs: ["refs/mt/**"], decision_types: ["*"] }
    thresholds: {}
    escalates_to: null</pre>
    <q-btn @click="emit('setup')" unelevated color="primary" no-caps label="налаштувати" />
  </div>
</template>

<script setup>
defineProps({
  configured: { type: Boolean, required: true }
})
const emit = defineEmits(['setup'])
</script>

<style scoped>
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

.empty-example {
  text-align: left;
  font-size: 11.5px;
  font-family: 'SF Mono', ui-monospace, monospace;
  background: color-mix(in srgb, currentcolor 6%, transparent);
  border-radius: 8px;
  padding: 10px 12px;
  max-width: 480px;
  overflow-x: auto;
}
</style>
