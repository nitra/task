<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated>
      <q-toolbar>
        <q-toolbar-title>task</q-toolbar-title>
      </q-toolbar>
    </q-header>
    <q-page-container>
      <q-page>
        <TaskGraph />
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<script setup>
import TaskGraph from './components/TaskGraph.vue'
</script>
