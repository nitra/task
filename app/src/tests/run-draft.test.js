import { describe, expect, it } from 'vitest'
import { parseRunDraft } from '../run-draft.js'

describe('parseRunDraft', () => {
  it('витягує всі три секції', () => {
    const text =
      '## Completed\n\nЗібрано 312/847 записів.\n\n## Blockers\n\nНе вистачає бюджету.\n\n## Next Attempt\n\nРозбити на батчі.\n'
    expect(parseRunDraft(text)).toEqual({
      completed: 'Зібрано 312/847 записів.',
      blockers: 'Не вистачає бюджету.',
      nextAttempt: 'Розбити на батчі.'
    })
  })

  it('зупиняється на наступному заголовку ## і обрізає whitespace', () => {
    const text = '## Blockers\n\n  затримка мережі  \n\n## Script\n\nexit_code: 1\n'
    expect(parseRunDraft(text).blockers).toBe('затримка мережі')
    expect(parseRunDraft(text).completed).toBeNull()
  })

  it('порожній текст → усі секції null', () => {
    expect(parseRunDraft('')).toEqual({ completed: null, blockers: null, nextAttempt: null })
  })

  it('присутній заголовок без тіла → null, не порожній рядок', () => {
    const text = '## Completed\n\n## Blockers\n\nx\n'
    expect(parseRunDraft(text).completed).toBeNull()
  })
})
