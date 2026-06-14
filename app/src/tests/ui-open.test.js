import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mountQuasar } from '../test-utils/quasar.js'

beforeEach(() => {
  const store = {}
  globalThis.localStorage = {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value) },
    removeItem: (key) => { delete store[key] },
  }
})

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve([])) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }))

const { default: TaskGraph } = await import('../components/TaskGraph.vue')

describe('TaskGraph header buttons', () => {
  it('opens the create dialog when + is clicked', async () => {
    const wrapper = mountQuasar(TaskGraph, { attachTo: document.body })
    await flushPromises()
    const createBtn = wrapper.find('button[title="New task"]')
    expect(createBtn.exists()).toBe(true)
    await createBtn.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('Нова задача')
    wrapper.unmount()
  })

  it('opens the agent dialog when the agent button is clicked', async () => {
    const wrapper = mountQuasar(TaskGraph, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('button[title="Agent"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('Agent (local LLM)')
    wrapper.unmount()
  })
})
