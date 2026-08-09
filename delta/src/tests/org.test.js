import { describe, expect, it } from 'vitest'
import { defaultOrgConfig, formatOrgConfig, loadOrgConfig, orgConfigPath, parseOrgConfig } from '../org.js'

describe('orgConfigPath', () => {
  it('.mt/org.json — комітиться в git (не PII)', () => {
    expect(orgConfigPath('/root')).toBe('/root/.mt/org.json')
  })
})

describe('defaultOrgConfig / parseOrgConfig', () => {
  it('дефолт — 60 €/год', () => {
    expect(defaultOrgConfig()).toEqual({ hourlyRateEur: 60 })
  })

  it('відсутній/порожній файл — дефолт', () => {
    expect(parseOrgConfig(null)).toEqual({ hourlyRateEur: 60 })
    expect(parseOrgConfig('')).toEqual({ hourlyRateEur: 60 })
  })

  it('битий JSON — дефолт, не кидає', () => {
    expect(parseOrgConfig('not json')).toEqual({ hourlyRateEur: 60 })
  })

  it('валідне число — використовується', () => {
    expect(parseOrgConfig('{"hourly_rate_eur": 80}')).toEqual({ hourlyRateEur: 80 })
  })

  it('невалідне (не число / ≤0) значення — дефолт', () => {
    expect(parseOrgConfig('{"hourly_rate_eur": "80"}')).toEqual({ hourlyRateEur: 60 })
    expect(parseOrgConfig('{"hourly_rate_eur": 0}')).toEqual({ hourlyRateEur: 60 })
    expect(parseOrgConfig('{"hourly_rate_eur": -5}')).toEqual({ hourlyRateEur: 60 })
  })
})

describe('formatOrgConfig', () => {
  it('round-trip з parseOrgConfig', () => {
    const text = formatOrgConfig({ hourlyRateEur: 75 })
    expect(parseOrgConfig(text)).toEqual({ hourlyRateEur: 75 })
  })
})

describe('loadOrgConfig', () => {
  it('читає через io, дефолт коли файл відсутній', async () => {
    const io = { readFile: () => null }
    expect(await loadOrgConfig(io, '/root')).toEqual({ hourlyRateEur: 60 })
  })

  it('читає налаштоване значення', async () => {
    const io = { readFile: path => (path === '/root/.mt/org.json' ? '{"hourly_rate_eur": 45}' : null) }
    expect(await loadOrgConfig(io, '/root')).toEqual({ hourlyRateEur: 45 })
  })
})
