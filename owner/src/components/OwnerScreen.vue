<template>
  <div class="owner-screen">
    <div class="mode-bar">
      <div class="mode-headline">
        {{ headline }}
        <span v-if="manualMode" class="mode-manual">(режим обрано вручну)</span>
      </div>
      <q-space />
      <q-btn @click="plannerOpen = true" unelevated dense color="primary" icon="sym_o_neurology" label="нова ціль" />
      <q-btn
        @click="runSemantic(workspaces, forest)"
        flat
        dense
        round
        icon="sym_o_psychology_alt"
        title="Семантичний прогін критика (LLM)"
        :loading="criticRunning" />
      <q-btn-toggle v-model="manualMode" clearable dense flat toggle-color="primary" :options="modeOptions" />
      <q-btn @click="rescan" flat dense round icon="sym_o_refresh" :loading="loading" />
      <q-btn @click="onboardingOpen = true" flat dense round icon="sym_o_help" title="Що це і як налаштувати" />
    </div>

    <PlannerDialog v-model="plannerOpen" @drafted="rescan" />
    <OnboardingDialog v-model="onboardingOpen" @started="startAfterOnboarding" />

    <div v-if="mode === 'decisions'" class="pane">
      <DecisionCard
        v-for="decision in decisions"
        :key="decision.workspace.path + decision.node.path"
        @acted="rescan"
        :decision="decision" />
      <CriticCard
        v-for="verdict in criticVerdicts"
        :key="verdict.workspace.path + verdict.path + verdict.rule + verdict.finding"
        @dismiss="dismiss(verdict)"
        :verdict="verdict" />
      <div v-if="decisions.length === 0 && criticVerdicts.length === 0" class="pane-empty">Черга рішень порожня.</div>
    </div>
    <BriefPane v-else-if="mode === 'brief'" class="pane" :delta="delta" :personal="personal" />
    <MapPane v-else @setup="onboardingOpen = true" class="pane" :workspaces="workspaces" :forest="forest" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useCritic } from '../composables/use-critic.js'
import { useForest } from '../composables/use-forest.js'
import { collectDecisions, collectPersonal } from '../decisions.js'
import { chooseMode } from '../screen-mode.js'
import { isOnboarded } from '../onboarding.js'
import BriefPane from './BriefPane.vue'
import CriticCard from './CriticCard.vue'
import DecisionCard from './DecisionCard.vue'
import MapPane from './MapPane.vue'
import OnboardingDialog from './OnboardingDialog.vue'
import PlannerDialog from './PlannerDialog.vue'

// Адаптивний перший екран: режим обирає детерміноване правило (screen-mode.js),
// заголовок оголошує причину, ручний перемикач — вихід із адаптивності.
// Детермінований критик оновлюється з кожним rescan; семантичний — кнопкою.

const { workspaces, forest, delta, loading, rescan, watchForest } = useForest()
const { verdicts: criticVerdicts, running: criticRunning, refreshDeterministic, runSemantic, dismiss } = useCritic()

watch(forest, value => refreshDeterministic(workspaces.value, value))

const MODE_TITLES = {
  decisions: 'Черга рішень',
  brief: 'Бриф: зміни і твої задачі',
  map: 'Карта портфеля'
}

const manualMode = ref(null)
const plannerOpen = ref(false)
const onboardingOpen = ref(false)

const decisions = computed(() => collectDecisions(workspaces.value, forest.value))
const personal = computed(() => collectPersonal(workspaces.value, forest.value))

const auto = computed(() =>
  chooseMode({ decisionCount: decisions.value.length + criticVerdicts.value.length, deltaCount: delta.value.length })
)
const mode = computed(() => manualMode.value ?? auto.value.mode)
const headline = computed(() => (manualMode.value ? MODE_TITLES[manualMode.value] : auto.value.headline))

const modeOptions = [
  { value: 'decisions', icon: 'sym_o_approval', title: MODE_TITLES.decisions },
  { value: 'brief', icon: 'sym_o_summarize', title: MODE_TITLES.brief },
  { value: 'map', icon: 'sym_o_map', title: MODE_TITLES.map }
]

/**
 * Скан + live-нагляд лісу — після онбордингу чи одразу на старті.
 * @returns {Promise<void>}
 */
async function startAfterOnboarding() {
  await rescan()
  await watchForest()
}

onMounted(async () => {
  // Перший запуск: спершу онбординг (пояснення + project paths), скан — після
  // «почати»; інакше — одразу скан.
  if (isOnboarded()) await startAfterOnboarding()
  else onboardingOpen.value = true
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
