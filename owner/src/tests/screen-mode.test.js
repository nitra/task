import { describe, expect, it } from 'vitest'
import { chooseMode } from '../screen-mode.js'

describe('chooseMode', () => {
  it('є рішення → режим decisions незалежно від дельти', () => {
    const { mode, headline } = chooseMode({ decisionCount: 3, deltaCount: 7 })
    expect(mode).toBe('decisions')
    expect(headline).toBe('3 рішення чекають на тебе')
  })

  it('українська множина і однина у заголовку', () => {
    expect(chooseMode({ decisionCount: 1, deltaCount: 0 }).headline).toBe('1 рішення чекає на тебе')
    expect(chooseMode({ decisionCount: 5, deltaCount: 0 }).headline).toBe('5 рішень чекають на тебе')
    expect(chooseMode({ decisionCount: 11, deltaCount: 0 }).headline).toBe('11 рішень чекають на тебе')
    expect(chooseMode({ decisionCount: 22, deltaCount: 0 }).headline).toBe('22 рішення чекають на тебе')
  })

  it('рішень немає, дельта є → brief з поясненням', () => {
    const { mode, headline } = chooseMode({ decisionCount: 0, deltaCount: 2 })
    expect(mode).toBe('brief')
    expect(headline).toContain('що змінилось')
  })

  it('тихо → map', () => {
    expect(chooseMode({ decisionCount: 0, deltaCount: 0 }).mode).toBe('map')
  })
})
