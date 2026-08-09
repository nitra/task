<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="delta-header">
      <q-toolbar class="delta-toolbar">
        <span class="brand-dot" />
        <span class="brand-name">delta</span>
      </q-toolbar>
    </q-header>
    <q-page-container>
      <q-page>
        <MandatesMap />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup>
import MandatesMap from './components/MandatesMap.vue'
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
</style>
