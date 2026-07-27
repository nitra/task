import { describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mountQuasar } from '../test-utils/quasar.js'

const PULL_REQUESTS = [
  {
    number: 10,
    repository: 'nitra/task',
    title: 'Fix failed workflow',
    url: 'https://github.com/nitra/task/pull/10',
    updated_at: '2026-07-27T10:00:00Z',
    is_draft: false,
    role: 'author',
    category: 'needs_my_action',
    action: 'Перевірте та виправте провалені CI checks',
    reviewers: [],
    failed_checks: ['lint'],
    merge_state: 'CLEAN'
  },
  {
    number: 11,
    repository: 'nitra/rules',
    title: 'Review requested',
    url: 'https://github.com/nitra/rules/pull/11',
    updated_at: '2026-07-27T09:00:00Z',
    is_draft: false,
    role: 'reviewer',
    category: 'needs_my_review',
    action: 'Потрібен ваш review',
    reviewers: [],
    failed_checks: [],
    merge_state: 'CLEAN'
  }
]

const invoke = vi.fn(() => Promise.resolve(PULL_REQUESTS))
const openUrl = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args) => invoke(...args) }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...args) => openUrl(...args) }))

const { default: PullRequestsDialog } = await import('../components/PullRequestsDialog.vue')
const body = () => new DOMWrapper(document.body)

describe('PullRequestsDialog', () => {
  it('показує авторські дії за замовчуванням і фільтрує review', async () => {
    const wrapper = mountQuasar(PullRequestsDialog, { props: { modelValue: false }, attachTo: document.body })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith('list_pull_requests')
    expect(document.body.textContent).toContain('Fix failed workflow')
    expect(document.body.textContent).not.toContain('Review requested')

    const reviewFilter = body()
      .findAll('button')
      .find(button => button.text() === 'My review')
    await reviewFilter.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('Review requested')
    expect(document.body.textContent).not.toContain('Fix failed workflow')
    wrapper.unmount()
  })

  it('відкриває PR у браузері', async () => {
    const wrapper = mountQuasar(PullRequestsDialog, { props: { modelValue: false }, attachTo: document.body })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    await body().find('.pr-row').trigger('click')
    expect(openUrl).toHaveBeenCalledWith('https://github.com/nitra/task/pull/10')
    wrapper.unmount()
  })

  it('передає локальний gh-контекст у агента та показує його резюме', async () => {
    const agent = {
      loadEnv: vi.fn(() => Promise.resolve()),
      request: vi.fn((_prompt, { onChunk }) => {
        onChunk({ text: 'Поточний стан: виправити CI.' })
        return Promise.resolve({ status: 'done', summary: 'Поточний стан: виправити CI.' })
      })
    }
    invoke.mockImplementation(command => {
      if (command === 'pull_request_context') return Promise.resolve({ title: 'Fix failed workflow', files: [] })
      return Promise.resolve(PULL_REQUESTS)
    })
    const wrapper = mountQuasar(PullRequestsDialog, {
      props: { modelValue: false, agent },
      attachTo: document.body
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const summaryButton = body()
      .findAll('button')
      .find(button => button.text() === 'LLM summary')
    await summaryButton.trigger('click')
    await flushPromises()

    expect(invoke).toHaveBeenCalledWith('pull_request_context', { repository: 'nitra/task', number: 10 })
    expect(agent.loadEnv).toHaveBeenCalledOnce()
    expect(agent.request).toHaveBeenCalledOnce()
    expect(document.body.textContent).toContain('Поточний стан: виправити CI.')
    wrapper.unmount()
  })
})
