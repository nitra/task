import { describe, expect, it } from 'vitest'
import {
  appendKnowledgeEntry,
  domainDigest,
  dueRepetition,
  emptyKnowledge,
  formatKnowledgeFile,
  INTERVAL_LADDER_DAYS_FOR_TESTS,
  loadKnowledgeEntries,
  parseKnowledgeFile,
  recordRepetitionAnswer,
  saveKnowledgeEntries,
  timeToUnderstandingTrend
} from '../knowledge.js'

const DAY_MS = 24 * 60 * 60 * 1000
const COMPOSABLE_RE = /Composable/

/**
 * @param {object} [seed] початкові поля запису (override)
 * @returns {object} мінімальний валідний завершений-квіз payload для appendKnowledgeEntry
 */
function completedQuiz(seed = {}) {
  return {
    decisionRef: '0001-decision-request.md',
    domain: 'architecture',
    question: 'Що станеться з версткою при варіанті B?',
    options: ['Логіка мігрує в composable', 'Новий .vue-файл', 'Нічого не зміниться'],
    correctAnswer: 'Логіка мігрує в composable',
    microlesson: 'Composable-и легше тестувати ізольовано.',
    iterations: 1,
    timeToUnderstandingSec: 47,
    completedAt: '2026-08-09T10:00:47.000Z',
    ...seed
  }
}

/**
 * @param {object} [seed] початковий вміст (текст файлу знань, null — відсутній)
 * @returns {{read: () => Promise<string|null>, write: (content: string) => Promise<void>, text: string|null}}
 *   in-memory knowledgeIo — той самий контракт, що CLI (node:fs на knowledge.json) чи GUI (Tauri invoke);
 *   `text` — геттер поточного вмісту (для асертів у тестах)
 */
function memoryKnowledgeIo(seed = null) {
  let stored = seed
  return {
    read: () => stored,
    write: content => {
      stored = content
    },
    get text() {
      return stored
    }
  }
}

describe('emptyKnowledge', () => {
  it('порожній масив', () => {
    expect(emptyKnowledge()).toEqual([])
  })
})

describe('parseKnowledgeFile / formatKnowledgeFile — round trip', () => {
  it('відсутній/порожній текст — порожній масив, не кидає', () => {
    expect(parseKnowledgeFile(null)).toEqual([])
    expect(parseKnowledgeFile()).toEqual([])
    expect(parseKnowledgeFile('')).toEqual([])
  })

  it('битий JSON — порожній масив, не кидає', () => {
    expect(parseKnowledgeFile('{not json')).toEqual([])
  })

  it('не-масив JSON — порожній масив', () => {
    expect(parseKnowledgeFile('{"a":1}')).toEqual([])
  })

  it('round-trip зберігає записи', () => {
    const entries = appendKnowledgeEntry(emptyKnowledge(), completedQuiz())
    const text = formatKnowledgeFile(entries)
    expect(text.endsWith('\n')).toBe(true)
    expect(parseKnowledgeFile(text)).toEqual(entries)
  })
})

describe('appendKnowledgeEntry', () => {
  it('pure — не мутує вхідний масив', () => {
    const entries = emptyKnowledge()
    const next = appendKnowledgeEntry(entries, completedQuiz())
    expect(entries).toEqual([])
    expect(next).toHaveLength(1)
  })

  it('додає запис з intervalDays на перший щабель драбинки (1) і lastRepeatedAt: null', () => {
    const [entry] = appendKnowledgeEntry(emptyKnowledge(), completedQuiz())
    expect(entry.intervalDays).toBe(INTERVAL_LADDER_DAYS_FOR_TESTS[0])
    expect(entry.lastRepeatedAt).toBeNull()
    expect(entry.domain).toBe('architecture')
    expect(entry.decisionRef).toBe('0001-decision-request.md')
    expect(entry.microlesson).toMatch(COMPOSABLE_RE)
  })

  it('domain відсутній (null) — дефолт general', () => {
    const [entry] = appendKnowledgeEntry(emptyKnowledge(), completedQuiz({ domain: null }))
    expect(entry.domain).toBe('general')
  })

  it('id детермінований з decisionRef+completedAt', () => {
    const [a] = appendKnowledgeEntry(emptyKnowledge(), completedQuiz())
    const [b] = appendKnowledgeEntry(emptyKnowledge(), completedQuiz())
    expect(a.id).toBe(b.id)
  })
})

describe('dueRepetition — spaced repetition 1→3→7→21 днів', () => {
  const BASE_ENTRY = completedQuiz({ completedAt: '2026-08-01T10:00:00.000Z' })

  it('немає записів домену — null (квіз лишається одним питанням)', () => {
    const entries = appendKnowledgeEntry(emptyKnowledge(), BASE_ENTRY)
    expect(dueRepetition(entries, 'process', new Date('2026-09-01T00:00:00.000Z'))).toBeNull()
  })

  it('інтервал ще не настав (< 1 день від completedAt) — null', () => {
    const entries = appendKnowledgeEntry(emptyKnowledge(), BASE_ENTRY)
    const now = new Date(Date.parse(BASE_ENTRY.completedAt) + 12 * 60 * 60 * 1000) // +12 годин
    expect(dueRepetition(entries, 'architecture', now)).toBeNull()
  })

  it('інтервал настав (≥ 1 день від completedAt) — повертає запис', () => {
    const entries = appendKnowledgeEntry(emptyKnowledge(), BASE_ENTRY)
    const now = new Date(Date.parse(BASE_ENTRY.completedAt) + DAY_MS + 1000)
    const due = dueRepetition(entries, 'architecture', now)
    expect(due).not.toBeNull()
    expect(due.domain).toBe('architecture')
  })

  it('інший домен — не підмішується (домен має збігатися)', () => {
    const entries = appendKnowledgeEntry(emptyKnowledge(), BASE_ENTRY)
    const now = new Date(Date.parse(BASE_ENTRY.completedAt) + DAY_MS + 1000)
    expect(dueRepetition(entries, 'process', now)).toBeNull()
  })

  it('записи без options/correctAnswer (напр. з версії до розширення схеми) ігноруються — не можна побудувати квіз', () => {
    const entries = appendKnowledgeEntry(emptyKnowledge(), { ...BASE_ENTRY, options: null, correctAnswer: null })
    const now = new Date(Date.parse(BASE_ENTRY.completedAt) + DAY_MS + 1000)
    expect(dueRepetition(entries, 'architecture', now)).toBeNull()
  })

  it('кілька дозрілих записів — повертає найдавніший дозрілий', () => {
    let entries = appendKnowledgeEntry(emptyKnowledge(), completedQuiz({ completedAt: '2026-08-01T10:00:00.000Z', question: 'старіше' }))
    entries = appendKnowledgeEntry(entries, completedQuiz({ completedAt: '2026-08-05T10:00:00.000Z', question: 'новіше' }))
    const now = new Date('2026-08-10T00:00:00.000Z')
    const due = dueRepetition(entries, 'architecture', now)
    expect(due.question).toBe('старіше')
  })
})

describe('recordRepetitionAnswer', () => {
  it('правильна відповідь просуває драбинку 1→3', () => {
    let entries = appendKnowledgeEntry(emptyKnowledge(), completedQuiz())
    const [before] = entries
    const now = new Date('2026-08-11T10:00:00.000Z')
    entries = recordRepetitionAnswer(entries, before.id, true, now)
    expect(entries[0].intervalDays).toBe(3)
    expect(entries[0].lastRepeatedAt).toBe(now.toISOString())
  })

  it('послідовні правильні відповіді — 1→3→7→21, стеля на 21', () => {
    let entries = appendKnowledgeEntry(emptyKnowledge(), completedQuiz())
    const id = entries[0].id
    const steps = [3, 7, 21, 21, 21]
    for (const expected of steps) {
      entries = recordRepetitionAnswer(entries, id, true, new Date('2026-08-11T10:00:00.000Z'))
      expect(entries[0].intervalDays).toBe(expected)
    }
  })

  it('неправильна відповідь скидає інтервал до першого щабля (1 день) — фейл ≠ покарання, коротший інтервал, не виключення', () => {
    let entries = appendKnowledgeEntry(emptyKnowledge(), completedQuiz())
    const id = entries[0].id
    entries = recordRepetitionAnswer(entries, id, true, new Date('2026-08-11T10:00:00.000Z')) // 1 → 3
    entries = recordRepetitionAnswer(entries, id, false, new Date('2026-08-15T10:00:00.000Z')) // фейл → 1
    expect(entries[0].intervalDays).toBe(1)
  })

  it('не мутує вхідний масив (pure)', () => {
    const entries = appendKnowledgeEntry(emptyKnowledge(), completedQuiz())
    const before = JSON.stringify(entries)
    recordRepetitionAnswer(entries, entries[0].id, true, new Date())
    expect(JSON.stringify(entries)).toBe(before)
  })
})

describe('domainDigest — конспект «що я зрозумів, підписуючи»', () => {
  it('групує за доменом, хронологічно, з підрахунком', () => {
    let entries = appendKnowledgeEntry(emptyKnowledge(), completedQuiz({ completedAt: '2026-08-02T10:00:00.000Z' }))
    entries = appendKnowledgeEntry(entries, completedQuiz({ completedAt: '2026-08-01T10:00:00.000Z', question: 'перше хронологічно' }))
    entries = appendKnowledgeEntry(entries, completedQuiz({ domain: 'process', decisionRef: '0002-decision-request.md' }))

    const digest = domainDigest(entries)
    expect(digest).toHaveLength(2)
    const architecture = digest.find(d => d.domain === 'architecture')
    expect(architecture.count).toBe(2)
    expect(architecture.items[0].question).toBe('перше хронологічно')
    const process = digest.find(d => d.domain === 'process')
    expect(process.count).toBe(1)
  })

  it('порожня база — порожній конспект', () => {
    expect(domainDigest(emptyKnowledge())).toEqual([])
  })
})

describe('timeToUnderstandingTrend — приватна метрика №3 спеки', () => {
  it('< 2 записи домену — insufficient-data, не вигаданий flat', () => {
    const entries = appendKnowledgeEntry(emptyKnowledge(), completedQuiz())
    const [trend] = timeToUnderstandingTrend(entries)
    expect(trend.trend).toBe('insufficient-data')
    expect(trend.samples).toBe(1)
  })

  it('друга половина швидша за першу — down', () => {
    let entries = emptyKnowledge()
    for (const [i, sec] of [80, 70, 30, 20].entries()) {
      entries = appendKnowledgeEntry(entries, completedQuiz({ completedAt: `2026-08-0${i + 1}T10:00:00.000Z`, timeToUnderstandingSec: sec }))
    }
    const [trend] = timeToUnderstandingTrend(entries)
    expect(trend.trend).toBe('down')
    expect(trend.samples).toBe(4)
  })

  it('друга половина повільніша — up', () => {
    let entries = emptyKnowledge()
    for (const [i, sec] of [10, 15, 40, 50].entries()) {
      entries = appendKnowledgeEntry(entries, completedQuiz({ completedAt: `2026-08-0${i + 1}T10:00:00.000Z`, timeToUnderstandingSec: sec }))
    }
    const [trend] = timeToUnderstandingTrend(entries)
    expect(trend.trend).toBe('up')
  })

  it('домени рахуються незалежно', () => {
    let entries = appendKnowledgeEntry(emptyKnowledge(), completedQuiz({ completedAt: '2026-08-01T10:00:00.000Z', timeToUnderstandingSec: 50 }))
    entries = appendKnowledgeEntry(entries, completedQuiz({ completedAt: '2026-08-02T10:00:00.000Z', timeToUnderstandingSec: 10 }))
    entries = appendKnowledgeEntry(entries, completedQuiz({ domain: 'process', decisionRef: '0002-decision-request.md', completedAt: '2026-08-01T10:00:00.000Z', timeToUnderstandingSec: 5 }))
    const trends = timeToUnderstandingTrend(entries)
    expect(trends).toHaveLength(2)
    expect(trends.find(t => t.domain === 'process').samples).toBe(1)
  })
})

describe('loadKnowledgeEntries / saveKnowledgeEntries — io-обгортка', () => {
  it('немає io — порожній масив, не кидає', async () => {
    expect(await loadKnowledgeEntries(null)).toEqual([])
    expect(await loadKnowledgeEntries()).toEqual([])
  })

  it('немає io на write — no-op, не кидає', async () => {
    await expect(saveKnowledgeEntries(null, [])).resolves.toBeUndefined()
  })

  it('round-trip через io: save → load повертає ті самі записи', async () => {
    const io = memoryKnowledgeIo(null)
    const entries = appendKnowledgeEntry(emptyKnowledge(), completedQuiz())
    await saveKnowledgeEntries(io, entries)
    expect(await loadKnowledgeEntries(io)).toEqual(entries)
  })
})
