<template>
  <q-card flat bordered class="critic-card">
    <q-card-section class="critic-head">
      <q-icon name="sym_o_psychology_alt" :color="stakeColor" size="20px" />
      <span class="critic-node">{{ verdict.path }}</span>
      <q-badge outline :color="stakeColor" :label="verdict.rule" />
      <span class="critic-workspace">{{ verdict.workspace.label }}</span>
    </q-card-section>
    <q-card-section class="critic-finding">
      {{ verdict.finding }}
    </q-card-section>
    <q-card-actions align="right">
      <q-btn @click="emit('dismiss')" flat dense icon="sym_o_close" label="відхилити заперечення" />
    </q-card-actions>
  </q-card>
</template>

<script setup>
import { computed } from 'vue'

// Вердикт критика у черзі рішень: власник мусить явно відхилити заперечення
// (анти-rubber-stamping) — або піти чинити знахідку у відповідному вузлі.

const props = defineProps({
  verdict: { type: Object, required: true }
})
const emit = defineEmits(['dismiss'])

// Колір за ставкою вердикту: 0–1 критично, 2 попередження, далі — інфо.
const STAKE_COLORS = ['negative', 'negative', 'warning']
const stakeColor = computed(() => STAKE_COLORS[props.verdict.stake] ?? 'info')
</script>

<style scoped>
.critic-card {
  border-radius: 10px;
  border-left: 3px solid #bf5af2;
}

.critic-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 0;
}

.critic-node {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 600;
}

.critic-workspace {
  font-size: 12px;
  opacity: 0.55;
  margin-left: auto;
}

.critic-finding {
  padding-top: 6px;
  font-size: 13px;
  opacity: 0.85;
}
</style>
