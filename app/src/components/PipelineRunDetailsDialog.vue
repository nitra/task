<template>
  <BaseDialog
    v-model="open"
    :title="run?.name ?? ''"
    icon="sym_o_fact_check"
    :width="480"
    body-class="q-pa-md scroll run-details-body"
    transition-show="fade"
    transition-hide="fade">
    <div v-if="loading" class="text-center q-pa-xl">
      <q-spinner size="40px" color="primary" />
    </div>
    <div v-else-if="errorMessage" class="text-red">{{ errorMessage }}</div>
    <template v-else-if="details">
      <div class="run-details-conclusion row items-center q-mb-md">
        <q-icon
          :name="pipelineStateConfig(null, details.conclusion).icon"
          :style="{ color: pipelineStateConfig(null, details.conclusion).color }"
          size="18px"
          class="q-mr-sm" />
        {{ pipelineStateConfig(null, details.conclusion).label }}
      </div>
      <div v-if="details.jobs.length" class="run-details-jobs">
        <div v-for="job in details.jobs" :key="job.name" class="run-details-job-block">
          <div class="run-details-job row items-center">
            <q-icon
              :name="pipelineStateConfig(null, job.conclusion).icon"
              :style="{ color: pipelineStateConfig(null, job.conclusion).color }"
              size="15px"
              class="q-mr-sm" />
            {{ job.name }}
          </div>
          <pre v-if="job.message" class="run-details-message">{{ job.message }}</pre>
        </div>
      </div>
      <div v-else class="run-details-empty">
        per-job breakdown недоступний для цього провайдера — див. деталі за посиланням
      </div>
      <q-btn
        v-if="details.url"
        @click="openUrl(details.url)"
        label="View log"
        icon="sym_o_open_in_new"
        flat
        dense
        size="sm"
        class="q-mt-md" />
    </template>
  </BaseDialog>
</template>

<script setup>
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { BaseDialog } from '@7n/tauri-components/components'
import { pipelineStateConfig } from '../pipeline-state-config.js'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  tasksDir: { type: String, required: true },
  run: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue'])

const open = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})

const details = ref(null)
const loading = ref(false)
const errorMessage = ref(null)

watch(open, async isOpen => {
  if (!isOpen || !props.run) return
  loading.value = true
  errorMessage.value = null
  details.value = null
  try {
    details.value = await invoke('pipeline_run_details', {
      tasksDir: props.tasksDir,
      runId: props.run.run_id,
      provider: props.run.provider
    })
  } catch (error) {
    errorMessage.value = String(error)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
:deep(.run-details-body) {
  max-height: 60vh;
  overflow-y: auto;
}

.run-details-conclusion {
  font-size: 13px;
  font-weight: 600;
}

.run-details-job {
  font-size: 12px;
  padding: 4px 0;
}

.run-details-message {
  margin: 0 0 8px 20px;
  padding: 8px 10px;
  border-radius: 6px;
  background: color-mix(in srgb, currentcolor 6%, transparent);
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  max-height: 240px;
  overflow-y: auto;
}

.run-details-empty {
  text-align: center;
  padding: 16px 0;
  font-size: 12px;
  opacity: 0.4;
}
</style>
