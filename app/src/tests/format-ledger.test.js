import { describe, expect, it } from 'vitest'
import { formatCost, formatDuration, formatTokens } from '../format-ledger.js'

describe('formatDuration', () => {
  it('годинники/хвилини/секунди — пропускає нульові старші розряди', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(125)).toBe('2m 5s')
    expect(formatDuration(3725)).toBe('1h 2m')
  })

  it('округлює дробові секунди', () => {
    expect(formatDuration(45.7)).toBe('46s')
  })
})

describe('formatCost', () => {
  it('форматує з двома знаками після коми', () => {
    expect(formatCost(1.5)).toBe('$1.50')
    expect(formatCost(0.005)).toBe('$0.01')
  })

  it('0 або відсутнє значення → em-dash', () => {
    expect(formatCost(0)).toBe('—')
    expect(formatCost()).toBe('—')
  })
})

describe('formatTokens', () => {
  it('скорочує тисячі до k', () => {
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(999)).toBe('999')
  })

  it('0 або відсутнє значення → em-dash', () => {
    expect(formatTokens(0)).toBe('—')
    expect(formatTokens()).toBe('—')
  })
})
