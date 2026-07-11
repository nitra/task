import { getConfig } from '@nitra/eslint-config'

export default [
  {
    ignores: [
      '**/auto-imports.d.ts',
      '**/reports/stryker/**',
      '.claude/worktrees/**',
      'app/src-tauri/**',
      'app/dist/**',
      'owner/src-tauri/**',
      'owner/dist/**',
      'docs/**'
    ]
  },
  ...getConfig({
    vue: ['app', 'owner']
  })
]
