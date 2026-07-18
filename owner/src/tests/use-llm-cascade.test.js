import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const reads = {}

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args) => invoke(...args) }))
vi.mock('../tool/index.js', () => ({
  dispatch: (name, input) => {
    if (name !== 'read_autonomy') throw new Error(`unexpected tool ${name}`)
    return Promise.resolve({ ok: true, output: reads[input.taskPath] ?? '' })
  }
}))

const { useLlmCascade } = await import('../composables/use-llm-cascade.js')

beforeEach(() => {
  invoke.mockReset()
  for (const key of Object.keys(reads)) delete reads[key]
})

describe('useLlmCascade.oneShot', () => {
  it('без tasksDir — одразу local/cloud тир крейта, без спроби ACP', async () => {
    invoke.mockResolvedValueOnce('відповідь local')
    const { oneShot } = useLlmCascade()

    const reply = await oneShot({ system: 'sys', user: 'ask' })

    expect(reply).toBe('відповідь local')
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(
      'llm_one_shot',
      expect.objectContaining({ tier: 'max', system: 'sys', user: 'ask' })
    )
  })

  it('autonomy дозволяє external_comms:auto на вузлі — пробує ACP (cursor) першим', async () => {
    reads.goal = 'external_comms: auto\n'
    invoke.mockResolvedValueOnce('відповідь cursor')
    const { oneShot } = useLlmCascade()

    const reply = await oneShot({ system: 'sys', user: 'ask', tasksDir: '/ws/mt', taskPath: 'goal' })

    expect(reply).toBe('відповідь cursor')
    expect(invoke).toHaveBeenCalledWith('llm_one_shot_acp', { agent: 'cursor', prompt: 'sys\n\nask', cwd: '/ws/mt' })
  })

  it('cursor падає — падає далі на codex, потім на local/cloud', async () => {
    reads.goal = 'external_comms: auto\n'
    invoke
      .mockRejectedValueOnce(new Error('cursor не залогінений'))
      .mockRejectedValueOnce(new Error('codex not initialized'))
      .mockResolvedValueOnce('відповідь local')
    const { oneShot } = useLlmCascade()

    const reply = await oneShot({ user: 'ask', tasksDir: '/ws/mt', taskPath: 'goal' })

    expect(reply).toBe('відповідь local')
    expect(invoke).toHaveBeenNthCalledWith(1, 'llm_one_shot_acp', { agent: 'cursor', prompt: 'ask', cwd: '/ws/mt' })
    expect(invoke).toHaveBeenNthCalledWith(2, 'llm_one_shot_acp', { agent: 'codex', prompt: 'ask', cwd: '/ws/mt' })
    expect(invoke).toHaveBeenNthCalledWith(3, 'llm_one_shot', expect.objectContaining({ user: 'ask' }))
  })

  it('без autonomy.yml на вузлі — fail-closed (approve), ACP пропускається', async () => {
    invoke.mockResolvedValueOnce('відповідь local')
    const { oneShot } = useLlmCascade()

    await oneShot({ user: 'ask', tasksDir: '/ws/mt', taskPath: 'goal' })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('llm_one_shot', expect.objectContaining({ user: 'ask' }))
  })

  it('вузол явно ставить external_comms:approve — ACP пропускається', async () => {
    reads.goal = 'external_comms: approve\n'
    invoke.mockResolvedValueOnce('відповідь local')
    const { oneShot } = useLlmCascade()

    await oneShot({ user: 'ask', tasksDir: '/ws/mt', taskPath: 'goal' })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('llm_one_shot', expect.objectContaining({ user: 'ask' }))
  })
})
