// PII-довідник `handle → {name, email, lang}` — M4 (docs/specs/
// 260809-delta-app.md, «Обсяг M4», п.1; конституція п.8 «Мультиюзер на
// ~20»: «Ідентичність = handle, PII поза git (`.mt/directory.json`,
// адмін-екран у додатку)», і docs/specs/260714-cognitive-delegation.md,
// п.1 «Ідентичність = handle, PII — поза git»). У файлах вузлів (mandates.yaml,
// decision-request) НІКОЛИ немає email/повного імені — лише handle; це
// відображення живе окремо, ПОЗА git (той самий рівень приватності, що
// `device_key.json`/`knowledge.json`), і ЩЕ й у самому `mandatesDir`
// (на відміну від них — файл-сусідів `config.json` одного пристрою), бо
// довідник спільний для ВСІХ пристроїв воркспейсу (адмінка редагує один
// файл, усі учасники бачать ті самі display-імена).
//
// **PII не комітиться:** `<mandatesDir>/.mt/directory.json` — той самий
// шлях, що згадує конституція; корінь репо ігнорує `**/.mt/directory.json`
// (.gitignore) саме тому, що тестові/демо-воркспейси цього застосунку
// живуть під `delta/` — фікстура з РЕАЛЬНИМИ іменами/email НЕ повинна
// потрапити в git навіть випадково. Приклад формату — `.example`-файл
// (`src/tests/fixtures/directory.example.json`), не сам `directory.json`.
//
// Схема: плаский обʼєкт `{ [handle]: { name: string|null, email: string|null,
// lang: string|null } }` — О(1) lookup за handle (на відміну від масиву
// `device-registry.json`, де записи звіряються за ДВОМА полями одночасно
// — тут ключ один, handle, і саме він первинний).

/**
 * @returns {object} порожній довідник
 */
export function emptyDirectory() {
  return {}
}

/**
 * @param {unknown} raw сирий запис одного handle з розпарсеного JSON
 * @returns {{name: string|null, email: string|null, lang: string|null}} нормалізований запис
 */
function normalizeEntry(raw) {
  const entry = raw && typeof raw === 'object' ? raw : {}
  return {
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : null,
    email: typeof entry.email === 'string' && entry.email.trim() ? entry.email.trim() : null,
    lang: typeof entry.lang === 'string' && entry.lang.trim() ? entry.lang.trim() : null
  }
}

/**
 * Розбирає сирий текст `directory.json` — відсутній/битий файл повертає
 * порожній обʼєкт (не кидає), той самий інваріант, що `device-registry.js`/
 * `knowledge.js`: відсутність довідника — стан «ще ніхто не заповнив
 * display-імена», не помилка.
 * @param {string|null|undefined} text сирий вміст файлу
 * @returns {object} нормалізований довідник
 */
export function parseDirectory(text) {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result = {}
    for (const [handle, raw] of Object.entries(parsed)) result[handle] = normalizeEntry(raw)
    return result
  } catch {
    return {}
  }
}

/**
 * Серіалізує довідник у pretty-print JSON з кінцевим переносом рядка,
 * ключі відсортовані (стабільний diff у git — довідник комітиться).
 * @param {object} entries довідник
 * @returns {string} текст файлу
 */
export function formatDirectory(entries) {
  const sorted = {}
  for (const handle of Object.keys(entries).toSorted()) sorted[handle] = entries[handle]
  return `${JSON.stringify(sorted, null, 2)}\n`
}

/**
 * Записує (чи оновлює) запис одного handle — pure-функція (повертає новий
 * обʼєкт, не мутує вхідний), part update (лише передані поля змінюються,
 * решта лишається — read-merge-write на рівні одного запису).
 * @param {object} entries поточний довідник
 * @param {string} handle handle запису
 * @param {{name?: string, email?: string, lang?: string}} patch поля для оновлення
 * @returns {object} новий довідник із оновленим записом
 */
export function setDirectoryEntry(entries, handle, patch) {
  const current = entries[handle] ?? { name: null, email: null, lang: null }
  const merged = normalizeEntry({ ...current, ...patch })
  return { ...entries, [handle]: merged }
}

/**
 * Display-імʼя для handle — «підставляється в усі екрани (черга, карта,
 * Довіряю) з фолбеком на handle» (M4 п.1). Немає запису/імені — сам handle
 * (ніколи не порожній рядок для валідного handle), `null`/`undefined`
 * handle — `null` (немає кого показувати).
 * @param {object} entries довідник
 * @param {string|null|undefined} handle handle для пошуку
 * @returns {string|null} display-імʼя, або handle як фолбек
 */
export function displayName(entries, handle) {
  if (!handle) return null
  return entries[handle]?.name ?? handle
}
