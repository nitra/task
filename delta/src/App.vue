<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="delta-header">
      <q-toolbar class="delta-toolbar">
        <span class="brand-dot" />
        <span class="brand-name">delta</span>
        <q-space />
        <q-tabs v-model="tab" dense no-caps class="delta-tabs" indicator-color="primary">
          <q-tab name="mandates" label="Карта мандатів" />
          <q-tab name="decisions" label="Вирішую" />
          <q-tab name="trust" label="Довіряю" />
          <q-tab name="knowledge" label="Знання" />
          <q-tab name="watcher" label="Стежу" />
          <q-tab name="candor" label="Незручна правда" />
          <q-tab name="report" label="Звіт" />
        </q-tabs>
        <q-btn
          @click="onKillSwitch"
          flat
          dense
          no-caps
          size="sm"
          :color="killSwitchActive ? 'negative' : undefined"
          :icon="killSwitchActive ? 'sym_o_power_off' : 'sym_o_power_settings_new'"
          :label="killSwitchActive ? 'kill-switch: активний' : 'kill-switch'"
          class="kill-switch-btn" />
      </q-toolbar>
    </q-header>
    <q-page-container>
      <q-page>
        <q-tab-panels v-model="tab" animated class="delta-panels">
          <q-tab-panel name="mandates" class="delta-panel">
            <MandatesMap />
          </q-tab-panel>
          <q-tab-panel name="decisions" class="delta-panel">
            <DecisionsQueue />
          </q-tab-panel>
          <q-tab-panel name="trust" class="delta-panel">
            <TrustView />
          </q-tab-panel>
          <q-tab-panel name="knowledge" class="delta-panel">
            <KnowledgeView />
          </q-tab-panel>
          <q-tab-panel name="watcher" class="delta-panel">
            <WatcherView />
          </q-tab-panel>
          <q-tab-panel name="candor" class="delta-panel">
            <CandorView />
          </q-tab-panel>
          <q-tab-panel name="report" class="delta-panel">
            <ReportView />
          </q-tab-panel>
        </q-tab-panels>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { useUpdater } from '@7n/tauri-components/vue'
import CandorView from './components/CandorView.vue'
import DecisionsQueue from './components/DecisionsQueue.vue'
import KnowledgeView from './components/KnowledgeView.vue'
import MandatesMap from './components/MandatesMap.vue'
import ReportView from './components/ReportView.vue'
import TrustView from './components/TrustView.vue'
import WatcherView from './components/WatcherView.vue'
import { dispatch } from './tool/index.js'

useUpdater()

// Сім площин конституції (docs/specs/260809-delta-app.md, п.1): «Карта
// мандатів» (M0, read-only, + M4 директорія display-імен), «Вирішую» (M1,
// черга + квіз-гейт, + M4 мультипартійний кворум для irreversible), «Довіряю»
// (M3 — мої ШІ-мандати: трек-рекорд, audacity, звузити/розширити), «Знання»
// (M2 — особиста база знань: конспект по доменах + приватний тренд «час до
// розуміння»), «Стежу» (M4 — watcher-нотифікації, тиха година, профспілковий
// режим «що про мене знає система», + M6 секція «Дрейф»), «Незручна правда»
// (M5, UI-догон M6), «Звіт» (M6 — дельта-звіт, метрики пілота).
const tab = ref('mandates')

// Kill-switch (M6, docs/specs/260809-delta-app.md, «Обсяг M6», п.3,
// конституція п.10): ПАНІЧНА кнопка — навмисно БЕЗ підтверджувального квізу
// чи діалогу (задокументоване рішення: мить, коли треба забрати все собі,
// НЕ мить для роздумів над формулюваннями квізу). Помітна в шапці — завжди
// видима, незалежно від активної вкладки.
const killSwitchActive = ref(false)
const identity = ref(null)
const mandatesDir = ref(null)

/**
 * Перечитує стан kill-switch мого handle з бекенду.
 * @returns {Promise<void>}
 */
async function refreshKillSwitch() {
  const [identityRes, dirRes] = await Promise.all([dispatch('whoami'), dispatch('mandates_dir')])
  identity.value = identityRes.ok ? (identityRes.output ?? null) : null
  mandatesDir.value = dirRes.ok ? (dirRes.output ?? null) : null
  if (!identity.value || !mandatesDir.value) return
  const res = await dispatch('kill_switch_status', { mandatesDir: mandatesDir.value, handle: identity.value })
  killSwitchActive.value = res.ok ? res.output.active : false
}

/**
 * Перемикає kill-switch — миттєво, без квізу/діалогу (панічна кнопка).
 * @returns {Promise<void>}
 */
async function onKillSwitch() {
  if (!identity.value || !mandatesDir.value) return
  const tool = killSwitchActive.value ? 'kill_switch_off' : 'kill_switch_on'
  const res = await dispatch(tool, { mandatesDir: mandatesDir.value, handle: identity.value })
  if (res.ok) killSwitchActive.value = res.output.active
}

onMounted(refreshKillSwitch)
</script>

<style scoped>
.delta-header {
  background: #161618;
  color: inherit;
  border-bottom: 1px solid rgb(255 255 255 / 8%);
}

.body--light .delta-header {
  background: #fafafa;
  border-bottom-color: rgb(0 0 0 / 8%);
}

.delta-toolbar {
  min-height: 44px;
  padding-left: 16px;
}

.brand-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #14b8a6;
  box-shadow: 0 0 8px rgb(20 184 166 / 60%);
  margin-right: 9px;
}

.brand-name {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.delta-tabs {
  min-height: 44px;
}

.delta-panels {
  background: transparent;
}

.delta-panel {
  padding: 0;
}

.kill-switch-btn {
  margin-left: 8px;
}
</style>
