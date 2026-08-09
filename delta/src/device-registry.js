// Реєстр публічних ключів пристроїв — мок «pubkey-кешу», на який спирається
// crate мандатів (mt-rust crates/mt-mandates/src/change.rs, docs-коментар:
// «чи pubkey справді належить заявленому handle/ролі — відповідальність
// викликача (pubkey-кеш relay), поза межами цього crate»). Схема й
// розташування — власне розширення M3, контракт (mandates.md, «Нормативний
// контракт (M6 фаза 0)») фіксує ЩО перевіряється (Ed25519 проти
// pubkey-кешу), не ЯК кеш матеріалізується файлом.
//
// Розташування навмисно відрізняється від приватного ключа пристрою
// (signing.js: `device_key.json`, файл-сусід `config.json`, ПОЗА git —
// секрет одного пристрою): `device-registry.json` живе В `mandatesDir`
// поруч із `.mt/mandates.yaml`, комітиться в git — це ПУБЛІЧНИЙ довідник
// (handle → pubkey + роль), який мусять бачити всі потенційні підписанти
// (`validate_mandate_change` перевіряє підписи проти нього), той самий
// рівень видимості, що сама карта мандатів.
//
// Схема: масив записів `{handle, role: 'human'|'model', pubkeyBase64,
// registeredAt}`. Один `handle` — один активний запис (перереєстрація тим
// самим пристроєм — no-op на рівні вмісту, лише `registeredAt` рухається).

/**
 * @returns {object[]} порожній реєстр
 */
export function emptyDeviceRegistry() {
  return []
}

/**
 * Розбирає сирий текст `device-registry.json` — відсутній/битий файл
 * повертає порожній масив (не кидає), той самий інваріант, що
 * `knowledge.js: parseKnowledgeFile` (відсутність реєстру — стан «ще жоден
 * пристрій не підписував», не помилка).
 * @param {string|null|undefined} text сирий вміст файлу
 * @returns {object[]} записи реєстру
 */
export function parseDeviceRegistry(text) {
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Серіалізує реєстр у pretty-print JSON з кінцевим переносом рядка.
 * @param {object[]} entries записи реєстру
 * @returns {string} текст файлу
 */
export function formatDeviceRegistry(entries) {
  return `${JSON.stringify(entries, null, 2)}\n`
}

/**
 * Реєструє (або оновлює) публічний ключ пристрою під `handle` — pure-функція
 * (повертає новий масив, не мутує вхідний). Той самий `handle` з тим самим
 * `pubkeyBase64` — заміна запису на місці (не дублікат); зміна `pubkeyBase64`
 * під тим самим `handle` — теж заміна (нова активна прив'язка, стара мовчки
 * витісняється — той самий рівень довіри, що git push без CI-перевірки
 * ротації ключа, прийнятний для мок-реєстру M3).
 * @param {object[]} entries поточний реєстр
 * @param {{handle: string, role: 'human'|'model', pubkeyBase64: string}} device пристрій для реєстрації
 * @param {() => Date} [now] ін'єкція годинника (тести)
 * @returns {object[]} новий реєстр з доданим/оновленим записом
 */
export function upsertDevice(entries, { handle, role, pubkeyBase64 }, now) {
  const registeredAt = (now ? now() : new Date()).toISOString()
  const withoutHandle = entries.filter(e => e.handle !== handle)
  return [...withoutHandle, { handle, role, pubkeyBase64, registeredAt }]
}

/**
 * Знаходить запис реєстру, що ОДНОЧАСНО збігається за `handle` і
 * `pubkeyBase64` — навмисно суворіше за одинарний lookup за pubkey: підпис
 * зараховується лише коли підписант заявив саме той `handle`, під яким сам
 * же й зареєстрував саме цей ключ (запобігає підміні заявленої ролі чужим
 * зареєстрованим ключем).
 * @param {object[]} entries записи реєстру
 * @param {{handle: string, pubkeyBase64: string}} claim заявлений підписант
 * @returns {object|null} запис реєстру, або null — не знайдено
 */
export function findRegisteredSigner(entries, { handle, pubkeyBase64 }) {
  return entries.find(e => e.handle === handle && e.pubkeyBase64 === pubkeyBase64) ?? null
}

/**
 * Знаходить `{handle, role}` за самим лише `pubkeyBase64` — потрібно
 * трек-рекорду (`track-record.js`), що бачить у `NNNN-approval.json` лише
 * `pubkey`, не `handle` (схема `ApprovalResponse` контракту не несе
 * `handle` — атрибуція завжди йде через реєстр).
 * @param {object[]} entries записи реєстру
 * @param {string} pubkeyBase64 публічний ключ підписанта
 * @returns {{handle: string, role: 'human'|'model'}|null} атрибуція, або null — ключ не зареєстрований
 */
export function findByPubkey(entries, pubkeyBase64) {
  const found = entries.find(e => e.pubkeyBase64 === pubkeyBase64)
  return found ? { handle: found.handle, role: found.role } : null
}
