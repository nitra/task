import { describe, expect, it } from 'vitest'
import {
  defaultReviewConfig,
  draftWidenCandidates,
  formatReviewAgendaMarkdown,
  materializeWidenProposals,
  narrowCandidates,
  openDisputes,
  reviewAgenda,
  reviewAgendaPath
} from '../review.js'
import { generateDeviceKeypair } from '../signing.js'

const NOW = () => new Date('2026-08-09T10:00:00.000Z')

const MANDATES = [
  { owner: 'fable-5', kind: 'model', scope: { refs: ['refs/mt/tasks/routine/**'], decisionTypes: ['ops'] }, thresholds: { budgetEur: 200, risk: 'low', irreversible: false, audacity: 'medium' }, escalatesTo: 'olena' },
  { owner: 'olena', kind: 'person', scope: { refs: ['refs/mt/tasks/design/**'], decisionTypes: ['architecture'] }, thresholds: { budgetEur: 2000, risk: 'medium', irreversible: false, audacity: null }, escalatesTo: 'vitalii' },
  { owner: 'vitalii', kind: 'person', scope: { refs: ['refs/mt/**'], decisionTypes: ['*'] }, thresholds: { budgetEur: null, risk: null, irreversible: null, audacity: null }, escalatesTo: null }
]

const DEVICE_REGISTRY = [] // deriveTrackRecord потребує атрибуцію pubkey → handle/role

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

/**
 * Будує N закритих model-рішень fable-5 у period, з device-registry
 * атрибуцією (той самий підхід, що track-record.test.js) — потрібно для
 * {@link import('../track-record.js').deriveTrackRecord}.
 * @param {number} count кількість рішень
 * @param {string} modelPubkey base64 pubkey моделі (зареєстрований у deviceRegistry)
 * @returns {{dir: string, files: {name: string, content: string}[]}} одна decisions-директорія
 */
function modelDecisionsDir(count, modelPubkey) {
  const files = []
  for (let i = 1; i <= count; i += 1) {
    const nnnn = String(i).padStart(4, '0')
    files.push(
      {
        name: `${nnnn}-decision-request.md`,
        content: ['---', 'type: decision-request', 'computed_owner: fable-5', 'leverage_facets: { irreversible: false, blast_radius: node }', 'decision_type: ops', '---', '## Контекст', 'x'].join('\n')
      },
      { name: `${nnnn}-approval.json`, content: JSON.stringify({ chosen_option: 'A', signed_at: '2026-08-05T00:00:00.000Z', pubkey: modelPubkey }) }
    )
  }
  return { dir: '/root/runs/demo-1/decisions', files }
}

describe('defaultReviewConfig', () => {
  it('widenThreshold: 5, staleDays: 7', () => {
    expect(defaultReviewConfig()).toEqual({ widenThreshold: 5, staleDays: 7 })
  })
})

describe('draftWidenCandidates', () => {
  it('модель з 5+ рішень без override — кандидат', async () => {
    const modelKey = await generateDeviceKeypair()
    const deviceRegistry = [{ handle: 'fable-5', role: 'model', pubkeyBase64: modelKey.publicKeyBase64 }]
    const decisionsDirs = [modelDecisionsDir(5, modelKey.publicKeyBase64)]
    const candidates = draftWidenCandidates({
      mandates: MANDATES,
      decisionsDirs,
      deviceRegistry,
      killSwitchActiveHandles: new Set(),
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: NOW()
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ modelHandle: 'fable-5', delegatorHandle: 'olena', overrideFreeInPeriod: 5 })
  })

  it('менше порогу — не кандидат', async () => {
    const modelKey = await generateDeviceKeypair()
    const deviceRegistry = [{ handle: 'fable-5', role: 'model', pubkeyBase64: modelKey.publicKeyBase64 }]
    const decisionsDirs = [modelDecisionsDir(3, modelKey.publicKeyBase64)]
    expect(
      draftWidenCandidates({
        mandates: MANDATES,
        decisionsDirs,
        deviceRegistry,
        killSwitchActiveHandles: new Set(),
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: NOW()
      })
    ).toEqual([])
  })

  it('делегатор з активним kill-switch — НЕ кандидат, навіть з достатньою активністю', async () => {
    const modelKey = await generateDeviceKeypair()
    const deviceRegistry = [{ handle: 'fable-5', role: 'model', pubkeyBase64: modelKey.publicKeyBase64 }]
    const decisionsDirs = [modelDecisionsDir(5, modelKey.publicKeyBase64)]
    expect(
      draftWidenCandidates({
        mandates: MANDATES,
        decisionsDirs,
        deviceRegistry,
        killSwitchActiveHandles: new Set(['olena']),
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: NOW()
      })
    ).toEqual([])
  })
})

describe('narrowCandidates', () => {
  it('активний kill-switch делегатора — кандидат на звуження, навіть без override', async () => {
    const modelKey = await generateDeviceKeypair()
    const deviceRegistry = [{ handle: 'fable-5', role: 'model', pubkeyBase64: modelKey.publicKeyBase64 }]
    const decisionsDirs = [modelDecisionsDir(1, modelKey.publicKeyBase64)]
    const candidates = narrowCandidates({
      mandates: MANDATES,
      decisionsDirs,
      deviceRegistry,
      killSwitchActiveHandles: new Set(['olena']),
      periodStart: new Date('2026-08-01T00:00:00.000Z'),
      periodEnd: NOW()
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ modelHandle: 'fable-5', delegatorHandle: 'olena', delegatorKillSwitchActive: true })
  })

  it('немає override-ів і kill-switch неактивний — порожньо', () => {
    expect(
      narrowCandidates({ mandates: MANDATES, decisionsDirs: [], deviceRegistry: DEVICE_REGISTRY, killSwitchActiveHandles: new Set(), periodStart: new Date(0), periodEnd: NOW() })
    ).toEqual([])
  })
})

describe('openDisputes', () => {
  it('розбіжність кворуму (diverged) — потрапляє в diverged', () => {
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
          { name: '0001-approval-vitalii.json', content: JSON.stringify({ chosen_option: 'B', signed_at: '2026-08-06T00:00:00.000Z' }) }
        ]
      }
    ]
    const { diverged, stale } = openDisputes({ decisionsDirs, now: NOW() })
    expect(diverged).toHaveLength(1)
    expect(stale).toEqual([])
  })

  it('застаріла відкрита розвилка (>= staleDays) — потрапляє в stale', () => {
    const request = [
      '---',
      'type: decision-request',
      'computed_owner: olena',
      'leverage_facets: { irreversible: false, blast_radius: node }',
      'decision_type: architecture',
      'opened_at: "2026-07-01T00:00:00.000Z"',
      '---',
      '## Контекст',
      'x'
    ].join('\n')
    const decisionsDirs = [{ dir: '/root/runs/demo-1/decisions', files: [{ name: '0001-decision-request.md', content: request }] }]
    const { stale } = openDisputes({ decisionsDirs, now: NOW(), staleDays: 7 })
    expect(stale).toHaveLength(1)
    expect(stale[0]).toMatchObject({ nnnn: '0001', computedOwner: 'olena' })
  })
})

describe('materializeWidenProposals', () => {
  it('матеріалізує change-proposal для кожного кандидата (ai_petition-патерн)', async () => {
    const io = memoryIo()
    const modelKey = await generateDeviceKeypair()
    const mandatesFile = { generation: 3, mandates: MANDATES }
    const candidates = [{ modelHandle: 'fable-5', delegatorHandle: 'olena', decisionsInPeriod: 5, overrideFreeInPeriod: 5 }]
    const registered = []
    const created = await materializeWidenProposals({
      io,
      mandatesDir: '/root',
      mandatesFile,
      candidates,
      loadModelDeviceKey: () => modelKey,
      registerDevice: device => { registered.push(device) },
      decisionsDirs: [],
      deviceRegistry: [],
      now: NOW
    })
    expect(created).toHaveLength(1)
    expect(created[0].changeId).toBe('review-3-fable-5')
    expect(io.store.has(created[0].decisionRequestPath)).toBe(true)
    expect(registered).toEqual([{ handle: 'fable-5', role: 'model', pubkeyBase64: modelKey.publicKeyBase64 }])

    // computed_owner делегатора — decision-request у ЙОГО черзі (change-proposal-flow M3).
    const markdown = io.store.get(created[0].decisionRequestPath)
    expect(markdown).toContain('computed_owner: olena')
  })

  it('кандидат без делегатора (корінь) — пропускається', async () => {
    const io = memoryIo()
    const mandatesFile = { generation: 3, mandates: MANDATES }
    const candidates = [{ modelHandle: 'vitalii', delegatorHandle: null, decisionsInPeriod: 5, overrideFreeInPeriod: 5 }]
    const created = await materializeWidenProposals({
      io,
      mandatesDir: '/root',
      mandatesFile,
      candidates,
      loadModelDeviceKey: () => ({}),
      decisionsDirs: [],
      deviceRegistry: [],
      now: NOW
    })
    expect(created).toEqual([])
  })
})

describe('formatReviewAgendaMarkdown', () => {
  it('несе всі три секції', () => {
    const markdown = formatReviewAgendaMarkdown({
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-08-09T10:00:00.000Z',
      widenCandidates: [],
      materialized: [],
      narrowCandidates: [],
      disputes: { diverged: [], stale: [] }
    })
    expect(markdown).toContain('## Draft-пропозиції розширення')
    expect(markdown).toContain('## Кандидати на звуження')
    expect(markdown).toContain('## Відкриті розбіжності й застарілі розвилки')
  })
})

describe('reviewAgendaPath', () => {
  it('.mt/reviews/YYYY-MM-DD-agenda.md', () => {
    expect(reviewAgendaPath('/root', '2026-08-09T10:00:00.000Z')).toBe('/root/.mt/reviews/2026-08-09-agenda.md')
  })
})

describe('reviewAgenda — повний потік', () => {
  it('пише файл, кандидат розширення матеріалізується автоматично', async () => {
    const io = memoryIo()
    const modelKey = await generateDeviceKeypair()
    const deviceRegistry = [{ handle: 'fable-5', role: 'model', pubkeyBase64: modelKey.publicKeyBase64 }]
    const mandatesFile = { generation: 3, mandates: MANDATES }
    const decisionsDirs = [modelDecisionsDir(5, modelKey.publicKeyBase64)]
    const registered = []

    const result = await reviewAgenda({
      io,
      mandatesDir: '/root',
      mandatesFile,
      decisionsDirs,
      deviceRegistry,
      killSwitchActiveHandles: new Set(),
      loadModelDeviceKey: () => modelKey,
      registerDevice: device => { registered.push(device) },
      periodDays: 14,
      now: NOW
    })

    expect(result.widenCandidates).toHaveLength(1)
    expect(result.materialized).toHaveLength(1)
    expect(io.store.has(result.path)).toBe(true)
    expect(result.markdown).toContain('fable-5')
    expect(result.markdown).toContain('чернетка готова')
    expect(registered).toEqual([{ handle: 'fable-5', role: 'model', pubkeyBase64: modelKey.publicKeyBase64 }])
  })
})
