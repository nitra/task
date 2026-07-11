import { describe, expect, it } from 'vitest'
import { LENSES, childrenToYaml, parseAlternative, plannerPrompt, validNodeId } from '../planner.js'

const REPLY = JSON.stringify({
  context: 'Зробити лендинг',
  risks: '- дизайн затягнеться',
  children: [
    { id: 'design', mode: 'human', qualification: 'дизайнер', deps: [], task: 'Намалювати макет' },
    { id: 'build', mode: 'agent', model_tier: 'AVG', budget_sec: 1800, deps: ['design'], task: 'Зверстати\nза макетом' }
  ]
})

describe('plannerPrompt', () => {
  it('дві різні лінзи, ціль у user, схема в system', () => {
    expect(LENSES).toHaveLength(2)
    const [lean, thorough] = LENSES.map(lens => plannerPrompt('Ціль', lens))
    expect(lean.user).toBe('Ціль')
    expect(lean.system).not.toBe(thorough.system)
    expect(lean.system).toContain('JSON')
  })
})

describe('parseAlternative', () => {
  it('розбирає валідну відповідь (навіть у markdown-обгортці)', () => {
    const alt = parseAlternative('```json\n' + REPLY + '\n```')
    const kids = alt.children
    expect(kids).toHaveLength(2)
    expect(kids.at(1).deps).toEqual(['design'])
  })

  it('відхиляє: без JSON, порожні children, битий mode, невідомий dep, дубль id', () => {
    expect(() => parseAlternative('немає обʼєкта')).toThrow('без JSON')
    expect(() => parseAlternative('{"children": []}')).toThrow('жодної')
    expect(() => parseAlternative('{"children": [{"id": "a", "mode": "robot", "task": "x"}]}')).toThrow('mode')
    expect(() =>
      parseAlternative('{"children": [{"id": "a", "mode": "agent", "deps": ["ghost"], "task": "x"}]}')
    ).toThrow('ghost')
    expect(() =>
      parseAlternative(
        '{"children": [{"id": "a", "mode": "agent", "task": "x"}, {"id": "a", "mode": "human", "task": "y"}]}'
      )
    ).toThrow('дубль')
  })
})

describe('validNodeId', () => {
  it('kebab-case латиницею, без «/» і кирилиці', () => {
    expect(validNodeId('landing-q4')).toBe(true)
    expect(validNodeId('a/b')).toBe(false)
    expect(validNodeId('Ціль')).toBe(false)
    expect(validNodeId('')).toBe(false)
  })
})

describe('childrenToYaml', () => {
  it('серіалізує у формат, який читає mt-core parse_children', () => {
    const yaml = childrenToYaml(parseAlternative(REPLY).children)
    expect(yaml).toBe(
      [
        'children:',
        '  - id: design',
        '    mode: human',
        '    qualification: дизайнер',
        '    deps: []',
        '    task: |',
        '      Намалювати макет',
        '  - id: build',
        '    mode: agent',
        '    model_tier: AVG',
        '    budget_sec: 1800',
        '    deps: [design]',
        '    task: |',
        '      Зверстати',
        '      за макетом',
        ''
      ].join('\n')
    )
  })
})
