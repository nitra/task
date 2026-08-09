/**
 * Stryker `Ignore`-plugin для Vue `<script setup>`-макросів — спільна
 * реалізація живе в `app/stryker-vue-macros-ignorer.mjs` (там же й повне
 * пояснення), тут лише реекспорт, щоб не дублювати plugin-код між пакетами.
 */
export { strykerPlugins } from '../app/stryker-vue-macros-ignorer.mjs'
