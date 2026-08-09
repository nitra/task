import { describe, expect, it } from 'vitest'
import { canonicalize, generateDeviceKeypair, loadOrCreateDeviceKey, signPayload, verifyPayload } from '../signing.js'

const WHITESPACE_RE = /\s/

describe('canonicalize', () => {
  it('сортує ключі обʼєкта рекурсивно незалежно від порядку побудови', () => {
    const a = canonicalize({ b: 1, a: { d: 2, c: 3 } })
    const b = canonicalize({ a: { c: 3, d: 2 }, b: 1 })
    expect(a).toBe(b)
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('не сортує елементи масивів — порядок масиву семантичний', () => {
    expect(canonicalize({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}')
  })

  it('компактний вихід без зайвих пробілів', () => {
    expect(canonicalize({ x: 1 })).not.toMatch(WHITESPACE_RE)
  })
})

describe('generateDeviceKeypair / signPayload / verifyPayload', () => {
  it('генерує валідний Ed25519 keypair — публічний ключ у base64', async () => {
    const keypair = await generateDeviceKeypair()
    expect(keypair.publicKeyJwk.kty).toBe('OKP')
    expect(keypair.publicKeyJwk.crv).toBe('Ed25519')
    expect(typeof keypair.publicKeyBase64).toBe('string')
    expect(keypair.publicKeyBase64.length).toBeGreaterThan(0)
  })

  it('підпис верифікується проти правильного публічного ключа (JWK)', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateDeviceKeypair()
    const payload = { hello: 'world', n: 42 }
    const signature = await signPayload(privateKeyJwk, payload)
    expect(await verifyPayload(publicKeyJwk, payload, signature)).toBe(true)
  })

  it('підпис верифікується проти публічного ключа у форматі base64 (raw)', async () => {
    const { privateKeyJwk, publicKeyBase64 } = await generateDeviceKeypair()
    const payload = { a: 1 }
    const signature = await signPayload(privateKeyJwk, payload)
    expect(await verifyPayload(publicKeyBase64, payload, signature)).toBe(true)
  })

  it('підпис НЕ верифікується проти чужого публічного ключа', async () => {
    const keypairA = await generateDeviceKeypair()
    const keypairB = await generateDeviceKeypair()
    const payload = { a: 1 }
    const signature = await signPayload(keypairA.privateKeyJwk, payload)
    expect(await verifyPayload(keypairB.publicKeyJwk, payload, signature)).toBe(false)
  })

  it('зміна payload після підпису ламає верифікацію (canonical form реально бере участь у підписі)', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateDeviceKeypair()
    const signature = await signPayload(privateKeyJwk, { a: 1, b: 2 })
    expect(await verifyPayload(publicKeyJwk, { a: 1, b: 3 }, signature)).toBe(false)
  })

  it('порядок побудови полів payload не впливає на підпис (канонікалізація)', async () => {
    const { privateKeyJwk, publicKeyJwk } = await generateDeviceKeypair()
    const signature = await signPayload(privateKeyJwk, { b: 2, a: 1 })
    expect(await verifyPayload(publicKeyJwk, { a: 1, b: 2 }, signature)).toBe(true)
  })
})

describe('base64 round-trip — фолбек без Uint8Array.toBase64/fromBase64 (Node 24+ API, WKWebView-ризик)', () => {
  it('підпис/перевірка round-trip з вимкненим нативним Uint8Array.toBase64/fromBase64 (Buffer-шлях)', async () => {
    const originalToBase64 = Uint8Array.prototype.toBase64
    const originalFromBase64 = Uint8Array.fromBase64
    // eslint-disable-next-line no-undefined -- навмисно знімаємо нативний метод, щоб перевірити фолбек-гілку
    Uint8Array.prototype.toBase64 = undefined
    // eslint-disable-next-line no-undefined
    Uint8Array.fromBase64 = undefined
    try {
      const { privateKeyJwk, publicKeyJwk, publicKeyBase64 } = await generateDeviceKeypair()
      expect(typeof publicKeyBase64).toBe('string')
      expect(publicKeyBase64.length).toBeGreaterThan(0)
      const payload = { a: 1, b: 'фолбек' }
      const signature = await signPayload(privateKeyJwk, payload)
      expect(await verifyPayload(publicKeyJwk, payload, signature)).toBe(true)
      expect(await verifyPayload(publicKeyBase64, payload, signature)).toBe(true)
    } finally {
      Uint8Array.prototype.toBase64 = originalToBase64
      Uint8Array.fromBase64 = originalFromBase64
    }
  })

  it('той самий keypair дає той самий publicKeyBase64 нативним і фолбек-шляхом (побайтова еквівалентність)', async () => {
    const { publicKeyJwk } = await generateDeviceKeypair()
    const nativeKey = await crypto.subtle.importKey('jwk', publicKeyJwk, { name: 'Ed25519' }, true, ['verify'])
    const raw = await crypto.subtle.exportKey('raw', nativeKey)
    const nativeBase64 = new Uint8Array(raw).toBase64()

    const originalToBase64 = Uint8Array.prototype.toBase64
    // eslint-disable-next-line no-undefined
    Uint8Array.prototype.toBase64 = undefined
    let fallbackBase64
    try {
      // Buffer лишається доступним у vitest (Node) — вправляє саме Buffer-гілку фолбеку.
      fallbackBase64 = Buffer.from(new Uint8Array(raw)).toString('base64')
    } finally {
      Uint8Array.prototype.toBase64 = originalToBase64
    }
    expect(fallbackBase64).toBe(nativeBase64)
  })
})

describe('loadOrCreateDeviceKey', () => {
  it('відсутній/порожній текст — генерує новий ключ, created: true', async () => {
    const key = await loadOrCreateDeviceKey('')
    expect(key.created).toBe(true)
    expect(key.privateKeyJwk).toBeDefined()
    expect(key.publicKeyBase64).toBeDefined()
  })

  it('битий JSON — генерує новий ключ замість падіння', async () => {
    const key = await loadOrCreateDeviceKey('{not json')
    expect(key.created).toBe(true)
  })

  it('валідний існуючий ключ — повертає його, created: false', async () => {
    const generated = await generateDeviceKeypair()
    const stored = JSON.stringify({ ...generated, createdAt: '2026-01-01T00:00:00.000Z' })
    const loaded = await loadOrCreateDeviceKey(stored)
    expect(loaded.created).toBe(false)
    expect(loaded.publicKeyBase64).toBe(generated.publicKeyBase64)
  })
})
