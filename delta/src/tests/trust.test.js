import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDeviceRegistry } from '../device-registry.js'
import { parseMandatesFile } from '../mandate-change.js'
import {
  AUDACITY_DESCRIPTIONS,
  audacityOf,
  deriveTrustView,
  isAtNarrowFloor,
  isAtWidenCeiling,
  narrowMandateOneStep,
  widenMandateOneStep,
  withMandateReplaced
} from '../trust.js'

const FIXTURES_ROOT = join(import.meta.dirname, 'fixtures')
const MANDATES_YAML = readFileSync(join(FIXTURES_ROOT, 'mandates.yaml'), 'utf8')
const DEVICE_REGISTRY = parseDeviceRegistry(readFileSync(join(FIXTURES_ROOT, 'device-registry.json'), 'utf8'))
const MANDATES_FILE = parseMandatesFile(MANDATES_YAML)

/**
 * @param {string} runId ім'я run-директорії
 * @returns {{dir: string, files: {name: string, content: string}[]}} скановані файли одного run-у
 */
function loadRunDir(runId) {
  const dir = join(FIXTURES_ROOT, 'runs', runId, 'decisions')
  const names = ['0001-decision-request.md', '0001-approval.json', '0002-decision-request.md', '0002-approval.json']
  const files = []
  for (const name of names) {
    try {
      files.push({ name, content: readFileSync(join(dir, name), 'utf8') })
    } catch {
      // не всі run-и мають 0002
    }
  }
  return { dir, files }
}

describe('deriveTrustView', () => {
  it('olena бачить fable-5 (escalates_to: olena) з трек-рекордом', () => {
    const view = deriveTrustView({
      mandatesFile: MANDATES_FILE,
      deviceRegistry: DEVICE_REGISTRY,
      decisionsDirs: [loadRunDir('demo-3'), loadRunDir('demo-4')],
      handle: 'olena'
    })
    expect(view.items).toHaveLength(1)
    expect(view.items[0].mandate.owner).toBe('fable-5')
    expect(view.items[0].audacity).toBe('medium')
    expect(view.items[0].audacityDescription).toBe(AUDACITY_DESCRIPTIONS.medium)
    expect(view.items[0].trackRecord.totalDecisions).toBe(2)
  })

  it('vitalii не має ШІ-мандатів під собою у фікстурі — порожній список', () => {
    const view = deriveTrustView({
      mandatesFile: MANDATES_FILE,
      deviceRegistry: DEVICE_REGISTRY,
      decisionsDirs: [],
      handle: 'vitalii'
    })
    expect(view.items).toEqual([])
  })

  it('без handle — порожній список, не помилка', () => {
    const view = deriveTrustView({
      mandatesFile: MANDATES_FILE,
      deviceRegistry: DEVICE_REGISTRY,
      decisionsDirs: [],
      handle: null
    })
    expect(view.items).toEqual([])
  })
})

describe('audacityOf', () => {
  it('дефолт low, коли не задано', () => {
    expect(audacityOf({ thresholds: { audacity: null } })).toBe('low')
  })

  it('явне значення', () => {
    expect(audacityOf({ thresholds: { audacity: 'high' } })).toBe('high')
  })
})

describe('withMandateReplaced', () => {
  it('замінює лише вказаного owner, generation + 1', () => {
    const updated = withMandateReplaced(MANDATES_FILE, 'fable-5', m => ({
      ...m,
      thresholds: { ...m.thresholds, audacity: 'high' }
    }))
    expect(updated.generation).toBe(MANDATES_FILE.generation + 1)
    expect(updated.mandates.find(m => m.owner === 'fable-5').thresholds.audacity).toBe('high')
    expect(updated.mandates.find(m => m.owner === 'olena')).toEqual(
      MANDATES_FILE.mandates.find(m => m.owner === 'olena')
    )
  })
})

describe('withMandateReplaced — не мутує вхідний файл', () => {
  it('окремий тест на immutability вхідного mandate', () => {
    const fableBefore = MANDATES_FILE.mandates.find(m => m.owner === 'fable-5')
    withMandateReplaced(MANDATES_FILE, 'fable-5', m => ({ ...m, thresholds: { ...m.thresholds, audacity: 'high' } }))
    expect(fableBefore.thresholds.audacity).toBe('medium')
  })
})

describe('narrowMandateOneStep / widenMandateOneStep — MVP-скоуп однієї осі', () => {
  const fable = MANDATES_FILE.mandates.find(m => m.owner === 'fable-5') // audacity: medium

  it('widen піднімає audacity на щабель', () => {
    expect(widenMandateOneStep(fable).thresholds.audacity).toBe('high')
  })

  it('narrow опускає audacity на щабель', () => {
    expect(narrowMandateOneStep(fable).thresholds.audacity).toBe('low')
  })

  it('на стелі audacity (high) — widen фолбекає на budget_eur', () => {
    const atCeiling = { ...fable, thresholds: { ...fable.thresholds, audacity: 'high' } }
    const widened = widenMandateOneStep(atCeiling)
    expect(widened.thresholds.audacity).toBe('high')
    expect(widened.thresholds.budgetEur).toBeGreaterThan(atCeiling.thresholds.budgetEur)
  })

  it('на дні audacity (low) — narrow фолбекає на budget_eur (÷2)', () => {
    const atFloor = { ...fable, thresholds: { ...fable.thresholds, audacity: 'low' } }
    const narrowed = narrowMandateOneStep(atFloor)
    expect(narrowed.thresholds.audacity).toBe('low')
    expect(narrowed.thresholds.budgetEur).toBe(Math.round(atFloor.thresholds.budgetEur / 2))
  })

  it('person-мандат — audacity вісь не застосовна, одразу фолбек на budget_eur', () => {
    const person = MANDATES_FILE.mandates.find(m => m.owner === 'olena')
    const widened = widenMandateOneStep(person)
    expect(widened.thresholds.audacity).toBeNull()
    expect(widened.thresholds.budgetEur).toBeGreaterThan(person.thresholds.budgetEur)
  })
})

describe('isAtWidenCeiling / isAtNarrowFloor', () => {
  it('kind: model, audacity high, budget_eur без стелі (null) — на стелі', () => {
    const mandate = { kind: 'model', thresholds: { audacity: 'high', budgetEur: null } }
    expect(isAtWidenCeiling(mandate)).toBe(true)
  })

  it('kind: model, audacity high, але budget_eur ще має стелю — НЕ на стелі (фолбек ще працює)', () => {
    const mandate = { kind: 'model', thresholds: { audacity: 'high', budgetEur: 500 } }
    expect(isAtWidenCeiling(mandate)).toBe(false)
  })

  it('audacity low, budget_eur 0 — на дні', () => {
    const mandate = { kind: 'model', thresholds: { audacity: 'low', budgetEur: 0 } }
    expect(isAtNarrowFloor(mandate)).toBe(true)
  })
})
