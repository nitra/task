// Quasar + vitest mount helpers now live in the shared package (Tier 1 dedup).
// Kept as a thin re-export so existing `./test-utils/quasar.js` imports still work.
export { mountQuasar, mountWithQuasar } from '@7n/tauri-components/testing'
