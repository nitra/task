<template>
  <div class="live-run-feed">
    <div class="live-run-feed__title">
      <q-spinner size="12px" color="primary" class="q-mr-xs" />
      Running — live run-draft.md
    </div>
    <template v-if="draft.completed || draft.blockers || draft.nextAttempt">
      <div v-if="draft.completed" class="live-run-feed__section">
        <div class="live-run-feed__label">Completed</div>
        <div class="live-run-feed__body">{{ draft.completed }}</div>
      </div>
      <div v-if="draft.blockers" class="live-run-feed__section">
        <div class="live-run-feed__label">Blockers</div>
        <div class="live-run-feed__body">{{ draft.blockers }}</div>
      </div>
      <div v-if="draft.nextAttempt" class="live-run-feed__section">
        <div class="live-run-feed__label">Next Attempt</div>
        <div class="live-run-feed__body">{{ draft.nextAttempt }}</div>
      </div>
    </template>
    <div v-else class="live-run-feed__empty">агент ще не залишив нотаток у run-draft.md</div>
  </div>
</template>

<script setup>
import { invoke } from '@tauri-apps/api/core'
import { parseRunDraft } from '../run-draft.js'

const POLL_MS = 2500

const props = defineProps({
  node: { type: Object, required: true },
  tasksDir: { type: String, required: true }
})

const draft = ref({ completed: null, blockers: null, nextAttempt: null })
let timer = null

/**
 * Fetches and parses the current run-draft.md of the node.
 */
async function poll() {
  try {
    const text = await invoke('read_run_draft', { tasksDir: props.tasksDir, taskPath: props.node.path })
    draft.value = parseRunDraft(text)
  } catch {
    // тимчасова помилка читання — наступний poll спробує знову
  }
}

watch(
  () => [props.node.path, props.tasksDir],
  () => {
    draft.value = { completed: null, blockers: null, nextAttempt: null }
    poll()
  },
  { immediate: true }
)

onMounted(() => {
  timer = setInterval(poll, POLL_MS)
})

onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
.live-run-feed {
  padding: 10px 16px;
  border-bottom: 1px solid rgb(128 128 128 / 15%);
  background: rgb(10 132 255 / 5%);
}

.live-run-feed__title {
  display: flex;
  align-items: center;
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: #0a84ff;
  margin-bottom: 6px;
}

.live-run-feed__section + .live-run-feed__section {
  margin-top: 6px;
}

.live-run-feed__label {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.5;
}

.live-run-feed__body {
  font-size: 12px;
  white-space: pre-wrap;
  line-height: 1.5;
}

.live-run-feed__empty {
  font-size: 12px;
  opacity: 0.4;
}
</style>
