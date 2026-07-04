import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: ['app/vitest.config.js']
  }
})
