<template>
  <div class="mandates-map">
    <div class="toolbar">
      <div class="headline">Карта мандатів</div>
      <q-space />
      <q-btn @click="rescan" flat dense round icon="sym_o_refresh" :loading="loading" />
      <q-btn
        @click="onboardingOpen = true"
        flat
        dense
        no-caps
        size="sm"
        icon="sym_o_person"
        :label="identity ?? 'хто ти?'"
        title="Ідентичність — визначає твій зріз карти" />
    </div>

    <OnboardingDialog
      v-model="onboardingOpen"
      @started="afterOnboarding"
      :initial-handle="identity ?? ''"
      :initial-dir="mandatesDir ?? ''" />

    <div v-if="error" class="banner banner-error">{{ error }}</div>

    <EmptyState v-if="!configured || mandates.length === 0" @setup="onboardingOpen = true" :configured="configured" />

    <template v-else>
      <section v-if="identity" class="my-mandate">
        <div class="section-title">Мій мандат — {{ identity }}</div>
        <div v-if="mine.length === 0" class="mine-empty">
          Карта не містить запису для «{{ identity }}» — ти поза деревом мандатів (перевір handle або дочекайся
          акту делегування).
        </div>
        <MandateCard v-for="m in mine" :key="m.owner + m.scope.refs.join(',')" :mandate="m" mine />
        <div v-if="escalationChain.length > 1" class="chain">
          <span class="chain-label">Ланцюг ескалації</span>
          <span v-for="(handle, i) in escalationChain" :key="handle" class="chain-link">
            <q-icon v-if="i > 0" name="sym_o_arrow_forward" size="14px" />
            <span :class="{ 'chain-me': handle === identity }">{{ handle }}</span>
          </span>
        </div>
      </section>

      <section v-if="models.length > 0" class="model-mandates">
        <div class="section-title">ШІ-мандати</div>
        <MandateCard v-for="m in models" :key="m.owner + m.scope.refs.join(',')" :mandate="m" />
      </section>

      <section class="all-mandates">
        <div class="section-title">Уся карта ({{ mandates.length }})</div>
        <MandateCard
          v-for="m in mandates"
          :key="m.owner + m.scope.refs.join(',')"
          :mandate="m"
          :mine="m.owner === identity" />
      </section>
    </template>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useMandates } from '../composables/use-mandates.js'
import { isOnboarded } from '../onboarding.js'
import EmptyState from './EmptyState.vue'
import MandateCard from './MandateCard.vue'
import OnboardingDialog from './OnboardingDialog.vue'
import { ref } from 'vue'

// M0: read-only карта мандатів + зріз «мій мандат» за handle (спека
// docs/specs/260809-delta-app.md, п.4). Дерево з mandates.yaml деривується
// одним tool-викликом (mandates_show), спільним із CLI-паритетом.

const { identity, mandatesDir, mandates, mine, escalationChain, models, loading, error, configured, refreshConfig, rescan } =
  useMandates()

const onboardingOpen = ref(false)

/**
 * Перечитує конфіг і карту після онбордингу (нова ідентичність/шлях).
 * @returns {Promise<void>}
 */
async function afterOnboarding() {
  await refreshConfig()
  await rescan()
}

onMounted(async () => {
  await refreshConfig()
  if (isOnboarded() && mandatesDir.value) await rescan()
  else onboardingOpen.value = true
})
</script>

<style scoped>
.mandates-map {
  max-width: 760px;
  margin: 0 auto;
  padding: 20px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.headline {
  font-size: 15px;
  font-weight: 650;
}

.banner {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.banner-error {
  background: color-mix(in srgb, #ff453a 12%, transparent);
  color: #ff453a;
}

.section-title {
  font-size: 12px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  opacity: 0.65;
  margin-bottom: 8px;
}

.my-mandate,
.model-mandates,
.all-mandates {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mine-empty {
  font-size: 13px;
  opacity: 0.6;
}

.chain {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 12px;
  margin-top: 4px;
  opacity: 0.85;
}

.chain-label {
  font-weight: 650;
  opacity: 0.6;
  margin-right: 4px;
}

.chain-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.chain-me {
  font-weight: 650;
  color: #14b8a6;
}
</style>
