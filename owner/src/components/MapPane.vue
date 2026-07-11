<template>
  <div class="map">
    <q-card v-for="workspace in workspaces" :key="workspace.path" flat bordered class="map-card">
      <q-card-section class="map-head">
        <span class="map-label">{{ workspace.label }}</span>
        <span class="map-path">{{ workspace.path }}</span>
      </q-card-section>
      <q-card-section class="map-chips">
        <q-chip
          v-for="(count, state) in stateCounts(workspace)"
          :key="state"
          dense
          square
          class="map-chip"
          :label="`${state} ${count}`" />
        <span v-if="Object.keys(stateCounts(workspace)).length === 0" class="map-empty">порожній граф</span>
      </q-card-section>
    </q-card>
    <div v-if="workspaces.length === 0" class="map-empty">Воркспейсів не знайдено — перевір project paths.</div>
  </div>
</template>

<script setup>
// Карта портфеля — фонове ситуаційне чуття: ліс воркспейсів зі зведенням
// станів. Свідомо read-only: дії живуть у черзі рішень, не на карті.

const props = defineProps({
  workspaces: { type: Array, required: true },
  forest: { type: Object, required: true }
})

/**
 * Зведення станів вузлів воркспейсу (рекурсивно по дереву).
 * @param {{ path: string }} workspace воркспейс лісу
 * @returns {Record<string, number>} кількість вузлів за станом
 */
function stateCounts(workspace) {
  const counts = {}
  const visit = nodes => {
    for (const node of nodes ?? []) {
      counts[node.state] = (counts[node.state] ?? 0) + 1
      visit(node.children)
    }
  }
  visit(props.forest[workspace.path])
  return counts
}
</script>

<style scoped>
.map {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.map-card {
  border-radius: 10px;
}

.map-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding-bottom: 0;
}

.map-label {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 600;
}

.map-path {
  font-size: 11px;
  opacity: 0.45;
}

.map-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 8px;
}

.map-chip {
  font-family: 'SF Mono', ui-monospace, monospace;
  font-size: 11px;
}

.map-empty {
  font-size: 12px;
  opacity: 0.55;
}
</style>
