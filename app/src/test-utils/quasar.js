import { mount } from '@vue/test-utils'
import * as Quasar from 'quasar'

// `bun test` has no @quasar/vite-plugin to auto-import components per file,
// so register every Quasar component (QBtn, QPage, …) globally.
const QUASAR_COMPONENT_RE = /^Q[A-Z]/
const quasarComponents = Object.fromEntries(Object.entries(Quasar).filter(([name]) => QUASAR_COMPONENT_RE.test(name)))

/**
 * @param {object} [userGlobal] caller's `global` mount option
 * @returns {object} `global` option with Quasar plugin + components merged in
 */
function quasarGlobal(userGlobal = {}) {
  return {
    ...userGlobal,
    components: { ...quasarComponents, ...userGlobal.components },
    plugins: [...(userGlobal.plugins || []), [Quasar.Quasar, { config: { dark: false } }]]
  }
}

/**
 * Mount a component with Quasar registered, without any layout wrapper.
 * @param {object} component Vue component (e.g. one that renders its own QLayout)
 * @param {object} [options] mount options (forwarded)
 * @returns {object} test wrapper
 */
export function mountQuasar(component, options = {}) {
  return mount(component, { ...options, global: quasarGlobal(options.global) })
}

/**
 * Mount a page-level component wrapped in QLayout > QPageContainer.
 * @param {object} component Vue component
 * @param {object} [options] mount options (forwarded)
 * @returns {object} test wrapper
 */
export function mountWithQuasar(component, options = {}) {
  const wrapper = {
    render() {
      return h(Quasar.QLayout, { view: 'hHh lpR fFf' }, () => h(Quasar.QPageContainer, () => h(component)))
    }
  }
  return mount(wrapper, { ...options, global: quasarGlobal(options.global) })
}
