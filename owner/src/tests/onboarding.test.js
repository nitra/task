import { beforeEach, describe, expect, it } from 'vitest'
import { isOnboarded, markOnboarded } from '../onboarding.js'

describe('onboarding flag', () => {
  beforeEach(() => {
    globalThis.localStorage?.removeItem('owner:onboarded')
  })

  it('до першого mark — не onboarded, після — так', () => {
    expect(isOnboarded()).toBe(false)
    markOnboarded()
    expect(isOnboarded()).toBe(true)
  })
})
