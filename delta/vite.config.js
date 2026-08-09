// @ts-nocheck
import { fileURLToPath } from 'node:url'
import { quasar, transformAssetUrls } from '@quasar/vite-plugin'
import Vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import { defineConfig } from 'vite'
import Layouts from 'vite-plugin-vue-layouts-next'
import VueMacros from 'vue-macros/vite'

const host = process.env.TAURI_DEV_HOST
const quasarVariables = fileURLToPath(new URL('src/quasar-variables.sass', import.meta.url))

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    AutoImport({
      imports: ['vue']
    }),
    VueMacros({
      plugins: {
        vue: Vue({ template: { transformAssetUrls } })
      }
    }),
    Layouts(),
    quasar({
      sassVariables: quasarVariables
    })
  ],

  clearScreen: false,
  server: {
    // Окремий порт від app (1420) і owner (1430), щоб усі три dev-сервери жили поруч.
    port: 1440,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1441
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  }
}))
