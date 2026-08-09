import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveQueue } from '../decisions.js'
import { buildKillSwitchRedirect, isKillSwitchActive, killSwitchLogPath, killSwitchOff, killSwitchOn, killSwitchPath, killSwitchStatus } from '../kill-switch.js'
import { parseMandatesFile } from '../mandate-change.js'
import { generateDeviceKeypair } from '../signing.js'
import { scanForNotifications } from '../watcher.js'

const MANDATES_TEXT = readFileSync(join(import.meta.dirname, 'fixtures/mandates.yaml'), 'utf8')
const mandatesFile = parseMandatesFile(MANDATES_TEXT) // fable-5: kind: model, escalates_to: olena
const NOW = () => new Date('2026-08-09T10:00:00.000Z')

/**
 * @param {object} [seed] початковий вміст сховища
 * @returns {{store: Map<string,string>, readFile: (path:string) => Promise<string|null>, writeFile: (path:string, content:string) => Promise<void>}} in-memory io
 */
function memoryIo(seed = {}) {
  const store = new Map(Object.entries(seed))
  return {
    store,
    readFile: path => (store.has(path) ? store.get(path) : null),
    writeFile: (path, content) => {
      store.set(path, content)
    }
  }
}

describe('killSwitchPath / killSwitchLogPath', () => {
  it('маркер per-handle, лог спільний на воркспейс', () => {
    expect(killSwitchPath('/root', 'olena')).toBe('/root/.mt/kill-switch/olena.json')
    expect(killSwitchLogPath('/root')).toBe('/root/.mt/kill-switch/log.jsonl')
  })
})

describe('isKillSwitchActive', () => {
  it('відсутній/порожній вміст — неактивний', () => {
    expect(isKillSwitchActive(null)).toBe(false)
    expect(isKillSwitchActive('')).toBe(false)
    expect(isKillSwitchActive(' '.repeat(3))).toBe(false)
  })

  it('битий JSON — неактивний (fail-safe)', () => {
    expect(isKillSwitchActive('not json')).toBe(false)
  })

  it('валідний JSON — активний', () => {
    expect(isKillSwitchActive('{"activated_at":"2026-08-09T10:00:00.000Z"}')).toBe(true)
  })
})

describe('killSwitchOn / killSwitchOff / killSwitchStatus', () => {
  it('on — пише активний маркер + дописує лог (action: on)', async () => {
    const io = memoryIo()
    const deviceKey = await generateDeviceKeypair()
    const result = await killSwitchOn({ io, mandatesDir: '/root', handle: 'olena', deviceKey, now: NOW })
    expect(result.active).toBe(true)
    expect(result.activatedAt).toBe('2026-08-09T10:00:00.000Z')

    const status = await killSwitchStatus(io, '/root', 'olena')
    expect(status.active).toBe(true)

    const log = io.store.get('/root/.mt/kill-switch/log.jsonl')
    const entries = log.trim().split('\n').map(l => JSON.parse(l))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ handle: 'olena', action: 'on' })
  })

  it('off — спорожнює маркер (реверсивність), дописує лог (action: off), НОВИЙ підпис', async () => {
    const io = memoryIo()
    const deviceKey = await generateDeviceKeypair()
    await killSwitchOn({ io, mandatesDir: '/root', handle: 'olena', deviceKey, now: NOW })
    const result = await killSwitchOff({ io, mandatesDir: '/root', handle: 'olena', deviceKey, now: () => new Date('2026-08-09T11:00:00.000Z') })
    expect(result.active).toBe(false)

    const status = await killSwitchStatus(io, '/root', 'olena')
    expect(status.active).toBe(false)

    const log = io.store.get('/root/.mt/kill-switch/log.jsonl')
    const entries = log.trim().split('\n').map(l => JSON.parse(l))
    expect(entries).toHaveLength(2)
    expect(entries[1]).toMatchObject({ handle: 'olena', action: 'off' })
    expect(entries[1].signature).not.toBe(entries[0].signature)
  })

  it('status без жодної активації — неактивний', async () => {
    const io = memoryIo()
    const status = await killSwitchStatus(io, '/root', 'olena')
    expect(status.active).toBe(false)
  })
})

describe('buildKillSwitchRedirect', () => {
  it('олена активна — fable-5 (її модель) перенаправляється на неї', async () => {
    const io = memoryIo()
    const deviceKey = await generateDeviceKeypair()
    await killSwitchOn({ io, mandatesDir: '/root', handle: 'olena', deviceKey, now: NOW })
    const { redirect, activeHandles } = await buildKillSwitchRedirect({ io, mandatesDir: '/root', mandates: mandatesFile.mandates })
    expect(activeHandles).toEqual(new Set(['olena']))
    expect(redirect.get('fable-5')).toBe('olena')
  })

  it('ніхто не активний — порожня карта', async () => {
    const io = memoryIo()
    const { redirect, activeHandles } = await buildKillSwitchRedirect({ io, mandatesDir: '/root', mandates: mandatesFile.mandates })
    expect(redirect.size).toBe(0)
    expect(activeHandles.size).toBe(0)
  })
})

describe('deriveQueue — kill-switch redirect (M6)', () => {
  const decisionRequest = [
    '---',
    'type: decision-request',
    'computed_owner: fable-5',
    'escalation_chain: [fable-5, olena]',
    'leverage_facets: { irreversible: false, blast_radius: node }',
    'decision_type: ops',
    '---',
    '## Контекст',
    'x'
  ].join('\n')
  const decisionsDirs = [{ dir: '/root/runs/demo-1/decisions', files: [{ name: '0001-decision-request.md', content: decisionRequest }] }]

  it('без redirect — картка йде в чергу computed_owner (fable-5), НЕ olena', () => {
    expect(deriveQueue(decisionsDirs, 'fable-5')).toHaveLength(1)
    expect(deriveQueue(decisionsDirs, 'olena')).toHaveLength(0)
  })

  it('з redirect fable-5 → olena — картка йде в чергу olena, зникає з fable-5', () => {
    const redirect = new Map([['fable-5', 'olena']])
    const olenaQueue = deriveQueue(decisionsDirs, 'olena', { killSwitchRedirect: redirect })
    expect(olenaQueue).toHaveLength(1)
    expect(olenaQueue[0].killSwitchRedirected).toBe(true)
    expect(deriveQueue(decisionsDirs, 'fable-5', { killSwitchRedirect: redirect })).toHaveLength(0)
  })
})

describe('scanForNotifications — killSwitchSuppressed (M6)', () => {
  const decisionRequest = [
    '---',
    'type: decision-request',
    'computed_owner: fable-5',
    'escalation_chain: [fable-5, olena]',
    'leverage_facets: { irreversible: false, blast_radius: node }',
    'decision_type: ops',
    'opened_at: "2026-08-01T00:00:00.000Z"',
    '---',
    '## Контекст',
    'x'
  ].join('\n')
  const decisionsDirs = [{ dir: '/root/runs/demo-1/decisions', files: [{ name: '0001-decision-request.md', content: decisionRequest }] }]

  it('без suppressed — SLA-пінг генерується як завжди', () => {
    const notifications = scanForNotifications({ decisionsDirs, now: NOW() })
    expect(notifications.some(n => n.kind === 'sla-ping-executor' && n.to === 'fable-5')).toBe(true)
  })

  it('fable-5 у killSwitchSuppressed — жодної нотифікації по цій розвилці', () => {
    const notifications = scanForNotifications({ decisionsDirs, now: NOW(), killSwitchSuppressed: new Set(['fable-5']) })
    expect(notifications).toEqual([])
  })
})
