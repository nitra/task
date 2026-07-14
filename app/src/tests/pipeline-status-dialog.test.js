import { describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises } from '@vue/test-utils'
import { mountQuasar } from '../test-utils/quasar.js'

const RUNS = [
  {
    name: 'validate-input-run',
    provider: 'azure',
    status: 'no_runs',
    conclusion: null,
    updated_at: '',
    url: '',
    run_id: ''
  },
  {
    name: 'Lint Text',
    provider: 'github',
    status: 'completed',
    conclusion: 'failure',
    updated_at: '2026-07-13T17:21:19Z',
    url: 'https://github.com/nitra/task/actions/runs/1',
    run_id: '1'
  },
  {
    name: 'Release Owner',
    provider: 'github',
    status: 'completed',
    conclusion: 'success',
    updated_at: '2026-07-12T16:10:25Z',
    url: 'https://github.com/nitra/task/actions/runs/2',
    run_id: '2'
  },
  {
    name: 'Aardvark Check',
    provider: 'github',
    status: 'completed',
    conclusion: 'success',
    updated_at: '2026-01-01T00:00:00Z',
    url: 'https://github.com/nitra/task/actions/runs/3',
    run_id: '3'
  }
]

const RUN_DETAILS = {
  jobs: [{ name: 'stylelint', conclusion: 'failure', message: 'Missing generic font family' }],
  url: 'https://github.com/nitra/task/actions/runs/1',
  conclusion: 'failure'
}

const invoke = vi.fn(command => {
  if (command === 'list_pipeline_runs') return Promise.resolve(RUNS)
  if (command === 'pipeline_run_details') return Promise.resolve(RUN_DETAILS)
  return Promise.resolve(null)
})
const openUrl = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args) => invoke(...args) }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...args) => openUrl(...args) }))

const { default: PipelineStatusDialog } = await import('../components/PipelineStatusDialog.vue')

// q-dialog teleports its content to a `#q-portal--dialog--N` node appended to
// document.body, outside the mounted wrapper's own element tree — so queries
// against dialog content go through `document.body`, not `wrapper.find*`
// (same reason `ui-open.test.js` asserts on `document.body.textContent`).
const body = () => new DOMWrapper(document.body)

describe('PipelineStatusDialog', () => {
  it('завантажує й показує рани при відкритті, no_runs — завжди в кінці', async () => {
    const wrapper = mountQuasar(PipelineStatusDialog, {
      props: { modelValue: false, tasksDir: '/repo/mt', workspaceLabel: 'demo' },
      attachTo: document.body
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const rows = body()
      .findAll('tbody tr')
      .map(r => r.text())
    expect(rows).toHaveLength(4)
    expect(rows.at(-1)).toContain('validate-input-run')
    wrapper.unmount()
  })

  it('сортує за датою (default) та за алфавітом (toggle)', async () => {
    const wrapper = mountQuasar(PipelineStatusDialog, {
      props: { modelValue: false, tasksDir: '/repo/mt', workspaceLabel: 'demo' },
      attachTo: document.body
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const names = () =>
      body()
        .findAll('.pipelines-table__name')
        .map(n => n.text())
    expect(names()).toEqual(['Lint Text', 'Release Owner', 'Aardvark Check', 'validate-input-run'])

    await body()
      .findAll('button')
      .find(b => b.text() === 'A-Z')
      .trigger('click')
    await flushPromises()
    expect(names()).toEqual(['Aardvark Check', 'Lint Text', 'Release Owner', 'validate-input-run'])
    wrapper.unmount()
  })

  it('клік на failed-ран відкриває деталі, "View log" відкриває посилання', async () => {
    const wrapper = mountQuasar(PipelineStatusDialog, {
      props: { modelValue: false, tasksDir: '/repo/mt', workspaceLabel: 'demo' },
      attachTo: document.body
    })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const failedRow = body()
      .findAll('tbody tr')
      .find(r => r.text().includes('Lint Text'))
    await failedRow.trigger('click')
    await flushPromises()
    expect(invoke).toHaveBeenCalledWith('pipeline_run_details', {
      tasksDir: '/repo/mt',
      runId: '1',
      provider: 'github'
    })
    expect(document.body.textContent).toContain('stylelint')
    expect(document.body.textContent).toContain('Missing generic font family')

    const viewLogBtn = body()
      .findAll('button')
      .find(b => b.text().includes('View log'))
    expect(viewLogBtn).toBeTruthy()
    await viewLogBtn.trigger('click')
    expect(openUrl).toHaveBeenCalledWith('https://github.com/nitra/task/actions/runs/1')
    wrapper.unmount()
  })
})
