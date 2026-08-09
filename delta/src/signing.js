// Ed25519-підпис пристрою — mt: docs/architecture/access.md («Кожен пристрій
// має Ed25519 keypair») + docs/architecture/mandates.md «Розширення
// ApprovalResponse». access.md фіксує ЩО підписується (кортеж полів), але не
// фіксує байтовий формат серіалізації — канонікалізація нижче є власним
// рішенням цього застосунку (задокументоване, як просить
// docs/specs/260809-delta-app.md, «Обсяг M1», п.5).
//
// Реалізація — Web Crypto (`crypto.subtle`, алгоритм `'Ed25519'`), не
// `node:crypto`-специфічний API: той самий код виконується і в CLI (Bun,
// повний `node:crypto`/webcrypto), і в GUI-фронтенді (Tauri-вебвʼю — Vite
// компілює фронтенд у браузерне середовище, де `node:crypto` недоступний, а
// `crypto.subtle` — стандартний глобал). Це «та сама JS-логіка через
// існуючий транспорт», яку M0 уже показав на читанні файлів: Rust лишається
// тонким fs-шаром (читає/пише сирі байти пристрій-ключа), уся крипто-логіка
// — тут, спільна для обох поверхонь.
//
// Приватний ключ пристрою генерується при першому підписі й зберігається
// поза git — файл-сусід `config.json` застосунку (`device_key.json`),
// власним ключем цього модуля (JWK), не зашифрований додатково (той самий
// рівень довіри, що keystore застосунку — ОС-права на каталог
// `appLocalDataDir`; апаратний keystore — поза обсягом M1).

const CANONICAL_ALGORITHM = { name: 'Ed25519' }

/**
 * Канонічна серіалізація обʼєкта для підпису: рекурсивне сортування ключів
 * (не значень масивів — порядок масиву семантичний), компактний JSON без
 * пробілів. Підписант і перевіряч мусять отримати побайтово ідентичний
 * результат із того самого логічного обʼєкта незалежно від порядку
 * побудови полів у JS-коді, що його створив.
 * @param {unknown} value значення для канонікалізації
 * @returns {string} канонічний JSON-рядок
 */
export function canonicalize(value) {
  return JSON.stringify(sortKeysDeep(value))
}

/**
 * @param {unknown} value довільне значення
 * @returns {unknown} те саме значення з рекурсивно відсортованими ключами обʼєктів
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(item => sortKeysDeep(item))
  if (value && typeof value === 'object') {
    const sorted = {}
    for (const key of Object.keys(value).toSorted()) sorted[key] = sortKeysDeep(value[key])
    return sorted
  }
  return value
}

// `Uint8Array.prototype.toBase64`/`Uint8Array.fromBase64` — Node 24+ API
// (M1-баг знайдено на рев'ю: ризик несумісності з WKWebView у Tauri GUI,
// де рушій може відставати від найновішого V8/Node). Feature-detect тут —
// одна спільна утиліта для обох поверхонь (CLI/GUI), а не два окремі шляхи:
// пріоритет — нативний метод (найшвидший, коли є); далі `Buffer` (завжди є
// в CLI/Bun, у GUI відсутній); останній шлях — `btoa`/`atob` через
// побайтовий рядок (стандартний браузерний глобал, завжди є у WKWebView).

/**
 * @param {Uint8Array|ArrayBuffer} bytes сирі байти
 * @returns {string} base64
 */
function base64FromBytes(bytes) {
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes
  if (typeof arr.toBase64 === 'function') return arr.toBase64()
  if (typeof Buffer !== 'undefined') return Buffer.from(arr).toString('base64')
  let binary = ''
  for (const byte of arr) binary += String.fromCodePoint(byte)
  return btoa(binary)
}

/**
 * @param {string} base64 base64-рядок
 * @returns {Uint8Array} сирі байти
 */
function bytesFromBase64(base64) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(base64)
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(base64, 'base64'))
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.codePointAt(i)
  return bytes
}

/**
 * Генерує новий Ed25519-keypair пристрою.
 * @returns {Promise<{publicKeyJwk: object, privateKeyJwk: object, publicKeyBase64: string}>} новий keypair у портативному вигляді
 */
export async function generateDeviceKeypair() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(CANONICAL_ALGORITHM, true, ['sign', 'verify'])
  const [publicKeyJwk, privateKeyJwk, rawPublic] = await Promise.all([
    crypto.subtle.exportKey('jwk', publicKey),
    crypto.subtle.exportKey('jwk', privateKey),
    crypto.subtle.exportKey('raw', publicKey)
  ])
  return { publicKeyJwk, privateKeyJwk, publicKeyBase64: base64FromBytes(rawPublic) }
}

/**
 * Завантажує ключ пристрою з тексту файлу, або генерує новий, якщо файл
 * відсутній/битий. Транспорт (CLI/GUI) відповідає за персист результату,
 * коли `created: true` — цей модуль fs не торкається.
 * @param {string|null|undefined} existingJsonText сирий вміст `device_key.json`, якщо є
 * @returns {Promise<{publicKeyJwk: object, privateKeyJwk: object, publicKeyBase64: string, createdAt: string, created: boolean}>} ключ пристрою
 */
export async function loadOrCreateDeviceKey(existingJsonText) {
  const text = (existingJsonText ?? '').trim()
  if (text) {
    try {
      const parsed = JSON.parse(text)
      if (parsed?.privateKeyJwk && parsed.publicKeyJwk && parsed.publicKeyBase64) {
        return { ...parsed, created: false }
      }
    } catch {
      // битий файл — регенеруємо нижче, той самий шлях, що відсутній файл
    }
  }
  const keypair = await generateDeviceKeypair()
  return { ...keypair, createdAt: new Date().toISOString(), created: true }
}

/**
 * Немає власного `await` (обидва шляхи повертають значення/проміс напряму) —
 * навмисно НЕ `async`, викликачі все одно `await`-ять результат.
 * @param {CryptoKey|object} privateKeyOrJwk `CryptoKey` або JWK приватного ключа
 * @returns {Promise<CryptoKey>|CryptoKey} імпортований `CryptoKey` для підпису
 */
function resolvePrivateKey(privateKeyOrJwk) {
  if (privateKeyOrJwk instanceof CryptoKey) return privateKeyOrJwk
  return crypto.subtle.importKey('jwk', privateKeyOrJwk, CANONICAL_ALGORITHM, true, ['sign'])
}

/**
 * Немає власного `await` — той самий підхід, що `resolvePrivateKey`.
 * @param {CryptoKey|object|string} publicKeyOrJwkOrBase64 `CryptoKey`, JWK, або base64 raw-публічний ключ
 * @returns {Promise<CryptoKey>|CryptoKey} імпортований `CryptoKey` для перевірки
 */
function resolvePublicKey(publicKeyOrJwkOrBase64) {
  if (publicKeyOrJwkOrBase64 instanceof CryptoKey) return publicKeyOrJwkOrBase64
  if (typeof publicKeyOrJwkOrBase64 === 'string') {
    return crypto.subtle.importKey('raw', bytesFromBase64(publicKeyOrJwkOrBase64), CANONICAL_ALGORITHM, true, [
      'verify'
    ])
  }
  return crypto.subtle.importKey('jwk', publicKeyOrJwkOrBase64, CANONICAL_ALGORITHM, true, ['verify'])
}

/**
 * Підписує канонікалізований payload приватним ключем пристрою.
 * @param {CryptoKey|object} privateKeyOrJwk приватний ключ (`CryptoKey` або JWK)
 * @param {object} payload обʼєкт для підпису (канонікалізується перед підписом)
 * @returns {Promise<string>} base64-підпис
 */
export async function signPayload(privateKeyOrJwk, payload) {
  const key = await resolvePrivateKey(privateKeyOrJwk)
  const bytes = new TextEncoder().encode(canonicalize(payload))
  const signature = await crypto.subtle.sign(CANONICAL_ALGORITHM, key, bytes)
  return base64FromBytes(signature)
}

/**
 * Перевіряє підпис payload проти публічного ключа.
 * @param {CryptoKey|object|string} publicKeyOrJwkOrBase64 публічний ключ
 * @param {object} payload підписаний обʼєкт (канонікалізується так само, як при підписі)
 * @param {string} signatureBase64 base64-підпис
 * @returns {Promise<boolean>} true — підпис валідний
 */
export async function verifyPayload(publicKeyOrJwkOrBase64, payload, signatureBase64) {
  const key = await resolvePublicKey(publicKeyOrJwkOrBase64)
  const bytes = new TextEncoder().encode(canonicalize(payload))
  return crypto.subtle.verify(CANONICAL_ALGORITHM, key, bytesFromBase64(signatureBase64), bytes)
}
