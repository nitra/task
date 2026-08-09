import { describe, expect, it } from 'vitest'
import {
  buildDeltaReport,
  candorDeliveredCount,
  countBlockedWithDeadlineCost,
  delegationDepth,
  deltaReport,
  deriveBoundaryMoves,
  deriveDecisionsSummary,
  formatDeltaReportMarkdown,
  gateCostEur,
  killSwitchActivationsCount,
  reportPath,
  summarizeDecisions
} from '../report.js'

const NOW = () => new Date('2026-08-09T10:00:00.000Z')

const MANDATES = [
  { owner: 'fable-5', kind: 'model', scope: { refs: ['refs/mt/tasks/routine/**'], decisionTypes: ['ops'] }, thresholds: { budgetEur: 200, risk: 'low', irreversible: false, audacity: 'medium' }, escalatesTo: 'olena' },
  { owner: 'olena', kind: 'person', scope: { refs: ['refs/mt/tasks/design/**'], decisionTypes: ['architecture'] }, thresholds: { budgetEur: 2000, risk: 'medium', irreversible: false, audacity: null }, escalatesTo: 'vitalii' },
  { owner: 'vitalii', kind: 'person', scope: { refs: ['refs/mt/**'], decisionTypes: ['*'] }, thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null }, escalatesTo: null }
]

/**
 * @param {object} [seed] початковий вміст сховища
 * @returns {{store: Map<string,string>, readFile: (path:string) => Promise<string|null>, writeFile: (path:string, content:string) => Promise<void>}} in-memory io
 */
function memoryIo(seed = {}) {
  const store = new Map(Object.entries(seed))
  return {
    store,
    readFile: path => (store.has(path) ? store.get(path) : null),
    writeFile: (path, content) => {
      store.set(path, content)
    }
  }
}

const quizFile = (timeSec, iterations = 1) =>
  ['---', 'schema_version: 1', 'depth: one-tap', `iterations: ${iterations}`, `time_to_understanding_sec: ${timeSec}`, '---', ''].join('\n')

const soloDecisionRequest = ({ decisionType = 'architecture', deadlineCost = null } = {}) =>
  [
    '---',
    'type: decision-request',
    'computed_owner: olena',
    'escalation_chain: [olena, vitalii]',
    'leverage_facets: { irreversible: false, blast_radius: node }',
    `decision_type: ${decisionType}`,
    ...(deadlineCost ? [`deadline_cost: "${deadlineCost}"`] : []),
    '---',
    '## Контекст',
    'x'
  ].join('\n')

describe('deriveDecisionsSummary — класифікація людський/модельний/кворумний', () => {
  const periodStart = new Date('2026-08-01T00:00:00.000Z')
  const periodEnd = NOW()

  it('одноосібне рішення computed_owner: olena (person) — human, в межах періоду', () => {
    const decisionsDirs = [
      {
        dir: '/root/runs/demo-1/decisions',
        files: [
          { name: '0001-decision-request.md', content: soloDecisionRequest() },
          { name: '0001-approval.json', content: JSON.stringify({ chosen_option: 'A', signed_at: '2026-08-05T00:00:00.000Z' }) },
          { name: '0001-quiz.md', content: quizFile(120) }
        ]
      }
    ]
    const closed = deriveDecisionsSummary({ decisionsDirs, mandates: MANDATES, periodStart, periodEnd })
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatchObject({ classification: 'human', decisionType: 'architecture', quizTimeToUnderstandingSec: 120 })
  })

  it('делеговане fable-5 (kind: model) — model, попри computed_owner: olena', () => {
    const decisionsDirs = [
      {
        dir: '/root/runs/demo-1/decisions',
        files: [
          { name: '0001-decision-request.md', content: soloDecisionRequest({ decisionType: 'ops' }) },
          { name: '0001-delegation.json', content: JSON.stringify({ delegated_to: 'fable-5', delegated_by: 'olena', signed_at: '2026-08-05T00:00:00.000Z' }) },
          { name: '0001-approval.json', content: JSON.stringify({ chosen_option: 'A', signed_at: '2026-08-06T00:00:00.000Z' }) }
        ]
      }
    ]
    const closed = deriveDecisionsSummary({ decisionsDirs, mandates: MANDATES, periodStart, periodEnd })
    expect(closed).toHaveLength(1)
    expect(closed[0].classification).toBe('model')
    expect(closed[0].quizTimeToUnderstandingSec).toBe(0) // немає quiz-файлу — 0, не кидає
  })

  it('поза вікном періоду — не рахується', () => {
    const decisionsDirs = [
      {
        dir: '/root/runs/demo-1/decisions',
        files: [
          { name: '0001-decision-request.md', content: soloDecisionRequest() },
          { name: '0001-approval.json', content: JSON.stringify({ chosen_option: 'A', signed_at: '2026-01-01T00:00:00.000Z' }) }
        ]
      }
    ]
    expect(deriveDecisionsSummary({ decisionsDirs, mandates: MANDATES, periodStart, periodEnd })).toEqual([])
  })

  it('ще відкрите (без approval) — не рахується', () => {
    const decisionsDirs = [{ dir: '/root/runs/demo-1/decisions', files: [{ name: '0001-decision-request.md', content: soloDecisionRequest() }] }]
    expect(deriveDecisionsSummary({ decisionsDirs, mandates: MANDATES, periodStart, periodEnd })).toEqual([])
  })

  it('кворумний (irreversible) закритий — quorum, Σ час усіх підписантів', () => {
    const quorumRequest = [
      '---',
      'type: decision-request',
      'computed_owner: olena',
      'approvers: [olena, vitalii]',
      'leverage_facets: { irreversible: true, blast_radius: company }',
      'decision_type: architecture',
      '---',
      '## Контекст',
      'x'
    ].join('\n')
    const decisionsDirs = [
      {
        dir: '/root/runs/demo-1/decisions',
        files: [
          { name: '0001-decision-request.md', content: quorumRequest },
          { name: '0001-approval-olena.json', content: JSON.stringify({ chosen_option: 'A', signed_at: '2026-08-05T00:00:00.000Z' }) },
          { name: '0001-approval-vitalii.json', content: JSON.stringify({ chosen_option: 'A', signed_at: '2026-08-06T00:00:00.000Z' }) },
          { name: '0001-quiz-olena.md', content: quizFile(300) },
          { name: '0001-quiz-vitalii.md', content: quizFile(200) }
        ]
      }
    ]
    const closed = deriveDecisionsSummary({ decisionsDirs, mandates: MANDATES, periodStart, periodEnd })
    expect(closed).toHaveLength(1)
    expect(closed[0].classification).toBe('quorum')
    expect(closed[0].quizTimeToUnderstandingSec).toBe(500)
    expect(closed[0].closedAt).toBe('2026-08-06T00:00:00.000Z')
  })

  it('кворумний diverged/pending — не рахується (не закритий)', () => {
    const quorumRequest = [
      '---',
      'type: decision-request',
      'computed_owner: olena',
      'approvers: [olena, vitalii]',
      'leverage_facets: { irreversible: true, blast_radius: company }',
      'decision_type: architecture',
      '---',
      '## Контекст',
      'x'
    ].join('\n')
    const decisionsDirs = [
      {
        dir: '/root/runs/demo-1/decisions',
        files: [
          { name: '0001-decision-request.md', content: quorumRequest },
          { name: '0001-approval-olena.json', content: JSON.stringify({ chosen_option: 'A', signed_at: '2026-08-05T00:00:00.000Z' }) }
        ]
      }
    ]
    expect(deriveDecisionsSummary({ decisionsDirs, mandates: MANDATES, periodStart, periodEnd })).toEqual([])
  })
})

describe('summarizeDecisions', () => {
  it('агрегує по класифікації і decision_type', () => {
    const closed = [
      { decisionType: 'ops', classification: 'model', quizTimeToUnderstandingSec: 0 },
      { decisionType: 'ops', classification: 'human', quizTimeToUnderstandingSec: 60 },
      { decisionType: 'architecture', classification: 'quorum', quizTimeToUnderstandingSec: 500 }
    ]
    const summary = summarizeDecisions(closed)
    expect(summary.total).toBe(3)
    expect(summary.byClassification).toEqual({ human: 1, model: 1, quorum: 1 })
    expect(summary.byType).toEqual([
      { decisionType: 'ops', human: 1, model: 1, quorum: 0, total: 2 },
      { decisionType: 'architecture', human: 0, model: 0, quorum: 1, total: 1 }
    ])
  })
})

describe('gateCostEur', () => {
  it('рахує ЛИШЕ людські/кворумні (модельні виключено)', () => {
    const closed = [
      { classification: 'human', quizTimeToUnderstandingSec: 3600 }, // 1 год
      { classification: 'quorum', quizTimeToUnderstandingSec: 1800 }, // 0.5 год
      { classification: 'model', quizTimeToUnderstandingSec: 999999 }
    ]
    expect(gateCostEur(closed, 60)).toBe(90) // (3600+1800)/3600 * 60 = 90
  })

  it('порожній список — 0', () => {
    expect(gateCostEur([], 60)).toBe(0)
  })
})

describe('countBlockedWithDeadlineCost', () => {
  it('рахує ВІДКРИТІ розвилки з непорожнім deadline_cost, знімок (не період)', () => {
    const decisionsDirs = [
      {
        dir: '/root/runs/demo-1/decisions',
        files: [
          { name: '0001-decision-request.md', content: soloDecisionRequest({ deadlineCost: 'блокує реліз' }) },
          { name: '0002-decision-request.md', content: soloDecisionRequest({ deadlineCost: 'блокує SLA' }) },
          { name: '0002-approval.json', content: JSON.stringify({ chosen_option: 'A' }) }, // закрито — не рахується
          { name: '0003-decision-request.md', content: soloDecisionRequest() } // немає deadline_cost
        ]
      }
    ]
    expect(countBlockedWithDeadlineCost({ decisionsDirs })).toBe(1)
  })
})

describe('delegationDepth', () => {
  it('кількість decision_types з model-власником + делегувань за період', () => {
    const decisionsDirs = [
      {
        dir: '/root/runs/demo-1/decisions',
        files: [
          { name: '0001-delegation.json', content: JSON.stringify({ delegated_to: 'fable-5', signed_at: '2026-08-05T00:00:00.000Z' }) },
          { name: '0002-delegation.json', content: JSON.stringify({ delegated_to: 'fable-5', signed_at: '2026-01-01T00:00:00.000Z' }) } // поза періодом
        ]
      }
    ]
    const result = delegationDepth({
      mandates: MANDATES,
      decisionsDirs,
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: NOW()
    })
    expect(result).toEqual({ modelOwnedDecisionTypes: 1, delegationsInPeriod: 1 })
  })
})

describe('candorDeliveredCount', () => {
  it('агрегує КІЛЬКІСТЬ по всіх person-owner, у межах періоду, без вмісту', async () => {
    const record = { from_model: 'fable-5', statement: 'x', audacity_level: 'low', created_at: '2026-08-05T00:00:00.000Z' }
    const oldRecord = { ...record, created_at: '2026-01-01T00:00:00.000Z' }
    const io = memoryIo({
      '/root/.mt/candor/olena.jsonl': `${JSON.stringify(record)}\n${JSON.stringify(oldRecord)}\n`,
      '/root/.mt/candor/vitalii.jsonl': `${JSON.stringify(record)}\n`
    })
    const count = await candorDeliveredCount({
      io,
      mandatesDir: '/root',
      mandates: MANDATES,
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: NOW()
    })
    expect(count).toBe(2) // 1 (olena, у межах) + 1 (vitalii) — старий запис olena поза вікном
  })
})

describe('killSwitchActivationsCount', () => {
  it('рахує ЛИШЕ action: on, у межах періоду', async () => {
    const io = memoryIo({
      '/root/.mt/kill-switch/log.jsonl':
        `${JSON.stringify({ handle: 'olena', action: 'on', at: '2026-08-05T00:00:00.000Z' })}\n` +
        `${JSON.stringify({ handle: 'olena', action: 'off', at: '2026-08-06T00:00:00.000Z' })}\n` +
        `${JSON.stringify({ handle: 'olena', action: 'on', at: '2026-01-01T00:00:00.000Z' })}\n`
    })
    const count = await killSwitchActivationsCount({ io, mandatesDir: '/root', periodStart: new Date('2026-08-01T00:00:00.000Z'), periodEnd: NOW() })
    expect(count).toBe(1)
  })

  it('немає логу — 0', async () => {
    const io = memoryIo()
    expect(await killSwitchActivationsCount({ io, mandatesDir: '/root', periodStart: new Date(0), periodEnd: NOW() })).toBe(0)
  })
})

describe('deriveBoundaryMoves', () => {
  const oldFile = { generation: 3, mandates: MANDATES }
  const newFile = {
    generation: 4,
    mandates: MANDATES.map(m => (m.owner === 'fable-5' ? { ...m, thresholds: { ...m.thresholds, audacity: 'high' } } : m))
  }

  it('застосований (маркер у вікні) mandate-change — рух межі з diffLines', () => {
    const decisionsDirs = [
      {
        dir: '/root/runs/mandate-change-demo-1/decisions',
        files: [
          { name: '0001-change.json', content: JSON.stringify({ old: oldFile, new: newFile }) },
          { name: '0001-applied.json', content: JSON.stringify({ appliedAt: '2026-08-05T00:00:00.000Z', handle: 'olena', role: 'human' }) }
        ]
      }
    ]
    const moves = deriveBoundaryMoves({ decisionsDirs, periodStart: new Date('2026-08-01T00:00:00.000Z'), periodEnd: NOW() })
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ owner: 'fable-5', kind: 'widened', delegatorHandle: 'olena' })
    expect(moves[0].diffLines.some(l => l.includes('audacity'))).toBe(true)
  })

  it('без 0001-applied.json (лише decision-request/change.json, ще не підписано) — не рахується', () => {
    const decisionsDirs = [
      { dir: '/root/runs/mandate-change-demo-1/decisions', files: [{ name: '0001-change.json', content: JSON.stringify({ old: oldFile, new: newFile }) }] }
    ]
    expect(deriveBoundaryMoves({ decisionsDirs, periodStart: new Date(0), periodEnd: NOW() })).toEqual([])
  })

  it('applied поза вікном періоду — не рахується', () => {
    const decisionsDirs = [
      {
        dir: '/root/runs/mandate-change-demo-1/decisions',
        files: [
          { name: '0001-change.json', content: JSON.stringify({ old: oldFile, new: newFile }) },
          { name: '0001-applied.json', content: JSON.stringify({ appliedAt: '2026-01-01T00:00:00.000Z', handle: 'olena', role: 'human' }) }
        ]
      }
    ]
    expect(deriveBoundaryMoves({ decisionsDirs, periodStart: new Date('2026-08-01T00:00:00.000Z'), periodEnd: NOW() })).toEqual([])
  })

  it('звичайний run (не mandate-change-*) — ігнорується', () => {
    const decisionsDirs = [
      {
        dir: '/root/runs/demo-1/decisions',
        files: [
          { name: '0001-change.json', content: JSON.stringify({ old: oldFile, new: newFile }) },
          { name: '0001-applied.json', content: JSON.stringify({ appliedAt: '2026-08-05T00:00:00.000Z', handle: 'olena', role: 'human' }) }
        ]
      }
    ]
    expect(deriveBoundaryMoves({ decisionsDirs, periodStart: new Date('2026-08-01T00:00:00.000Z'), periodEnd: NOW() })).toEqual([])
  })
})

describe('buildDeltaReport / formatDeltaReportMarkdown — детермінізм', () => {
  it('той самий вхід → байт-у-байт той самий markdown', async () => {
    const io = memoryIo({ '/root/.mt/org.json': '{"hourly_rate_eur": 50}' })
    const mandatesFile = { generation: 3, mandates: MANDATES }
    const decisionsDirs = [
      {
        dir: '/root/runs/demo-1/decisions',
        files: [
          { name: '0001-decision-request.md', content: soloDecisionRequest() },
          { name: '0001-approval.json', content: JSON.stringify({ chosen_option: 'A', signed_at: '2026-08-05T00:00:00.000Z' }) },
          { name: '0001-quiz.md', content: quizFile(600) }
        ]
      }
    ]
    const report1 = await buildDeltaReport({ io, mandatesDir: '/root', mandatesFile, decisionsDirs, periodDays: 14, now: NOW })
    const report2 = await buildDeltaReport({ io, mandatesDir: '/root', mandatesFile, decisionsDirs, periodDays: 14, now: NOW })
    expect(formatDeltaReportMarkdown(report1)).toBe(formatDeltaReportMarkdown(report2))
    expect(report1.gateCostEur).toBeCloseTo((600 / 3600) * 50, 1) // округлено до центів (Math.round(...*100)/100)
    expect(report1.hourlyRateEur).toBe(50)
    expect(report1.decisions.total).toBe(1)
  })

  it('markdown несе секції задачі й НЕ несе приватного вмісту (лише count)', async () => {
    const io = memoryIo({
      '/root/.mt/candor/olena.jsonl': `${JSON.stringify({ from_model: 'fable-5', statement: 'ДУЖЕ ПРИВАТНЕ', audacity_level: 'low', created_at: '2026-08-05T00:00:00.000Z' })}\n`
    })
    const mandatesFile = { generation: 3, mandates: MANDATES }
    const report = await buildDeltaReport({ io, mandatesDir: '/root', mandatesFile, decisionsDirs: [], periodDays: 14, now: NOW })
    const markdown = formatDeltaReportMarkdown(report)
    expect(markdown).toContain('## Рух межі')
    expect(markdown).toContain('## Рішення за період')
    expect(markdown).toContain('## Ціна гейта')
    expect(markdown).toContain('## Глибина делегування')
    expect(markdown).toContain('## Агреговано (без приватного)')
    expect(markdown).not.toContain('ДУЖЕ ПРИВАТНЕ')
    expect(report.candorDelivered).toBe(1)
  })
})

describe('reportPath', () => {
  it('.mt/reports/YYYY-MM-DD-delta.md', () => {
    expect(reportPath('/root', '2026-08-09T10:00:00.000Z')).toBe('/root/.mt/reports/2026-08-09-delta.md')
  })
})

describe('deltaReport — повний потік', () => {
  it('пише файл за reportPath, повертає markdown + модель', async () => {
    const io = memoryIo()
    const mandatesFile = { generation: 3, mandates: MANDATES }
    const result = await deltaReport({ io, mandatesDir: '/root', mandatesFile, decisionsDirs: [], periodDays: 7, now: NOW })
    expect(result.path).toBe('/root/.mt/reports/2026-08-09-delta.md')
    expect(io.store.get(result.path)).toBe(result.markdown)
  })
})
