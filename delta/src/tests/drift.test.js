import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultDriftConfig, detectDrift, formatDriftFile, loadDriftCards, parseDriftFile, runDriftScan, saveDriftCards } from '../drift.js'

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures/runs')

/**
 * @param {string} runId run-id
 * @param {string} fileName ім'я файлу decision-request-а
 * @returns {{name: string, content: string}} один файл сканованої decisions-директорії
 */
function fixtureFile(runId, fileName) {
  return { name: fileName, content: readFileSync(join(FIXTURES_DIR, runId, 'decisions', fileName), 'utf8') }
}

const NOW = () => new Date('2026-08-09T10:00:00.000Z') // фікстура 0004 opened_at: 2026-07-01 → ~39 днів тому

describe('defaultDriftConfig', () => {
  it('staleDays: 7, iterationsThreshold: 3', () => {
    expect(defaultDriftConfig()).toEqual({ staleDays: 7, iterationsThreshold: 3 })
  })
})

describe('detectDrift', () => {
  it('без handle — порожньо', () => {
    expect(detectDrift({ decisionsDirs: [], handle: null, now: NOW() })).toEqual([])
  })

  it('застаріла ops-розвилка olena (opened_at ~39 днів тому, staleDays: 7) — картка класу ops', () => {
    const decisionsDirs = [{ dir: '/root/runs/demo-1/decisions', files: [fixtureFile('demo-1', '0004-decision-request.md')] }]
    const cards = detectDrift({ decisionsDirs, handle: 'olena', now: NOW() })
    expect(cards).toHaveLength(1)
    expect(cards[0].decisionType).toBe('ops')
    expect(cards[0].count).toBe(1)
    expect(cards[0].items[0].signal).toBe('stale')
    expect(cards[0].items[0].ageDays).toBeGreaterThanOrEqual(39)
    expect(cards[0].deadlineCostSample).toBe('немає залежних задач')
  })

  it('свіжа відкрита розвилка (без opened_at, без застарілого квізу) — НЕ дрейф', () => {
    // 0001 — computed_owner: olena, немає opened_at і немає квіз-файлу.
    const decisionsDirs = [{ dir: '/root/runs/demo-1/decisions', files: [fixtureFile('demo-1', '0001-decision-request.md')] }]
    expect(detectDrift({ decisionsDirs, handle: 'olena', now: NOW() })).toEqual([])
  })

  it('закрита (approval поруч) — НЕ дрейф, навіть якщо стара', () => {
    const decisionsDirs = [
      {
        dir: '/root/runs/demo-1/decisions',
        files: [fixtureFile('demo-1', '0004-decision-request.md'), { name: '0004-approval.json', content: '{"approved":true}' }]
      }
    ]
    expect(detectDrift({ decisionsDirs, handle: 'olena', now: NOW() })).toEqual([])
  })

  it('чужа розвилка (computed_owner ≠ handle) — НЕ дрейф', () => {
    const decisionsDirs = [{ dir: '/root/runs/demo-1/decisions', files: [fixtureFile('demo-1', '0004-decision-request.md')] }]
    expect(detectDrift({ decisionsDirs, handle: 'vitalii', now: NOW() })).toEqual([])
  })

  it('irreversible (кворумна) — НЕ дрейф (власна механіка прогресу, не одноосібне відкладання)', () => {
    const decisionsDirs = [{ dir: '/root/runs/demo-5/decisions', files: [fixtureFile('demo-5', '0001-decision-request.md')] }]
    expect(detectDrift({ decisionsDirs, handle: 'vitalii', now: NOW() })).toEqual([])
  })

  it('повторні ітерації без підпису (iterations >= iterationsThreshold) — signal: repeated-iterations, навіть свіжа', () => {
    const quizText = ['---', 'schema_version: 1', 'depth: one-tap', 'iterations: 5', '---', ''].join('\n')
    const decisionsDirs = [
      {
        dir: '/root/runs/demo-1/decisions',
        files: [fixtureFile('demo-1', '0001-decision-request.md'), { name: '0001-quiz.md', content: quizText }]
      }
    ]
    const cards = detectDrift({ decisionsDirs, handle: 'olena', now: NOW() })
    expect(cards).toHaveLength(1)
    expect(cards[0].items[0].signal).toBe('repeated-iterations')
    expect(cards[0].items[0].iterations).toBe(5)
  })

  it('кастомний staleDays/iterationsThreshold застосовується', () => {
    const decisionsDirs = [{ dir: '/root/runs/demo-1/decisions', files: [fixtureFile('demo-1', '0004-decision-request.md')] }]
    expect(detectDrift({ decisionsDirs, handle: 'olena', now: NOW(), staleDays: 1000 })).toEqual([])
  })
})

describe('formatDriftFile / parseDriftFile — round-trip, приватний файл поза git', () => {
  it('round-trip', () => {
    const cards = [{ decisionType: 'ops', count: 1, oldestAgeDays: 39, deadlineCostSample: null, items: [], generatedAt: NOW().toISOString() }]
    expect(parseDriftFile(formatDriftFile(cards))).toEqual(cards)
  })

  it('відсутній/битий файл — порожній масив', () => {
    expect(parseDriftFile(null)).toEqual([])
    expect(parseDriftFile('not json')).toEqual([])
  })
})

/**
 * @param {object[]} [seed] початкові картки
 * @returns {{read: () => Promise<string|null>, write: (content: string) => Promise<void>, text: () => string|null}}
 *   in-memory io дрейф-файлу
 */
function memoryDriftIo(seed) {
  let text = seed ? formatDriftFile(seed) : null
  return { read: () => text, write: content => { text = content }, text: () => text }
}

describe('loadDriftCards / saveDriftCards / runDriftScan', () => {
  it('без driftIo — порожньо / no-op', async () => {
    expect(await loadDriftCards(null)).toEqual([])
    await expect(saveDriftCards(null, [{ x: 1 }])).resolves.toBeUndefined()
  })

  it('runDriftScan перезаписує файл СВІЖИМ результатом (не append) — стара картка зникає, коли клас закрито', async () => {
    const driftIo = memoryDriftIo([{ decisionType: 'stale-class', count: 99, oldestAgeDays: 999, deadlineCostSample: null, items: [], generatedAt: '2020-01-01T00:00:00.000Z' }])
    const decisionsDirs = [{ dir: '/root/runs/demo-1/decisions', files: [fixtureFile('demo-1', '0004-decision-request.md')] }]
    const cards = await runDriftScan({ decisionsDirs, handle: 'olena', driftIo, now: NOW })
    expect(cards).toHaveLength(1)
    expect(cards[0].decisionType).toBe('ops')
    const persisted = await loadDriftCards(driftIo)
    expect(persisted).toEqual(cards)
    expect(persisted.find(c => c.decisionType === 'stale-class')).toBeUndefined()
  })
})
