---
type: JS Module
title: stryker-vue-macros-ignorer.mjs
resource: owner/stryker-vue-macros-ignorer.mjs
docgen:
  crc: 30a5e9f9
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл оголошує Stryker `Ignore`-plugin для Vue `<script setup>`-макросів, щоб `shouldIgnore` відсікав мутації їхніх викликів до того, як Stryker обгортає аргументи в coverage-вираз `stryMutAct_9fa48 ? {} : (stryCov_9fa48, {...})` і ламає `@vue/compiler-sfc` помилкою `defineProps in <script setup> cannot reference locally declared variables`. Плагін експортує `strykerPlugins`, як цього очікує `@stryker-mutator/core/.../plugin-loader.js` через контракт `strykerPlugins: Plugin[]`, а в `stryker.config.mjs` підключається через `plugins: ['./stryker-vue-macros-ignorer.mjs']` і вмикається через `ignorers: ['vue-macros']`.

## Поведінка

- `shouldIgnore` — визначає, чи треба пропустити мутацію для виклику Vue `<script setup>`-макроса; для таких викликів повертає повідомлення про ігнорування, інакше не втручається.
- `strykerPlugins` — оголошує Stryker `Ignore`-plugin з іменем `vue-macros`, щоб цей ignorer можна було підключити через конфігурацію.

## Публічний API

- shouldIgnore — пропускає мутації виклику Vue `<script setup>`-макросів `defineProps`, `defineEmits`, `defineModel`, `defineSlots`, `defineExpose`, `defineOptions`, щоб Stryker не обгортав їхні аргументи в `stryMutAct_9fa48 ? {} : (stryCov_9fa48, {...})` і не ламав compile-sfc помилкою `defineProps in <script setup> cannot reference locally declared variables`
- strykerPlugins — експортує `Plugin[]` для стандартного Stryker plugin-loader (`@stryker-mutator/core/.../plugin-loader.js`) і дає підключити цей ignorer через `plugins: ['./stryker-vue-macros-ignorer.mjs']` та `ignorers: ['vue-macros']`; не пише (ФС/БД)

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
