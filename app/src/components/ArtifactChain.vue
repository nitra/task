<template>
  <div class="artifact-chain">
    <template v-for="section in sections" :key="section.key">
      <div class="artifact-chain__section">{{ section.key }}</div>
      <div
        v-for="artifact in section.items"
        :key="artifact.file"
        @click="$emit('select', artifact)"
        class="artifact-chain__item"
        :class="{ 'artifact-chain__item--active': artifact.file === selected }">
        <q-icon :name="artifactConfig(artifact).icon" :style="{ color: artifactConfig(artifact).color }" size="15px" />
        <span class="artifact-chain__label">{{ artifactConfig(artifact).label }}</span>
        <q-space />
        <span v-if="artifact.result" class="artifact-chain__meta">{{ artifact.result }}</span>
        <span v-else-if="artifact.actor" class="artifact-chain__meta">{{ artifact.actor }}</span>
      </div>
    </template>
    <div v-if="!artifacts.length" class="artifact-chain__empty">no artifacts</div>
  </div>
</template>

<script setup>
import { artifactConfig, chainSections } from '../version-chain.js'

const props = defineProps({
  artifacts: { type: Array, required: true },
  selected: { type: String, default: '' }
})

defineEmits(['select'])

const sections = computed(() => chainSections(props.artifacts))
</script>

<style scoped>
.artifact-chain {
  padding: 8px 6px;
  overflow-y: auto;
}

.artifact-chain__section {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  opacity: 0.4;
  padding: 8px 8px 3px;
}

.artifact-chain__item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.12s ease;
}

.artifact-chain__item:hover {
  background: rgb(255 255 255 / 6%);
}

.body--light .artifact-chain__item:hover {
  background: rgb(0 0 0 / 5%);
}

.artifact-chain__item--active {
  background: rgb(10 132 255 / 14%);
}

.artifact-chain__item--active:hover {
  background: rgb(10 132 255 / 18%);
}

.artifact-chain__label {
  font-size: 12px;
  white-space: nowrap;
}

.artifact-chain__meta {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 10px;
  opacity: 0.5;
  white-space: nowrap;
}

.artifact-chain__empty {
  font-size: 12px;
  opacity: 0.35;
  padding: 8px;
}
</style>
