import { createDispatch } from '@7n/tauri-components'
import { tauriTransport } from '@7n/tauri-components/vue'
import { TOOLS } from './catalog.js'

// In-app вхід у tool-поверхню для прямих (не-агентних) викликів UI: обробники
// подій делегують сюди, а не тримають inline-логіку (інваріант n-tool-surface).

export const dispatch = createDispatch(TOOLS, tauriTransport)
