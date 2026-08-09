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
        </q-tabs>
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
        </q-tab-panels>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { ref } from 'vue'
import DecisionsQueue from './components/DecisionsQueue.vue'
import MandatesMap from './components/MandatesMap.vue'

// Три площини конституції (docs/specs/260809-delta-app.md, п.1) — M0/M1
// реалізують «Довіряю»/«Стежу» пізніше (M3/M4); наразі дві вкладки:
// «Карта мандатів» (M0, read-only) і «Вирішую» (M1, черга + квіз-гейт).
const tab = ref('mandates')
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
</style>
