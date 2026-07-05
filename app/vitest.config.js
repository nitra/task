import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

export default mergeConfig(
  viteConfig({ command: 'serve', mode: 'test' }),
  defineConfig({
    test: {
      include: ['src/**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
      environment: 'happy-dom',
      globals: false,
      // @7n/tauri-components ships .vue source; inline it so the vue plugin
      // compiles it instead of Node trying to import the raw .vue file.
      server: { deps: { inline: [/@7n\/tauri-components/] } },
      coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
    }
  })
)
