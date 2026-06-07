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
      imports: ['vue', 'vue-router']
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
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  }
}))
