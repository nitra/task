<template>
  <div class="owner-screen">
    <div class="mode-bar">
      <div class="mode-headline">
        {{ headline }}
        <span v-if="manualMode" class="mode-manual">(режим обрано вручну)</span>
      </div>
      <q-space />
      <q-btn-toggle v-model="manualMode" clearable dense flat toggle-color="primary" :options="modeOptions" />
      <q-btn @click="rescan" flat dense round icon="sym_o_refresh" :loading="loading" />
    </div>

    <div v-if="mode === 'decisions'" class="pane">
      <DecisionCard
        v-for="decision in decisions"
        :key="decision.workspace.path + decision.node.path"
        @acted="rescan"
        :decision="decision" />
      <div v-if="decisions.length === 0" class="pane-empty">Черга рішень порожня.</div>
    </div>
    <BriefPane v-else-if="mode === 'brief'" class="pane" :delta="delta" :personal="personal" />
    <MapPane v-else class="pane" :workspaces="workspaces" :forest="forest" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useForest } from '../composables/use-forest.js'
import { collectDecisions, collectPersonal } from '../decisions.js'
import { chooseMode } from '../screen-mode.js'
import BriefPane from './BriefPane.vue'
import DecisionCard from './DecisionCard.vue'
import MapPane from './MapPane.vue'

// Адаптивний перший екран: режим обирає детерміноване правило (screen-mode.js),
// заголовок оголошує причину, ручний перемикач — вихід із адаптивності.

const { workspaces, forest, delta, loading, rescan, watchForest } = useForest()

const MODE_TITLES = {
  decisions: 'Черга рішень',
  brief: 'Бриф: зміни і твої задачі',
  map: 'Карта портфеля'
}

const manualMode = ref(null)

const decisions = computed(() => collectDecisions(workspaces.value, forest.value))
const personal = computed(() => collectPersonal(workspaces.value, forest.value))

const auto = computed(() => chooseMode({ decisionCount: decisions.value.length, deltaCount: delta.value.length }))
const mode = computed(() => manualMode.value ?? auto.value.mode)
const headline = computed(() => (manualMode.value ? MODE_TITLES[manualMode.value] : auto.value.headline))

const modeOptions = [
  { value: 'decisions', icon: 'sym_o_approval', title: MODE_TITLES.decisions },
  { value: 'brief', icon: 'sym_o_summarize', title: MODE_TITLES.brief },
  { value: 'map', icon: 'sym_o_map', title: MODE_TITLES.map }
]

onMounted(async () => {
  await rescan()
  await watchForest()
})
</script>

<style scoped>
.owner-screen {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px 16px 40px;
}

.mode-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.mode-headline {
  font-size: 15px;
  font-weight: 650;
}

.mode-manual {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.55;
  margin-left: 6px;
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pane-empty {
  font-size: 13px;
  opacity: 0.6;
}
</style>
