import { invoke } from '@tauri-apps/api/core'
import { createDispatch } from '@7n/tauri-components'
import { tauriTransport } from '@7n/tauri-components/vue'
import { deriveMandatesView } from '../mandates.js'
import { TOOLS } from './catalog.js'

// In-app вхід у tool-поверхню для прямих (не-агентних) викликів UI:
// обробники подій делегують сюди, а не тримають inline-логіку (інваріант
// n-tool-surface). `mandates_show` — єдиний tool із власною транспортною
// логікою: Rust-команда читає лише сирий текст файлу (fs-in-Rust), деривацію
// робить спільний мок-парсер (src/mandates.js) — той самий код, що й CLI.

/**
 * @param {object} tool визначення тула
 * @param {object} input вхід тула
 * @returns {Promise<unknown>} результат виклику
 */
async function transport(tool, input) {
  if (tool.name === 'mandates_show') {
    const yamlText = await invoke('read_mandates_yaml', { mandatesDir: input.mandatesDir })
    return deriveMandatesView(yamlText, input.handle ?? null)
  }
  return tauriTransport(tool, input)
}

export const dispatch = createDispatch(TOOLS, transport)
