// Скоуп власника (M5, docs/specs/260714-cognitive-delegation.md): «мій скоуп»
// — не налаштування, а деривація з owner:-розмітки autonomy.yml у git.
// Фрактальне успадкування йде за графом задач, не за оргструктурою: власник
// вузла володіє нащадками, доки нащадок не делегований комусь іншому.
// Ліс без жодного owner: — нерозмічений: усе моє (single-owner виродження).

/**
 * Ефективний власник вузла: найдовший префікс шляху з owner:-розміткою
 * (дзеркалить effective_owner_of у Rust-бекенді).
 * @param {Record<string, string>} owners розмітка воркспейсу {nodePath: handle}
 * @param {string} path шлях вузла (сегменти через «/»)
 * @returns {string|null} handle власника, або null — вузол без власника
 */
export function effectiveOwnerOf(owners, path) {
  const segments = path.split('/')
  for (let i = segments.length; i >= 1; i--) {
    const owner = owners?.[segments.slice(0, i).join('/')]
    if (owner) return owner
  }
  return null
}

/**
 * Класифікація вузлів воркспейсу відносно мене.
 * - `mine` — я effective owner (або ліс нерозмічений);
 * - `boundary` — межа контракту: вузол делеговано іншому, а його батько мій
 *   (я замовник — бачу контрактний фасад і зміни стану самого вузла);
 * - `foreign` — чужа кухня під межею (не вантажиться у чергу/дельту);
 * - `orphaned` — «нічия земля»: розмічений ліс, а власник не резолвиться
 *   (fail-visible: показується всім із запрошенням призначити власника).
 * @param {Record<string, string>} owners розмітка воркспейсу {nodePath: handle}
 * @param {string|null} me мій handle (null — ідентичність не налаштована)
 * @returns {{ marked: boolean, classify: (path: string) => 'mine'|'boundary'|'foreign'|'orphaned' }} скоуп воркспейсу
 */
export function deriveScope(owners, me) {
  const marked = Object.keys(owners ?? {}).length > 0

  /**
   * @param {string} path шлях вузла
   * @returns {'mine'|'boundary'|'foreign'|'orphaned'} клас вузла відносно мене
   */
  function classify(path) {
    if (!marked) return 'mine'
    const owner = effectiveOwnerOf(owners, path)
    if (owner === null) return 'orphaned'
    if (me !== null && owner === me) return 'mine'
    // Чужий вузол: межа контракту — сам розмічений вузол, чий батько мій.
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null
    const parentOwner = parent === null ? null : effectiveOwnerOf(owners, parent)
    const parentIsMine = parent !== null && me !== null && parentOwner === me
    return owners[path] && parentIsMine ? 'boundary' : 'foreign'
  }

  return { marked, classify }
}

/**
 * Адресат ескалації для мого вузла — замовник: ефективний власник
 * найближчого предка поза моєю ділянкою (M6). null — ескалювати нікому:
 * вузол не мій, наді мною нікого (я власник кореня) або предок — «нічия
 * земля» (спершу признач власника).
 * @param {Record<string, string>} owners розмітка воркспейсу {nodePath: handle}
 * @param {string|null} me мій handle
 * @param {string} path шлях вузла (сегменти через «/»)
 * @returns {string|null} handle замовника, або null
 */
export function escalationAddressee(owners, me, path) {
  if (me === null || effectiveOwnerOf(owners, path) !== me) return null
  const segments = path.split('/')
  for (let i = segments.length - 1; i >= 1; i--) {
    const owner = effectiveOwnerOf(owners, segments.slice(0, i).join('/'))
    if (owner !== me) return owner
  }
  return null
}

/**
 * Скоуп кожного воркспейсу лісу з розмітки й моєї ідентичності.
 * @param {Record<string, Record<string, string>>} ownersByWorkspace розмітка за шляхом воркспейсу
 * @param {string|null} me мій handle
 * @returns {Record<string, ReturnType<typeof deriveScope>>} скоуп за шляхом воркспейсу
 */
export function deriveScopes(ownersByWorkspace, me) {
  return Object.fromEntries(
    Object.entries(ownersByWorkspace ?? {}).map(([path, owners]) => [path, deriveScope(owners, me)])
  )
}
