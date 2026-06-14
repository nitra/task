<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="app-header">
      <q-toolbar class="app-toolbar">
        <span class="brand-dot" />
        <span class="brand-name">task</span>
      </q-toolbar>
    </q-header>
    <q-page-container>
      <q-page class="app-page">
        <TaskGraph />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup>
import TaskGraph from './components/TaskGraph.vue'
</script>

<style scoped>
.app-header {
  background: #161618;
  color: inherit;
  border-bottom: 1px solid rgb(255 255 255 / 8%);
}

.body--light .app-header {
  background: #fafafa;
  border-bottom-color: rgb(0 0 0 / 8%);
}

.app-toolbar {
  min-height: 44px;
  padding-left: 16px;
}

.brand-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #0a84ff;
  box-shadow: 0 0 8px rgb(10 132 255 / 60%);
  margin-right: 9px;
}

.brand-name {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
