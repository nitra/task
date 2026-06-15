<template>
  <q-btn v-close-popup :label="cancelLabel" flat no-caps />
  <q-btn
    @click="emit('submit')"
    :label="submitLabel"
    :icon="icon"
    :disable="disable"
    :loading="loading"
    color="primary"
    unelevated
    no-caps
  />
</template>

<script setup>
// Shared dialog footer: a close button plus a primary action. Keeps the
// cancel + submit pattern canonical across feature dialogs (see BaseDialog).
defineProps({
  cancelLabel: { type: String, default: 'Скасувати' },
  submitLabel: { type: String, required: true },
  icon: { type: String, default: undefined },
  disable: { type: Boolean, default: false },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['submit'])
</script>
