<template>
  <div class="mandate-card" :class="{ mine, model: mandate.kind === 'model' }">
    <div class="row-top">
      <q-icon :name="mandate.kind === 'model' ? 'sym_o_smart_toy' : 'sym_o_person'" size="18px" />
      <span class="owner">{{ displayName ?? mandate.owner }}</span>
      <span v-if="displayName && displayName !== mandate.owner" class="owner-handle">({{ mandate.owner }})</span>
      <q-badge v-if="mandate.kind === 'model'" color="secondary" label="модель" class="kind-badge" />
      <q-badge v-if="mine" color="primary" label="мій мандат" class="mine-badge" />
      <q-space />
      <span v-if="isRoot" class="root-tag">корінь</span>
    </div>

    <div v-if="mandate.scope.refs.length > 0 || mandate.scope.decisionTypes.length > 0" class="scope-row">
      <q-chip v-for="ref in mandate.scope.refs" :key="ref" dense square size="sm" class="chip chip-ref">{{ ref }}</q-chip>
      <q-chip v-for="dt in mandate.scope.decisionTypes" :key="dt" dense square size="sm" class="chip chip-dt">
{{
        dt
      }}
</q-chip>
    </div>

    <div v-if="thresholdChips.length > 0" class="threshold-row">
      <q-chip v-for="t in thresholdChips" :key="t" dense square size="sm" class="chip chip-threshold">{{ t }}</q-chip>
    </div>

    <div class="escalates-row">
      <q-icon name="sym_o_arrow_upward" size="13px" />
      <span v-if="mandate.escalatesTo">ескалює до {{ mandate.escalatesTo }}</span>
      <span v-else class="root-note">кореневий мандат — ескалювати нікуди</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  mandate: { type: Object, required: true },
  mine: { type: Boolean, default: false },
  // Display-імʼя з `.mt/directory.json` (М4, PII поза git) — `null`/
  // збігається з `mandate.owner` показує лише handle (фолбек «на handle»).
  displayName: { type: String, default: null }
})

const isRoot = computed(() => props.mandate.escalatesTo === null)

const thresholdChips = computed(() => {
  const t = props.mandate.thresholds
  const chips = []
  if (t.budgetEur !== null) chips.push(`бюджет ${t.budgetEur} €`)
  if (t.risk !== null) chips.push(`ризик: ${t.risk}`)
  if (t.irreversible !== null) chips.push(t.irreversible ? 'незворотне' : 'зворотне')
  if (t.audacity !== null) chips.push(`зухвалість: ${t.audacity}`)
  return chips
})
</script>

<style scoped>
.mandate-card {
  border: 1px solid color-mix(in srgb, currentcolor 10%, transparent);
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mandate-card.mine {
  border-color: #14b8a6;
  background: color-mix(in srgb, #14b8a6 6%, transparent);
}

.mandate-card.model {
  border-style: dashed;
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

.owner-handle {
  font-size: 11px;
  opacity: 0.55;
  font-family: 'SF Mono', ui-monospace, monospace;
}

.kind-badge,
.mine-badge {
  font-size: 10px;
}

.root-tag {
  font-size: 11px;
  opacity: 0.55;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.scope-row,
.threshold-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  font-size: 11px;
}

.chip-ref {
  font-family: 'SF Mono', ui-monospace, monospace;
}

.escalates-row {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  opacity: 0.7;
}

.root-note {
  opacity: 0.8;
}
</style>
