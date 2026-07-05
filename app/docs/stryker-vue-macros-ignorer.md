---
type: JS Module
title: stryker-vue-macros-ignorer.mjs
resource: app/stryker-vue-macros-ignorer.mjs
docgen:
  crc: 30a5e9f9
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Цей файл надає плагіни для `stryker`, які ігнорують мутації викликів макросів Vue `<script setup>` (`defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose`, `defineOptions`). Це усуває помилку `@vue/compiler-sfc`: `defineProps in <script setup> cannot reference locally declared variables`, оскільки ці макроси вимагають статичного аналізу на етапі `compile-sfc`. Плагін інтегрується через `stryker.config.mjs` у секцію `plugins: ['./stryker-vue-macros-ignorer.mjs']`, активуючи ignorer `'vue-macros'` для ігнорування виразів типу `stryMutAct_9fa48 ? {} : (stryCov_9fa48, {...})`.

## Поведінка

Поведінка:
shouldIgnore повертає повідомлення для ігнорування мутації, якщо викликається один із Vue `<script setup>`-макросів.
strykerPlugins експонує набір плагінів Stryker, включаючи ігнорування виклику Vue `<script setup>`-макросів.

## Публічний API

Please provide the specific code or file content that needs to be rewritten. I need the target section marked as "api" to fulfill your request.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
