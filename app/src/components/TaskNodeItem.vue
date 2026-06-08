<template>
  <div>
    <div
      class="row no-wrap items-center q-py-xs rounded-borders task-row cursor-pointer"
      :style="{ paddingLeft: indent + 'px', paddingRight: '8px' }"
      @click.stop="$emit('select', node)"
    >
      <q-btn
        v-if="node.is_composite"
        @click.stop="expanded = !expanded"
        :icon="expanded ? 'sym_o_expand_more' : 'sym_o_chevron_right'"
        flat
        dense
        round
        size="xs"
        class="q-mr-xs"
      />
      <div v-else style="width: 28px" />

      <q-icon :name="cfg.icon" :color="cfg.color" size="16px" class="q-mr-sm" />

      <span
        class="task-id text-body2 q-mr-sm"
        :class="{ 'text-strike text-grey-5': node.state === 'invalidated' }"
      >{{ node.id }}</span>

      <q-badge :color="cfg.color" outline class="q-mr-sm text-caption">{{ cfg.label }}</q-badge>

      <span v-if="node.deps.length" class="text-caption text-grey-6 ellipsis">
        ← {{ node.deps.join(', ') }}
      </span>

      <q-space />

      <span v-if="node.budget_sec" class="text-caption text-grey-5 q-ml-sm">
        {{ node.budget_sec }}s
      </span>
    </div>

    <template v-if="expanded && node.children?.length">
      <TaskNodeItem
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        @select="$emit('select', $event)"
      />
    </template>
  </div>
</template>

<script setup>
const props = defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 },
})

defineEmits(['select'])

const expanded = ref(true)

const STATE = {
  unassigned: { icon: 'sym_o_person_off', color: 'grey-4', label: 'unassigned' },
  human_pending: { icon: 'sym_o_schedule', color: 'amber-8', label: 'human-pending' },
  waiting: { icon: 'sym_o_radio_button_unchecked', color: 'grey-6', label: 'waiting' },
  running: { icon: 'sym_o_radio_button_checked', color: 'primary', label: 'running' },
  pending_audit: { icon: 'sym_o_pending', color: 'deep-purple', label: 'pending-audit' },
  resolved: { icon: 'sym_o_check_circle', color: 'positive', label: 'resolved' },
  failed: { icon: 'sym_o_cancel', color: 'negative', label: 'failed' },
  invalidated: { icon: 'sym_o_block', color: 'grey-5', label: 'invalidated' },
}

const cfg = computed(() => STATE[props.node.state] ?? STATE.waiting)
const indent = computed(() => props.depth * 20 + 8)
</script>

<style scoped>
.task-row:hover {
  background: rgba(0 0 0 / 6%);
}

.task-id {
  font-family: monospace;
  font-weight: 500;
}
</style>
