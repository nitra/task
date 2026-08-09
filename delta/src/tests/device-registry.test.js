import { describe, expect, it } from 'vitest'
import {
  emptyDeviceRegistry,
  findByPubkey,
  findRegisteredSigner,
  formatDeviceRegistry,
  parseDeviceRegistry,
  upsertDevice
} from '../device-registry.js'

describe('parseDeviceRegistry', () => {
  it('відсутній/битий/порожній текст — порожній масив, не помилка', () => {
    expect(parseDeviceRegistry(null)).toEqual([])
    expect(parseDeviceRegistry()).toEqual([])
    expect(parseDeviceRegistry('')).toEqual([])
    expect(parseDeviceRegistry('{not json')).toEqual([])
    expect(parseDeviceRegistry('{"not":"an array"}')).toEqual([])
  })

  it('валідний масив round-trip через formatDeviceRegistry', () => {
    const entries = [{ handle: 'olena', role: 'human', pubkeyBase64: 'abc', registeredAt: '2026-08-09T00:00:00.000Z' }]
    expect(parseDeviceRegistry(formatDeviceRegistry(entries))).toEqual(entries)
  })
})

describe('emptyDeviceRegistry', () => {
  it('порожній масив', () => {
    expect(emptyDeviceRegistry()).toEqual([])
  })
})

describe('upsertDevice', () => {
  it('додає новий запис для нового handle', () => {
    const result = upsertDevice(emptyDeviceRegistry(), { handle: 'olena', role: 'human', pubkeyBase64: 'pk1' }, () => new Date('2026-08-09T00:00:00.000Z'))
    expect(result).toEqual([{ handle: 'olena', role: 'human', pubkeyBase64: 'pk1', registeredAt: '2026-08-09T00:00:00.000Z' }])
  })

  it('той самий handle — замінює попередній запис (не дублює)', () => {
    const first = upsertDevice(emptyDeviceRegistry(), { handle: 'olena', role: 'human', pubkeyBase64: 'pk1' }, () => new Date('2026-08-01T00:00:00.000Z'))
    const second = upsertDevice(first, { handle: 'olena', role: 'human', pubkeyBase64: 'pk2' }, () => new Date('2026-08-09T00:00:00.000Z'))
    expect(second).toHaveLength(1)
    expect(second[0].pubkeyBase64).toBe('pk2')
    expect(second[0].registeredAt).toBe('2026-08-09T00:00:00.000Z')
  })

  it('не мутує вхідний масив (pure-функція)', () => {
    const entries = emptyDeviceRegistry()
    upsertDevice(entries, { handle: 'olena', role: 'human', pubkeyBase64: 'pk1' })
    expect(entries).toEqual([])
  })

  it('різні handle співіснують', () => {
    let entries = upsertDevice(emptyDeviceRegistry(), { handle: 'olena', role: 'human', pubkeyBase64: 'pk1' })
    entries = upsertDevice(entries, { handle: 'fable-5', role: 'model', pubkeyBase64: 'pk2' })
    expect(entries.map(e => e.handle)).toEqual(['olena', 'fable-5'])
  })
})

describe('findRegisteredSigner', () => {
  const entries = upsertDevice(emptyDeviceRegistry(), { handle: 'olena', role: 'human', pubkeyBase64: 'pk1' })

  it('handle + pubkey обидва збігаються — знаходить запис', () => {
    expect(findRegisteredSigner(entries, { handle: 'olena', pubkeyBase64: 'pk1' })).toMatchObject({ handle: 'olena', role: 'human' })
  })

  it('handle правильний, pubkey чужий — не знаходить (запобігає підміні ключа)', () => {
    expect(findRegisteredSigner(entries, { handle: 'olena', pubkeyBase64: 'pk-fake' })).toBeNull()
  })

  it('pubkey правильний, handle чужий — не знаходить (запобігає підміні заявленої ролі)', () => {
    expect(findRegisteredSigner(entries, { handle: 'vitalii', pubkeyBase64: 'pk1' })).toBeNull()
  })
})

describe('findByPubkey', () => {
  const entries = upsertDevice(emptyDeviceRegistry(), { handle: 'fable-5', role: 'model', pubkeyBase64: 'pk-model' })

  it('знаходить {handle, role} за самим лише pubkey', () => {
    expect(findByPubkey(entries, 'pk-model')).toEqual({ handle: 'fable-5', role: 'model' })
  })

  it('незареєстрований pubkey — null', () => {
    expect(findByPubkey(entries, 'pk-ghost')).toBeNull()
  })
})
