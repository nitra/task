<template>
  <q-dialog
    @update:model-value="value => emit('update:modelValue', value)"
    v-bind="$attrs"
    :model-value="modelValue"
  >
    <q-card class="base-dialog" :style="{ width: `${width}px` }">
      <q-card-section class="row items-center no-wrap q-pb-sm">
        <q-icon v-if="icon" :name="icon" size="20px" class="q-mr-sm" />
        <span class="base-dialog__title">{{ title }}</span>
        <q-space />
        <slot name="header" />
        <q-btn v-close-popup icon="sym_o_close" flat round dense size="sm" />
      </q-card-section>

      <q-separator />

      <q-card-section :class="bodyClass">
        <slot />
      </q-card-section>

      <q-separator />

      <q-card-actions align="right" class="q-pa-md">
        <slot name="actions" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script setup>
// Shared shell for app dialogs (header icon+title+close, body slot, actions
// slot). Keeps the Quasar dialog boilerplate in one place so feature dialogs
// (create task, agent, …) carry only their own content. `$attrs` forwards
// listeners like @show to the underlying q-dialog.
defineOptions({ inheritAttrs: false })

defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, required: true },
  icon: { type: String, default: '' },
  width: { type: Number, default: 520 },
  bodyClass: { type: String, default: 'q-gutter-md' },
})
const emit = defineEmits(['update:modelValue'])
</script>

<style scoped>
.base-dialog {
  max-width: 92vw;
}

.base-dialog__title {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 15px;
  font-weight: 600;
}
</style>
