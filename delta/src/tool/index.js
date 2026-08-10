/**
 * GUI tool-dispatch поверхня для Tauri: збирає TOOL-обробники і прокидує їх у спільний transport без зміни поведінки викликів.
 */
import { createDispatch } from '@7n/tauri-components'
import { tauriTransport } from '@7n/tauri-components/vue'
import { TOOLS } from './catalog.js'

// Фаза B міграції завершена (docs/specs/260809-delta-app.md): УСІ tools —
// і фаза A (мандати/decisions/квіз-гейт/кворум/mandate-change/довіра), і
// фаза B (knowledge/directory/watcher/what-system-knows/staff/candor/
// drift/delegation/report/kill-switch/review) — мають пряму Tauri-команду
// в `delta-core` (`delta/src-tauri/src/phase_a.rs`/`phase_b.rs`, той самий
// crate, що CLI `delta-cli`). `tool/index.js` більше НЕ тримає inline
// JS-логіку — кожен tool падає на generic `tauriTransport(tool, input)`
// (`catalog.js`: поле `tauri` кожного tool-у), що просто викликає
// `invoke(tool.tauri, input)`. `src/*.js` (JS-шар бізнес-логіки) і
// `bin/delta.mjs`/`bin/delta-watcher.mjs` видалено — уся логіка тепер у
// Rust, спільна для GUI й CLI (n-tool-surface).

/**
 * Експортує dispatch для GUI tool-поверхні на базі TOOLS і generic
 * Tauri-транспорту.
 */
export const dispatch = createDispatch(TOOLS, tauriTransport)
