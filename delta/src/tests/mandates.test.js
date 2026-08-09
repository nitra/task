import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  deriveMandatesView,
  escalationChain,
  mandatesForOwner,
  modelMandates,
  parseMandates,
  rootMandates
} from '../mandates.js'

const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures/mandates.yaml'), 'utf8')

describe('parseMandates', () => {
  it('порожній/відсутній файл — порожній список, не помилка', () => {
    expect(parseMandates('')).toEqual([])
    expect(parseMandates('   \n  ')).toEqual([])
    expect(parseMandates(null)).toEqual([])
    expect(parseMandates(undefined)).toEqual([])
  })

  it('розбирає фікстуру у три нормалізовані мандати в порядку файлу', () => {
    const mandates = parseMandates(FIXTURE)
    expect(mandates).toHaveLength(3)
    expect(mandates.map(m => m.owner)).toEqual(['olena', 'fable-5', 'vitalii'])
  })

  it('kind: person за замовчуванням, kind: model лише коли явно вказано', () => {
    const [olena, fable, vitalii] = parseMandates(FIXTURE)
    expect(olena.kind).toBe('person')
    expect(fable.kind).toBe('model')
    expect(vitalii.kind).toBe('person')
  })

  it('нормалізує scope і thresholds у camelCase з дефолтами для відсутніх полів', () => {
    const [olena] = parseMandates(FIXTURE)
    expect(olena.scope).toEqual({
      refs: ['refs/mt/tasks/design/**'],
      decisionTypes: ['architecture', 'ux']
    })
    expect(olena.thresholds).toEqual({
      budgetEur: 2000,
      risk: 'medium',
      irreversible: false,
      audacity: null
    })
    expect(olena.escalatesTo).toBe('vitalii')
  })

  it('порожні thresholds ({}) — усі поля null; escalates_to: null лишається null', () => {
    const [, , vitalii] = parseMandates(FIXTURE)
    expect(vitalii.thresholds).toEqual({ budgetEur: null, risk: null, irreversible: null, audacity: null })
    expect(vitalii.escalatesTo).toBeNull()
  })

  it('audacity зʼявляється лише у ШІ-мандата фікстури', () => {
    const [, fable] = parseMandates(FIXTURE)
    expect(fable.thresholds.audacity).toBe('medium')
  })

  it('запис без owner відкидається, решта фікстури лишається валідною', () => {
    const yaml = `mandates:\n  - kind: model\n    scope: {}\n  - owner: vitalii\n    thresholds: {}\n    escalates_to: null\n`
    expect(parseMandates(yaml)).toEqual([
      {
        owner: 'vitalii',
        kind: 'person',
        scope: { refs: [], decisionTypes: [] },
        thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null },
        escalatesTo: null
      }
    ])
  })

  it('невалідний YAML кидає зрозумілу помилку', () => {
    expect(() => parseMandates('mandates: [')).toThrow(/mandates\.yaml/)
  })
})

describe('mandatesForOwner', () => {
  const mandates = parseMandates(FIXTURE)

  it('повертає мандат(и) відомого власника', () => {
    expect(mandatesForOwner(mandates, 'olena')).toHaveLength(1)
    expect(mandatesForOwner(mandates, 'olena')[0].owner).toBe('olena')
  })

  it('невідомий handle і відсутній handle — порожній зріз', () => {
    expect(mandatesForOwner(mandates, 'ghost')).toEqual([])
    expect(mandatesForOwner(mandates, null)).toEqual([])
    expect(mandatesForOwner(mandates, undefined)).toEqual([])
  })
})

describe('escalationChain', () => {
  const mandates = parseMandates(FIXTURE)

  it('людина: власний handle → escalates_to → корінь', () => {
    expect(escalationChain(mandates, 'olena')).toEqual(['olena', 'vitalii'])
  })

  it('ШІ-мандат: ланцюг проходить крізь модель до кореня людини', () => {
    expect(escalationChain(mandates, 'fable-5')).toEqual(['fable-5', 'olena', 'vitalii'])
  })

  it('кореневий мандат — ланцюг з одного елемента', () => {
    expect(escalationChain(mandates, 'vitalii')).toEqual(['vitalii'])
  })

  it('handle поза картою — порожній ланцюг', () => {
    expect(escalationChain(mandates, 'ghost')).toEqual([])
    expect(escalationChain(mandates, null)).toEqual([])
  })

  it('циклічний escalates_to не зациклює обчислення', () => {
    const cyclic = parseMandates(
      'mandates:\n  - owner: a\n    escalates_to: b\n  - owner: b\n    escalates_to: a\n'
    )
    expect(escalationChain(cyclic, 'a')).toEqual(['a', 'b'])
  })
})

describe('modelMandates / rootMandates', () => {
  const mandates = parseMandates(FIXTURE)

  it('modelMandates повертає лише kind: model', () => {
    expect(modelMandates(mandates).map(m => m.owner)).toEqual(['fable-5'])
  })

  it('rootMandates повертає мандати без escalates_to', () => {
    expect(rootMandates(mandates).map(m => m.owner)).toEqual(['vitalii'])
  })
})

describe('deriveMandatesView — два користувачі бачать різний зріз (демо-критерій M0)', () => {
  it('olena бачить свій scope і ланцюг до vitalii', () => {
    const view = deriveMandatesView(FIXTURE, 'olena')
    expect(view.mandates).toHaveLength(3)
    expect(view.mine).toHaveLength(1)
    expect(view.mine[0].owner).toBe('olena')
    expect(view.escalationChain).toEqual(['olena', 'vitalii'])
    expect(view.models.map(m => m.owner)).toEqual(['fable-5'])
  })

  it('vitalii бачить кореневий мандат і порожній подальший ланцюг', () => {
    const view = deriveMandatesView(FIXTURE, 'vitalii')
    expect(view.mine[0].escalatesTo).toBeNull()
    expect(view.escalationChain).toEqual(['vitalii'])
  })

  it('зрізи двох різних handle не перетинаються за mine', () => {
    const olenaView = deriveMandatesView(FIXTURE, 'olena')
    const vitaliiView = deriveMandatesView(FIXTURE, 'vitalii')
    expect(olenaView.mine).not.toEqual(vitaliiView.mine)
  })

  it('без handle — mine порожній, forest і models лишаються повними', () => {
    const view = deriveMandatesView(FIXTURE, null)
    expect(view.mine).toEqual([])
    expect(view.mandates).toHaveLength(3)
  })
})
