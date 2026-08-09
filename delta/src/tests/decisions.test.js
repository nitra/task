import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveQueue, depthForFacets, parseDecisionRequest, splitFrontmatter } from '../decisions.js'

const FIXTURES_ROOT = join(import.meta.dirname, 'fixtures/runs')
const DR_0001 = readFileSync(join(FIXTURES_ROOT, 'demo-1/decisions/0001-decision-request.md'), 'utf8')
const DR_0002 = readFileSync(join(FIXTURES_ROOT, 'demo-1/decisions/0002-decision-request.md'), 'utf8')
const DR_CLOSED = readFileSync(join(FIXTURES_ROOT, 'demo-2/decisions/0001-decision-request.md'), 'utf8')
const APPROVAL_CLOSED = readFileSync(join(FIXTURES_ROOT, 'demo-2/decisions/0001-approval.json'), 'utf8')

const INVALID_FRONTMATTER_ERROR_RE = /decision-request/
const DEADLINE_COST_RE = /design-review/
const CONTEXT_RE = /MandateCard\.vue/
const RECOMMENDATION_RE = /Варіант B/
const OPTION_TITLE_RE = /MandateChipRow/
const OPTION_BODY_RE = /Наслідки/

describe('splitFrontmatter', () => {
  it('розбиває markdown на фронтматер-обʼєкт і тіло', () => {
    const { frontmatter, body } = splitFrontmatter('---\nfoo: bar\n---\n## Заголовок\ntext')
    expect(frontmatter).toEqual({ foo: 'bar' })
    expect(body).toBe('## Заголовок\ntext')
  })

  it('файл без фронтматера — порожній обʼєкт, усе тіло як є', () => {
    expect(splitFrontmatter('просто текст')).toEqual({ frontmatter: {}, body: 'просто текст' })
  })

  it('невалідний YAML у фронтматері кидає зрозумілу помилку', () => {
    expect(() => splitFrontmatter('---\nfoo: [\n---\nbody')).toThrow(INVALID_FRONTMATTER_ERROR_RE)
  })
})

describe('parseDecisionRequest', () => {
  it('розбирає фронтматер фікстури 0001 у нормалізовану camelCase-форму', () => {
    const dr = parseDecisionRequest(DR_0001, { path: 'x', runId: 'demo-1', nnnn: '0001' })
    expect(dr.mandateGeneration).toBe(3)
    expect(dr.computedOwner).toBe('olena')
    expect(dr.escalationChain).toEqual(['olena', 'vitalii'])
    expect(dr.recommendedBy).toBe('escalation-intake-fable-5')
    expect(dr.deadlineCost).toMatch(DEADLINE_COST_RE)
    expect(dr.retryHistory).toHaveLength(1)
  })

  it('нормалізує leverage_facets із дефолтами для відсутніх полів', () => {
    const dr = parseDecisionRequest(DR_0001)
    expect(dr.leverageFacets).toEqual({ irreversible: false, blastRadius: 'node', divergence: 'low', estCostEur: 40 })
  })

  it('порожній leverage_facets — дефолти (reversible/node)', () => {
    const dr = parseDecisionRequest('---\ncomputed_owner: olena\n---\n## Контекст\nx')
    expect(dr.leverageFacets).toEqual({ irreversible: false, blastRadius: 'node', divergence: null, estCostEur: null })
  })

  it('розбирає ## Контекст / ## Рекомендація агента як окремі секції тіла', () => {
    const dr = parseDecisionRequest(DR_0001)
    expect(dr.context).toMatch(CONTEXT_RE)
    expect(dr.recommendation).toMatch(RECOMMENDATION_RE)
  })

  it('розбирає ## Варіанти на ### A / ### B пункти з label/title/body', () => {
    const dr = parseDecisionRequest(DR_0001)
    expect(dr.options).toHaveLength(2)
    expect(dr.options[0]).toMatchObject({ label: 'A' })
    expect(dr.options[0].title).toMatch(OPTION_TITLE_RE)
    expect(dr.options[0].body).toMatch(OPTION_BODY_RE)
    expect(dr.options[1].label).toBe('B')
  })

  it('зберігає позиційні метадані (path/runId/nnnn) з переданого meta', () => {
    const dr = parseDecisionRequest(DR_0001, { path: '/abs/0001-decision-request.md', runId: 'demo-1', nnnn: '0001' })
    expect(dr.path).toBe('/abs/0001-decision-request.md')
    expect(dr.runId).toBe('demo-1')
    expect(dr.nnnn).toBe('0001')
  })
})

describe('depthForFacets', () => {
  it('reversible + низькі фасети → one-tap', () => {
    expect(depthForFacets({ irreversible: false, blastRadius: 'node', divergence: 'low', estCostEur: 40 })).toBe(
      'one-tap'
    )
  })

  it('irreversible → teach-back незалежно від решти фасетів', () => {
    expect(depthForFacets({ irreversible: true, blastRadius: 'node', divergence: 'low', estCostEur: 0 })).toBe(
      'teach-back'
    )
  })

  it('широкий blast_radius (repo/company) → teach-back', () => {
    expect(depthForFacets({ irreversible: false, blastRadius: 'repo', divergence: 'low', estCostEur: 0 })).toBe(
      'teach-back'
    )
    expect(depthForFacets({ irreversible: false, blastRadius: 'company', divergence: 'low', estCostEur: 0 })).toBe(
      'teach-back'
    )
  })

  it('reversible + висока дивергенція або помітна ціна → standard', () => {
    expect(depthForFacets({ irreversible: false, blastRadius: 'subtree', divergence: 'high', estCostEur: 0 })).toBe(
      'standard'
    )
    expect(depthForFacets({ irreversible: false, blastRadius: 'subtree', divergence: 'low', estCostEur: 1500 })).toBe(
      'standard'
    )
  })
})

describe('deriveQueue', () => {
  const decisionsDirs = [
    {
      dir: '/root/runs/demo-1/decisions',
      files: [
        { name: '0001-decision-request.md', content: DR_0001 },
        { name: '0002-decision-request.md', content: DR_0002 }
      ]
    },
    {
      dir: '/root/runs/demo-2/decisions',
      files: [
        { name: '0001-decision-request.md', content: DR_CLOSED },
        { name: '0001-approval.json', content: APPROVAL_CLOSED }
      ]
    }
  ]

  it('повертає лише відкриті decision-request-и computed_owner === handle', () => {
    const queue = deriveQueue(decisionsDirs, 'olena')
    // 0001 (demo-1, olena, відкритий) — так; 0001 (demo-2, olena, закритий approval.json) — ні.
    expect(queue).toHaveLength(1)
    expect(queue[0].nnnn).toBe('0001')
    expect(queue[0].runId).toBe('demo-1')
  })

  it('інший handle бачить свій зріз — 0002 (vitalii), не перетинається з olena', () => {
    const queue = deriveQueue(decisionsDirs, 'vitalii')
    expect(queue).toHaveLength(1)
    expect(queue[0].nnnn).toBe('0002')
    expect(queue[0].computedOwner).toBe('vitalii')
  })

  it('закрита розвилка (сусідній approval.json) не потрапляє в чергу навіть при збігу owner', () => {
    const queue = deriveQueue(decisionsDirs, 'olena')
    expect(queue.some(item => item.dir.includes('demo-2'))).toBe(false)
  })

  it('без handle — порожня черга', () => {
    expect(deriveQueue(decisionsDirs, null)).toEqual([])
    expect(deriveQueue(decisionsDirs)).toEqual([])
  })

  it('кожен елемент черги несе деривовану depth та прапорець open', () => {
    const [item] = deriveQueue(decisionsDirs, 'olena')
    expect(item.depth).toBe('one-tap')
    expect(item.open).toBe(true)
  })

  it('сортує за leverage-фасетами: irreversible/ширший blast_radius — вище', () => {
    const irreversibleDr = DR_0001.replace('irreversible: false', 'irreversible: true')
    const dirs = [
      {
        dir: '/root/runs/sort/decisions',
        files: [
          { name: '0001-decision-request.md', content: DR_0001 },
          {
            name: '0002-decision-request.md',
            content: irreversibleDr.replace('computed_owner: olena', 'computed_owner: olena').replace('0001', '0002')
          }
        ]
      }
    ]
    const queue = deriveQueue(dirs, 'olena')
    expect(queue[0].leverageFacets.irreversible).toBe(true)
    expect(queue[0].nnnn).toBe('0002')
  })
})
