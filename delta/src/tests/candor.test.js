import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  aiCandor,
  candorId,
  candorLogPath,
  candorShow,
  markCandorRead,
  parseCandorLog,
  parseCandorReadMarks,
  validateCandorAudacity
} from '../candor.js'
import { parseMandatesFile } from '../mandate-change.js'

const MANDATES_TEXT = readFileSync(join(import.meta.dirname, 'fixtures/mandates.yaml'), 'utf8')
const mandatesFile = parseMandatesFile(MANDATES_TEXT) // fable-5: kind: model, thresholds.audacity: medium, escalates_to: olena

const EXCEEDS_BUDGET_RE = /перевищує бюджет зухвалості/
const EXCEEDS_BUDGET_SHORT_RE = /перевищує бюджет/
const NO_MODEL_MANDATE_RE = /не має ШІ-мандата/
const NOW = () => new Date('2026-08-09T10:00:00.000Z')

/**
 * @param {object} [seed] початковий вміст сховища
 * @returns {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>, store: Map<string,string>}}
 *   in-memory fs-double, той самий контракт, що decision-flow.test.js
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

/**
 * @param {object[]} [seedIds] початково прочитані `id`
 * @returns {{read: () => Promise<string|null>, write: (content: string) => Promise<void>}}
 *   in-memory io позначок «прочитано», той самий контракт, що knowledgeIo у decision-flow.test.js
 */
function memoryReadMarksIo(seedIds = []) {
  let text = seedIds.length > 0 ? `${JSON.stringify(seedIds, null, 2)}\n` : null
  return {
    read: () => text,
    write: content => {
      text = content
    }
  }
}

describe('candorLogPath', () => {
  it('.mt/candor/{handle}.jsonl — відділено від .mt/notifications', () => {
    expect(candorLogPath('/root', 'olena')).toBe('/root/.mt/candor/olena.jsonl')
  })
})

describe('validateCandorAudacity — бюджет зухвалості', () => {
  it('audacity_level у межах бюджету моделі — не кидає', () => {
    expect(() => validateCandorAudacity({ mandatesFile, fromModelHandle: 'fable-5', audacityLevel: 'low' })).not.toThrow()
    expect(() => validateCandorAudacity({ mandatesFile, fromModelHandle: 'fable-5', audacityLevel: 'medium' })).not.toThrow()
  })

  it('audacity_level понад бюджет — кидає (medium-мандат не може палити high)', () => {
    expect(() => validateCandorAudacity({ mandatesFile, fromModelHandle: 'fable-5', audacityLevel: 'high' })).toThrow(
      EXCEEDS_BUDGET_RE
    )
  })

  it('модель без мандата — кидає', () => {
    expect(() => validateCandorAudacity({ mandatesFile, fromModelHandle: 'ghost-model', audacityLevel: 'low' })).toThrow(
      NO_MODEL_MANDATE_RE
    )
  })

  it('handle не kind: model (людина) — кидає', () => {
    expect(() => validateCandorAudacity({ mandatesFile, fromModelHandle: 'olena', audacityLevel: 'low' })).toThrow(
      NO_MODEL_MANDATE_RE
    )
  })
})

describe('aiCandor', () => {
  it('валідна заявка — дописує запис у ВІДДІЛЕНИЙ лог адресата', async () => {
    const io = memoryIo()
    const result = await aiCandor({
      io,
      mandatesDir: '/root',
      toHandle: 'olena',
      fromModelHandle: 'fable-5',
      statement: 'Ти три тижні не піднімаєш ціну постачальнику X, хоча дедлайн давно минув.',
      evidenceRefs: ['runs/demo-1/decisions/0001-decision-request.md'],
      audacityLevel: 'medium',
      mandatesFile,
      now: NOW
    })
    expect(result.path).toBe('/root/.mt/candor/olena.jsonl')
    expect(io.store.has('/root/.mt/candor/olena.jsonl')).toBe(true)
    const entries = parseCandorLog(io.store.get('/root/.mt/candor/olena.jsonl'))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ from_model: 'fable-5', audacity_level: 'medium', created_at: '2026-08-09T10:00:00.000Z' })
  })

  it('перевищення бюджету зухвалості — кидає, нічого не пишеться', async () => {
    const io = memoryIo()
    await expect(
      aiCandor({ io, mandatesDir: '/root', toHandle: 'olena', fromModelHandle: 'fable-5', statement: 'x', audacityLevel: 'high', mandatesFile })
    ).rejects.toThrow(EXCEEDS_BUDGET_SHORT_RE)
    expect(io.store.has('/root/.mt/candor/olena.jsonl')).toBe(false)
  })

  it('другий запис дописується, не перезаписує перший', async () => {
    const io = memoryIo()
    await aiCandor({ io, mandatesDir: '/root', toHandle: 'olena', fromModelHandle: 'fable-5', statement: 'перше', audacityLevel: 'low', mandatesFile })
    await aiCandor({ io, mandatesDir: '/root', toHandle: 'olena', fromModelHandle: 'fable-5', statement: 'друге', audacityLevel: 'low', mandatesFile })
    const entries = parseCandorLog(io.store.get('/root/.mt/candor/olena.jsonl'))
    expect(entries).toHaveLength(2)
    expect(entries.map(e => e.statement)).toEqual(['перше', 'друге'])
  })
})

describe('candorShow / markCandorRead — приватна локальна позначка «прочитано»', () => {
  it('candorShow повертає id + read: false без readMarksIo', async () => {
    const io = memoryIo()
    await aiCandor({ io, mandatesDir: '/root', toHandle: 'olena', fromModelHandle: 'fable-5', statement: 'x', audacityLevel: 'low', mandatesFile })
    const inbox = await candorShow({ io, mandatesDir: '/root', handle: 'olena' })
    expect(inbox).toHaveLength(1)
    expect(inbox[0].read).toBe(false)
    expect(inbox[0].id).toBe(candorId(inbox[0]))
  })

  it('markCandorRead — позначка приватна цьому io, інший io її не бачить', async () => {
    const io = memoryIo()
    await aiCandor({ io, mandatesDir: '/root', toHandle: 'olena', fromModelHandle: 'fable-5', statement: 'x', audacityLevel: 'low', mandatesFile })
    const [entry] = await candorShow({ io, mandatesDir: '/root', handle: 'olena' })

    const readMarksIo = memoryReadMarksIo()
    await markCandorRead({ readMarksIo, id: entry.id })
    const afterMark = await candorShow({ io, mandatesDir: '/root', handle: 'olena', readMarksIo })
    expect(afterMark[0].read).toBe(true)

    // Інший (порожній) readMarksIo — той самий запис лишається непрочитаним.
    const otherDeviceMarks = memoryReadMarksIo()
    const otherView = await candorShow({ io, mandatesDir: '/root', handle: 'olena', readMarksIo: otherDeviceMarks })
    expect(otherView[0].read).toBe(false)
  })

  it('parseCandorReadMarks — битий/відсутній файл — порожній набір', () => {
    expect(parseCandorReadMarks(null)).toEqual(new Set())
    expect(parseCandorReadMarks('not json')).toEqual(new Set())
  })

  it('чужий лог (інший toHandle) НЕ бачить моїх записів', async () => {
    const io = memoryIo()
    await aiCandor({ io, mandatesDir: '/root', toHandle: 'olena', fromModelHandle: 'fable-5', statement: 'x', audacityLevel: 'low', mandatesFile })
    const vitaliiInbox = await candorShow({ io, mandatesDir: '/root', handle: 'vitalii' })
    expect(vitaliiInbox).toEqual([])
  })
})
