import { describe, expect, it, vi } from 'vitest'

const reads = {}

vi.mock('../tool/index.js', () => ({
  dispatch: vi.fn((name, input) => {
    if (name !== 'read_autonomy') throw new Error(`unexpected tool ${name}`)
    return Promise.resolve({ ok: true, output: reads[input.taskPath] ?? '' })
  })
}))

const { effectivePolicyFor } = await import('../composables/use-autonomy.js')

describe('effectivePolicyFor', () => {
  it('зливає ratchet-ом по ланцюжку предків від кореня до вузла', async () => {
    reads.root = 'deploy: approve\n'
    reads['root/child'] = 'worktree_edit: auto\n'
    reads['root/child/leaf'] = 'deploy: auto\n' // спроба послабити — має бути проігнорована

    const effective = await effectivePolicyFor('/ws/mt', 'root/child/leaf')
    expect(effective).toEqual({ deploy: 'approve', worktree_edit: 'auto' })
  })

  it('без жодного autonomy.yml — порожня ефективна політика', async () => {
    for (const key of Object.keys(reads)) delete reads[key]
    expect(await effectivePolicyFor('/ws/mt', 'a/b')).toEqual({})
  })

  it('пошкоджений файл предка — нейтральний крок, не валить обчислення', async () => {
    for (const key of Object.keys(reads)) delete reads[key]
    reads.a = 'deploy sometimes'
    reads['a/b'] = 'spend: approve\n'

    expect(await effectivePolicyFor('/ws/mt', 'a/b')).toEqual({ spend: 'approve' })
  })
})
