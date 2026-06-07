import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.js'

export default mergeConfig(
  viteConfig({ command: 'serve', mode: 'test' }),
  defineConfig({
    test: {
      include: ['src/**/*.test.{js,mjs}', 'tests/**/*.test.{js,mjs}'],
      environment: 'happy-dom',
      globals: false,
      coverage: { provider: 'v8', reporter: ['lcov', 'text-summary'] }
    }
  })
)
