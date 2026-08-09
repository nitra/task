import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { displayName, emptyDirectory, formatDirectory, parseDirectory, setDirectoryEntry } from '../directory.js'

const FIXTURES_ROOT = join(import.meta.dirname, 'fixtures')

describe('parseDirectory', () => {
  it('відсутній/битий/порожній текст — порожній обʼєкт, не помилка', () => {
    expect(parseDirectory(null)).toEqual({})
    expect(parseDirectory()).toEqual({})
    expect(parseDirectory('')).toEqual({})
    expect(parseDirectory('{not json')).toEqual({})
    expect(parseDirectory('[]')).toEqual({}) // масив — не той корінь, той самий fail-closed, що device-registry.js для не-масиву
  })

  it('валідний обʼєкт round-trip через formatDirectory', () => {
    const entries = { olena: { name: 'Олена', email: 'olena@example.invalid', lang: 'uk' } }
    expect(parseDirectory(formatDirectory(entries))).toEqual(entries)
  })

  it('нормалізує відсутні поля до null, обрізає пробіли', () => {
    const parsed = parseDirectory(JSON.stringify({ vitalii: { name: '  Віталій  ' } }))
    expect(parsed).toEqual({ vitalii: { name: 'Віталій', email: null, lang: null } })
  })

  it('порожній рядок у полі — null, не порожній рядок', () => {
    const parsed = parseDirectory(JSON.stringify({ olena: { name: ' '.repeat(3) } }))
    expect(parsed.olena.name).toBeNull()
  })
})

describe('emptyDirectory', () => {
  it('порожній обʼєкт', () => {
    expect(emptyDirectory()).toEqual({})
  })
})

describe('setDirectoryEntry', () => {
  it('додає новий запис для нового handle', () => {
    const result = setDirectoryEntry(emptyDirectory(), 'olena', { name: 'Олена' })
    expect(result).toEqual({ olena: { name: 'Олена', email: null, lang: null } })
  })

  it('part update — не передані поля лишаються з попереднього запису', () => {
    const first = setDirectoryEntry(emptyDirectory(), 'olena', { name: 'Олена', email: 'olena@example.invalid' })
    const second = setDirectoryEntry(first, 'olena', { lang: 'en' })
    expect(second.olena).toEqual({ name: 'Олена', email: 'olena@example.invalid', lang: 'en' })
  })

  it('не мутує вхідний обʼєкт (pure-функція)', () => {
    const entries = emptyDirectory()
    setDirectoryEntry(entries, 'olena', { name: 'Олена' })
    expect(entries).toEqual({})
  })

  it('різні handle співіснують', () => {
    let entries = setDirectoryEntry(emptyDirectory(), 'olena', { name: 'Олена' })
    entries = setDirectoryEntry(entries, 'vitalii', { name: 'Віталій' })
    expect(Object.keys(entries)).toEqual(['olena', 'vitalii'])
  })
})

describe('displayName', () => {
  const entries = setDirectoryEntry(emptyDirectory(), 'olena', { name: 'Олена Коваль' })

  it('запис із імʼям — display-імʼя', () => {
    expect(displayName(entries, 'olena')).toBe('Олена Коваль')
  })

  it('handle без запису в довіднику — фолбек на сам handle', () => {
    expect(displayName(entries, 'fable-5')).toBe('fable-5')
  })

  it('запис без name (лише email/lang) — фолбек на handle', () => {
    const withEmailOnly = setDirectoryEntry(entries, 'vitalii', { email: 'vitalii@example.invalid' })
    expect(displayName(withEmailOnly, 'vitalii')).toBe('vitalii')
  })

  it('null/undefined handle — null', () => {
    expect(displayName(entries, null)).toBeNull()
    expect(displayName(entries)).toBeNull()
  })
})

describe('directory.example.json — формат прикладу (PII не в git, приклад — так)', () => {
  it('приклад-фікстура парситься тим самим parseDirectory', () => {
    const path = join(FIXTURES_ROOT, 'directory.example.json')
    expect(existsSync(path)).toBe(true)
    const parsed = parseDirectory(readFileSync(path, 'utf8'))
    expect(displayName(parsed, 'olena')).toBe('Олена Коваль')
    expect(displayName(parsed, 'fable-5')).toBe('Fable-5')
  })
})
