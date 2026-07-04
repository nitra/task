<template>
  <div>
    <div @click.stop="$emit('select', node)" class="task-row" :style="{ paddingLeft: indent + 'px' }">
      <q-btn
        v-if="node.is_composite"
        @click.stop="expanded = !expanded"
        :icon="expanded ? 'sym_o_expand_more' : 'sym_o_chevron_right'"
        flat
        dense
        round
        size="xs"
        class="task-row__toggle" />
      <span v-else class="task-row__toggle-spacer" />

      <q-icon :name="cfg.icon" :style="{ color: cfg.color }" size="16px" class="task-row__icon" />

      <span class="task-row__id" :class="{ 'task-row__id--struck': node.state === 'unresolvable' }">{{ node.id }}</span>

      <span class="state-pill" :style="{ '--c': cfg.color }">
        <span class="state-pill__dot" />
        {{ cfg.label }}
      </span>

      <span v-if="node.claim?.runner_id" class="task-row__runner" :title="node.claim.lease_until">
        {{ node.claim.runner_id }}
      </span>

      <span v-if="node.deps.length" class="task-row__deps"> ← {{ node.deps.join(', ') }} </span>

      <q-space />

      <span v-if="node.budget_sec" class="task-row__budget"> {{ node.budget_sec }}s </span>
    </div>

    <template v-if="expanded && node.children?.length">
      <TaskNodeItem
        v-for="child in node.children"
        :key="child.id"
        @select="$emit('select', $event)"
        :node="child"
        :depth="depth + 1" />
    </template>
  </div>
</template>

<script setup>
import { stateConfig } from '../state-config.js'

const props = defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 }
})

defineEmits(['select'])

const expanded = ref(true)

const cfg = computed(() => stateConfig(props.node.state))
const indent = computed(() => props.depth * 20 + 8)
</script>

<style scoped>
.task-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
  padding-top: 5px;
  padding-bottom: 5px;
  padding-right: 10px;
  border-radius: 7px;
  cursor: pointer;
  transition: background 0.12s ease;
}

.task-row:hover {
  background: rgb(255 255 255 / 6%);
}

.body--light .task-row:hover {
  background: rgb(0 0 0 / 5%);
}

.task-row__toggle {
  margin-right: -2px;
}

.task-row__toggle-spacer {
  width: 24px;
  flex: 0 0 auto;
}

.task-row__icon {
  flex: 0 0 auto;
}

.task-row__id {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 13px;
  font-weight: 500;
}

.task-row__id--struck {
  text-decoration: line-through;
  opacity: 0.45;
}

.task-row__runner {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 10px;
  opacity: 0.55;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgb(10 132 255 / 12%);
  white-space: nowrap;
  flex: 0 0 auto;
}

.task-row__deps {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  opacity: 0.45;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-row__budget {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  opacity: 0.4;
  flex: 0 0 auto;
}

/* — state pill: shared visual language with the summary chips — */
.state-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 7px;
  border-radius: 6px;
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  flex: 0 0 auto;
  color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--c) 28%, transparent);
}

.state-pill__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c);
}
</style>
