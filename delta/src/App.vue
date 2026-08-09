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
          <q-tab-panel name="trust" class="delta-panel">
            <TrustView />
          </q-tab-panel>
          <q-tab-panel name="knowledge" class="delta-panel">
            <KnowledgeView />
          </q-tab-panel>
        </q-tab-panels>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup>
import { ref } from 'vue'
import DecisionsQueue from './components/DecisionsQueue.vue'
import KnowledgeView from './components/KnowledgeView.vue'
import MandatesMap from './components/MandatesMap.vue'
import TrustView from './components/TrustView.vue'

// Три площини конституції (docs/specs/260809-delta-app.md, п.1): «Карта
// мандатів» (M0, read-only), «Вирішую» (M1, черга + квіз-гейт), «Довіряю»
// (M3 — мої ШІ-мандати: трек-рекорд, audacity, звузити/розширити), «Знання»
// (M2 — особиста база знань: конспект по доменах + приватний тренд «час до
// розуміння»). «Стежу» лишається M4.
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
