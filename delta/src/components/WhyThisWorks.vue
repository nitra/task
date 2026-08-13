<template>
  <span class="why-this-works">
    <q-btn
      @click="open = !open"
      flat
      dense
      round
      size="sm"
      :icon="open ? 'sym_o_info' : 'sym_o_info'"
      :color="open ? 'primary' : undefined"
      class="why-toggle"
      :aria-label="`чому так — ${entry.title}`"
      :title="'чому так'" />
    <div v-if="open" class="why-panel">
      <div class="why-title">{{ entry.title }}</div>
      <p class="why-body">{{ entry.body }}</p>
      <div class="why-source">{{ entry.source }}</div>
    </div>
  </span>
</template>

<script setup>
// Конституційний п.11 («Референс = виконуваний підручник») — розгортний
// блок «чому так», однаковий на кожному екрані/картці: іконка ⓘ перемикає
// коротке пояснення механіки з посиланням на нормативне джерело. Текст —
// у `../content/why.js` (проп `topic` — ключ у ньому), цей компонент лише
// рендерить і перемикає видимість — нуль бізнес-логіки.
import { WHY_CONTENT } from '../content/why.js'

const props = defineProps({
  // Ключ у WHY_CONTENT — напр. `'mandatesMap'`, `'quiz'`, `'killSwitch'`.
  topic: { type: String, required: true }
})

const open = ref(false)

const entry = computed(
  () => WHY_CONTENT[props.topic] ?? { title: 'Чому так', body: 'Опис для цього екрана ще не написано.', source: '' }
)
</script>

<style scoped>
.why-this-works {
  display: inline-flex;
  position: relative;
}

.why-toggle {
  opacity: 0.6;
}

.why-toggle:hover {
  opacity: 1;
}

.why-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  width: min(360px, 80vw);
  background: var(--q-dark-page, #1c1c1e);
  border: 1px solid color-mix(in srgb, currentcolor 14%, transparent);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.body--light .why-panel {
  background: #fff;
}

.why-title {
  font-size: 12.5px;
  font-weight: 650;
}

.why-body {
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  opacity: 0.9;
}

.why-source {
  font-size: 10.5px;
  opacity: 0.55;
  font-family: 'SF Mono', ui-monospace, monospace;
}
</style>
