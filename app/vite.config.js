// @ts-nocheck
import { execSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { quasar, transformAssetUrls } from '@quasar/vite-plugin'
import Vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import Layouts from 'vite-plugin-vue-layouts-next'
import VueMacros from 'vue-macros/vite'

const host = process.env.TAURI_DEV_HOST
const quasarVariables = fileURLToPath(new URL('src/quasar-variables.sass', import.meta.url))
// git worktrees have their own .git, so Vite's workspace-root search stops there
// and never reaches the main repo's node_modules — allow it explicitly
const monorepoRoot = dirname(
  execSync('git rev-parse --git-common-dir', { cwd: import.meta.dirname })
    .toString()
    .trim()
)

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
    },
    fs: {
      allow: [searchForWorkspaceRoot(import.meta.dirname), monorepoRoot]
    }
  }
}))
