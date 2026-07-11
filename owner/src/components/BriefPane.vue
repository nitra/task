<template>
  <div class="brief">
    <section v-if="delta.length > 0">
      <div class="brief-section">Що змінилось із минулого візиту</div>
      <q-list bordered separator class="brief-list">
        <q-item v-for="row in delta" :key="row.workspace + row.path">
          <q-item-section avatar>
            <q-icon :name="deltaIcon(row.kind)" :color="deltaColor(row.kind)" size="20px" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="brief-node">{{ row.path }}</q-item-label>
            <q-item-label caption>{{ describe(row) }}</q-item-label>
          </q-item-section>
          <q-item-section side class="brief-workspace">{{ shortWorkspace(row.workspace) }}</q-item-section>
        </q-item>
      </q-list>
    </section>
    <section v-else class="brief-empty">Змін із минулого візиту немає.</section>

    <section v-if="personal.length > 0">
      <div class="brief-section">Твої задачі на сьогодні</div>
      <q-list bordered separator class="brief-list">
        <q-item v-for="row in personal" :key="row.workspace.path + row.node.path">
          <q-item-section avatar>
            <q-icon name="sym_o_person" color="warning" size="20px" />
          </q-item-section>
          <q-item-section>
            <q-item-label class="brief-node">{{ row.node.path }}</q-item-label>
            <q-item-label caption>чекає на тебе як виконавця</q-item-label>
          </q-item-section>
          <q-item-section side class="brief-workspace">{{ row.workspace.label }}</q-item-section>
        </q-item>
      </q-list>
    </section>
  </div>
</template>

<script setup>
// Бриф — дельта замість стану: власник читає зміни, машина читає стан.

const KIND_VIEW = {
  escalated: { icon: 'sym_o_priority_high', color: 'negative', text: 'ескалація' },
  resolved: { icon: 'sym_o_check_circle', color: 'positive', text: 'завершено' },
  appeared: { icon: 'sym_o_add_circle', color: 'info', text: 'новий вузол' },
  changed: { icon: 'sym_o_sync_alt', color: 'grey', text: 'зміна стану' },
  gone: { icon: 'sym_o_remove_circle', color: 'grey', text: 'вузол зник' }
}

defineProps({
  delta: { type: Array, required: true },
  personal: { type: Array, required: true }
})

/**
 * Іконка різновиду дельти.
 * @param {string} kind різновид рядка дельти
 * @returns {string} імʼя іконки
 */
function deltaIcon(kind) {
  return KIND_VIEW[kind]?.icon ?? 'sym_o_circle'
}

/**
 * Колір різновиду дельти.
 * @param {string} kind різновид рядка дельти
 * @returns {string} колір Quasar-палітри
 */
function deltaColor(kind) {
  return KIND_VIEW[kind]?.color ?? 'grey'
}

/**
 * Людський опис переходу стану.
 * @param {{ kind: string, from?: string, to?: string }} row рядок дельти
 * @returns {string} підпис рядка
 */
function describe(row) {
  const label = KIND_VIEW[row.kind]?.text ?? row.kind
  if (row.kind === 'gone') return `${label} (був ${row.from})`
  if (row.from) return `${label}: ${row.from} → ${row.to}`
  return `${label}: ${row.to}`
}

/**
 * Коротке імʼя воркспейсу з його шляху.
 * @param {string} workspacePath абсолютний шлях tasks-директорії
 * @returns {string} остання значуща ланка шляху
 */
function shortWorkspace(workspacePath) {
  const parts = workspacePath.split('/').filter(Boolean)
  return parts.at(parts.at(-1) === 'mt' ? -2 : -1) ?? workspacePath
}
</script>

<style scoped>
.brief {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.brief-section {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.6;
  margin-bottom: 8px;
}

.brief-list {
  border-radius: 10px;
}

.brief-node {
  font-family: 'SF Mono', ui-monospace, 'JetBrains Mono', monospace;
  font-size: 13px;
}

.brief-workspace {
  font-size: 12px;
  opacity: 0.55;
}

.brief-empty {
  font-size: 13px;
  opacity: 0.6;
}
</style>
