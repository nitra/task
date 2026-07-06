<template>
  <q-dialog v-model="open" transition-show="fade" transition-hide="fade">
    <q-card class="dag-card">
      <q-card-section class="row items-center no-wrap q-pb-sm">
        <q-icon name="sym_o_account_tree" size="20px" class="q-mr-sm" />
        <span class="dag-title">Dependency graph — {{ workspaceLabel }}</span>
        <q-space />
        <q-btn v-close-popup icon="sym_o_close" flat round dense size="sm" />
      </q-card-section>

      <q-separator />

      <q-card-section class="q-pa-md scroll dag-body">
        <div v-if="!layout.nodes.length" class="dag-empty">жодного вузла в цьому воркспейсі</div>
        <svg v-else :viewBox="`-20 -20 ${layout.width + 40} ${layout.height + 40}`" class="dag-svg">
          <defs>
            <marker id="dag-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" class="dag-arrowhead" />
            </marker>
          </defs>
          <path v-for="(edge, i) in edgePaths" :key="i" :d="edge.d" class="dag-edge" marker-end="url(#dag-arrow)" />
          <g
            v-for="node in layout.nodes"
            :key="node.path"
            @click="$emit('select', node.path)"
            class="dag-node"
            :transform="`translate(${node.x}, ${node.y})`">
            <rect
              width="160"
              height="36"
              rx="8"
              class="dag-node__box"
              :style="{ '--c': stateConfig(node.state).color }" />
            <text x="10" y="22" class="dag-node__label">{{ node.id }}</text>
          </g>
        </svg>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { computeDagLayout } from '../dag-layout.js'
import { stateConfig } from '../state-config.js'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  nodes: { type: Array, required: true },
  workspaceLabel: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue', 'select'])

const open = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v)
})

const layout = computed(() => computeDagLayout(props.nodes))

const nodeByPath = computed(() => Object.fromEntries(layout.value.nodes.map(n => [n.path, n])))

// Пряма лінія правий-край-джерела → лівий-край-цілі (посередині боксу вертикально).
const edgePaths = computed(() =>
  layout.value.edges
    .map(edge => {
      const from = nodeByPath.value[edge.from]
      const to = nodeByPath.value[edge.to]
      if (!from || !to) return null
      const x1 = from.x + 160
      const y1 = from.y + 18
      const x2 = to.x
      const y2 = to.y + 18
      const midX = (x1 + x2) / 2
      return { d: `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}` }
    })
    .filter(Boolean)
)
</script>

<style scoped>
.dag-card {
  width: 820px;
  max-width: 94vw;
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
}

.dag-title {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 600;
}

.dag-body {
  flex: 1;
  overflow: auto;
}

.dag-empty {
  text-align: center;
  padding: 32px 0;
  font-size: 13px;
  opacity: 0.4;
}

.dag-svg {
  width: 100%;
  min-height: 240px;
}

.dag-edge {
  fill: none;
  stroke: currentcolor;
  opacity: 0.35;
  stroke-width: 1.5;
}

.dag-arrowhead {
  fill: currentcolor;
  opacity: 0.5;
}

.dag-node {
  cursor: pointer;
}

.dag-node__box {
  fill: color-mix(in srgb, var(--c) 16%, transparent);
  stroke: var(--c);
  stroke-width: 1.5;
}

.dag-node__label {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 11px;
  fill: currentcolor;
}
</style>
