<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="owner-header">
      <q-toolbar class="owner-toolbar">
        <span class="brand-dot" />
        <span class="brand-name">owner</span>
      </q-toolbar>
    </q-header>
    <q-page-container>
      <q-page>
        <OwnerScreen />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup>
import OwnerScreen from './components/OwnerScreen.vue'
</script>

<style scoped>
.owner-header {
  background: #161618;
  color: inherit;
  border-bottom: 1px solid rgb(255 255 255 / 8%);
}

.body--light .owner-header {
  background: #fafafa;
  border-bottom-color: rgb(0 0 0 / 8%);
}

.owner-toolbar {
  min-height: 44px;
  padding-left: 16px;
}

.brand-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #bf5af2;
  box-shadow: 0 0 8px rgb(191 90 242 / 60%);
  margin-right: 9px;
}

.brand-name {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
