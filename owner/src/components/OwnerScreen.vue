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
        @click="runSemantic(workspaces, forest, scopes)"
        flat
        dense
        round
        icon="sym_o_psychology_alt"
        title="Семантичний прогін критика (LLM)"
        :loading="criticRunning" />
      <q-btn-toggle v-model="manualMode" clearable dense flat toggle-color="primary" :options="modeOptions" />
      <q-btn @click="rescan" flat dense round icon="sym_o_refresh" :loading="loading" />
      <q-btn
        @click="onboardingOpen = true"
        flat
        dense
        no-caps
        size="sm"
        icon="sym_o_person"
        :label="identity ?? 'хто ти?'"
        title="Ідентичність власника — визначає твій скоуп (онбординг)" />
      <q-btn @click="onboardingOpen = true" flat dense round icon="sym_o_help" title="Що це і як налаштувати" />
    </div>

    <PlannerDialog v-model="plannerOpen" @drafted="rescan" />
    <OnboardingDialog v-model="onboardingOpen" @started="startAfterOnboarding" />

    <button v-if="mode === 'decisions' && ribbon" @click="manualMode = 'brief'" type="button" class="reminder-ribbon">
      <q-icon name="sym_o_alarm" size="14px" :color="ribbon.overdue > 0 ? 'negative' : 'warning'" />
      {{ ribbon.headline }}
    </button>

    <div v-if="mode === 'decisions'" class="pane">
      <DecisionCard
        v-for="decision in decisions"
        :key="decision.workspace.path + decision.node.path"
        @acted="rescan"
        :decision="decision"
        :escalate-to="addresseeFor(decision)" />
      <CriticCard
        v-for="verdict in criticVerdicts"
        :key="verdict.workspace.path + verdict.path + verdict.rule + verdict.finding"
        @dismiss="dismiss(verdict)"
        :verdict="verdict" />
      <div v-if="decisions.length === 0 && criticVerdicts.length === 0" class="pane-empty">Черга рішень порожня.</div>
    </div>
    <BriefPane
      v-else-if="mode === 'brief'"
      @snooze="snooze"
      class="pane"
      :delta="delta"
      :personal="personal"
      :delegations="delegations"
      :escalated-out="escalatedOut"
      :reminders="reminders" />
    <MapPane v-else @setup="onboardingOpen = true" class="pane" :workspaces="workspaces" :forest="forest" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useCritic } from '../composables/use-critic.js'
import { useForest } from '../composables/use-forest.js'
import { collectDecisions, collectDelegations, collectEscalatedOut, collectPersonal } from '../decisions.js'
import { notifyRescan } from '../notifications.js'
import { applySnoozes, deriveReminders, nextMidnight, reminderRibbon } from '../reminders.js'
import { escalationAddressee } from '../scope.js'
import { chooseMode } from '../screen-mode.js'
import { isOnboarded } from '../onboarding.js'
import { dispatch } from '../tool/index.js'
import BriefPane from './BriefPane.vue'
import CriticCard from './CriticCard.vue'
import DecisionCard from './DecisionCard.vue'
import MapPane from './MapPane.vue'
import OnboardingDialog from './OnboardingDialog.vue'
import PlannerDialog from './PlannerDialog.vue'

// Адаптивний перший екран: режим обирає детерміноване правило (screen-mode.js),
// заголовок оголошує причину, ручний перемикач — вихід із адаптивності.
// Детермінований критик оновлюється з кожним rescan; семантичний — кнопкою.

const { workspaces, forest, delta, loading, scopes, identity, owners, escalations, snoozes, rescan, watchForest } =
  useForest()
const { verdicts: criticVerdicts, running: criticRunning, refreshDeterministic, runSemantic, dismiss } = useCritic()

watch(forest, value => {
  refreshDeterministic(workspaces.value, value, scopes.value)
  // ОС-нотифікації (M7) — раз на rescan, з детермінованих подій черги/дедлайнів.
  notifyRescan({ decisions: decisions.value, reminders: reminders.value })
})

const MODE_TITLES = {
  decisions: 'Черга рішень',
  brief: 'Бриф: зміни і твої задачі',
  map: 'Карта портфеля'
}

const manualMode = ref(null)
const plannerOpen = ref(false)
const onboardingOpen = ref(false)

const decisions = computed(() =>
  collectDecisions(workspaces.value, forest.value, scopes.value, {
    escalations: escalations.value,
    me: identity.value
  })
)
const personal = computed(() => collectPersonal(workspaces.value, forest.value, scopes.value))
const delegations = computed(() => collectDelegations(workspaces.value, forest.value, scopes.value, owners.value))
const escalatedOut = computed(() =>
  collectEscalatedOut(workspaces.value, forest.value, escalations.value, identity.value)
)

/**
 * Замовник вузла рішення — адресат можливої ескалації (null — нікому).
 * @param {{ workspace: { path: string }, node: { path: string } }} decision рішення черги
 * @returns {string|null} handle замовника
 */
function addresseeFor(decision) {
  return escalationAddressee(owners.value[decision.workspace.path] ?? {}, identity.value, decision.node.path)
}

// Нагадування (M7): деривація перераховується з кожним rescan лісу;
// snooze глушить лише в мене — deadline у git не змінюється.
const reminders = computed(() =>
  applySnoozes(
    deriveReminders({
      workspaces: workspaces.value,
      forest: forest.value,
      scopes: scopes.value,
      escalations: escalations.value,
      me: identity.value,
      now: Date.now()
    }),
    snoozes.value,
    Date.now()
  )
)
const ribbon = computed(() => reminderRibbon(reminders.value))

/**
 * Глушить нагадування до наступної півночі й перечитує snooze-стан.
 * @param {string} id стабільний id нагадування
 * @returns {Promise<void>}
 */
async function snooze(id) {
  const done = await dispatch('snooze_reminder', { id, until: nextMidnight(Date.now()) })
  if (!done.ok) {
    console.error('snooze failed', done.error.message)
    return
  }
  const silenced = await dispatch('snoozes')
  if (silenced.ok) snoozes.value = silenced.output ?? {}
}

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

/* Тонка стрічка нагадувань (M7): інформує, не перериває — режим не змінює. */
.reminder-ribbon {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin-bottom: 12px;
  padding: 6px 10px;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, currentcolor 6%, transparent);
  color: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.reminder-ribbon:hover {
  background: color-mix(in srgb, currentcolor 10%, transparent);
}
</style>
