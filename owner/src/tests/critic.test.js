import { describe, expect, it } from 'vitest'
import { criticPrompt, parseCriticReply, runDeterministicCritic } from '../critic.js'

const WS = { label: 'demo', path: '/demo/mt' }
const NOW = Date.parse('2026-07-12T00:00:00Z')

/**
 * Вузол дерева scan для фікстур критика.
 * @param {string} path шлях вузла
 * @param {string} state стан
 * @param {object} [extra] додаткові поля (deps, deadline, created_at, children)
 * @returns {object} вузол
 */
function node(path, state, extra = {}) {
  return { path, state, deps: [], children: [], ...extra }
}

describe('runDeterministicCritic', () => {
  it('дедлайн минув → вердикт; майбутній чи resolved — ні', () => {
    const forest = {
      '/demo/mt': [
        node('late', 'waiting', { deadline: '2026-07-01T00:00:00Z' }),
        node('future', 'waiting', { deadline: '2026-08-01T00:00:00Z' }),
        node('done', 'resolved', { deadline: '2026-07-01T00:00:00Z' })
      ]
    }
    const verdicts = runDeterministicCritic([WS], forest, NOW)
    expect(verdicts.map(v => v.path)).toEqual(['late'])
    expect(verdicts[0].rule).toBe('deadline-passed')
  })

  it('мертва або неіснуюча залежність → найвища ставка', () => {
    const forest = {
      '/demo/mt': [
        node('dead', 'unresolvable'),
        node('waiter', 'blocked', { deps: ['dead'] }),
        node('ghost-waiter', 'waiting', { deps: ['ghost'] })
      ]
    }
    const verdicts = runDeterministicCritic([WS], forest, NOW)
    const rules = Object.fromEntries(verdicts.map(v => [v.path, v.rule]))
    expect(rules).toEqual({ waiter: 'dead-dependency', 'ghost-waiter': 'dead-dependency' })
    expect(verdicts.every(v => v.stake === 0)).toBe(true)
  })

  it('deps резолвляться відносно батька (сусіди у піддереві)', () => {
    const forest = {
      '/demo/mt': [
        node('root', 'spawned', {
          children: [node('root/dead', 'failed'), node('root/waiter', 'waiting', { deps: ['dead'] })]
        })
      ]
    }
    const verdicts = runDeterministicCritic([WS], forest, NOW)
    expect(verdicts.map(v => [v.path, v.rule])).toEqual([['root/waiter', 'dead-dependency']])
  })

  it('цикл взаємного очікування знайдено один раз', () => {
    const forest = {
      '/demo/mt': [node('a', 'blocked', { deps: ['b'] }), node('b', 'blocked', { deps: ['a'] })]
    }
    const verdicts = runDeterministicCritic([WS], forest, NOW)
    const cycles = verdicts.filter(v => v.rule === 'dependency-cycle')
    expect(cycles).toHaveLength(1)
    expect(cycles[0].finding).toContain('→')
  })

  it('гілка без прогресу довше тижня → stale-branch; свіжа чи pending — ні', () => {
    const forest = {
      '/demo/mt': [
        node('old', 'waiting', { created_at: '2026-06-20T00:00:00Z' }),
        node('orphan', 'unassigned', { created_at: '2026-06-07T00:00:00Z' }),
        node('fresh', 'waiting', { created_at: '2026-07-10T00:00:00Z' }),
        node('mine', 'pending', { created_at: '2026-06-01T00:00:00Z' }),
        node('parent', 'spawned', { created_at: '2026-06-01T00:00:00Z', children: [node('parent/x', 'running')] })
      ]
    }
    const verdicts = runDeterministicCritic([WS], forest, NOW)
    expect(verdicts.map(v => v.path).toSorted()).toEqual(['old', 'orphan'])
    expect(verdicts.find(v => v.path === 'orphan').finding).toContain('виконавця так і не призначено')
  })

  it('чистий граф → без вердиктів', () => {
    const forest = { '/demo/mt': [node('ok', 'running', { created_at: '2026-07-11T00:00:00Z' })] }
    expect(runDeterministicCritic([WS], forest, NOW)).toEqual([])
  })
})

describe('parseCriticReply', () => {
  it('розбирає валідні вердикти і відкидає сміття', () => {
    const reply = '```json\n[{"path": "a", "severity": 1, "finding": "дубль із b"}, {"finding": ""}, {"path": 5}]\n```'
    const verdicts = parseCriticReply(reply, WS)
    expect(verdicts).toEqual([{ workspace: WS, path: 'a', rule: 'semantic', finding: 'дубль із b', stake: 1 }])
  })

  it('без JSON-масиву чи з битим JSON → порожньо, без винятків', () => {
    expect(parseCriticReply('нічого не знайшов', WS)).toEqual([])
    expect(parseCriticReply('[{"path": broken', WS)).toEqual([])
  })
})

describe('criticPrompt', () => {
  it('система забороняє оцінку людей і вимагає JSON-масив', () => {
    const { system, user } = criticPrompt('дайджест')
    expect(system).toContain('НЕ оцінюй людей')
    expect(system).toContain('JSON-масивом')
    expect(user).toBe('дайджест')
  })
})
