import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRelativeTime } from '../format-relative-time.js'

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T18:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('порожній рядок (немає ранів) → em-dash', () => {
    expect(formatRelativeTime('')).toBe('—')
  })

  it('невалідна дата → em-dash', () => {
    expect(formatRelativeTime('not-a-date')).toBe('—')
  })

  it('менше 30 секунд тому → just now', () => {
    expect(formatRelativeTime('2026-07-13T17:59:45Z')).toBe('just now')
  })

  it('секунди/хвилини/години/дні/місяці — вибирає найбільшу підходящу одиницю', () => {
    expect(formatRelativeTime('2026-07-13T17:59:15Z')).toBe('45s ago')
    expect(formatRelativeTime('2026-07-13T17:57:00Z')).toBe('3m ago')
    expect(formatRelativeTime('2026-07-13T15:00:00Z')).toBe('3h ago')
    expect(formatRelativeTime('2026-07-11T18:00:00Z')).toBe('2d ago')
    expect(formatRelativeTime('2026-05-13T18:00:00Z')).toBe('2mo ago')
  })
})
