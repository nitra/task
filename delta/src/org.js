// Org-level конфіг `.mt/org.json` (M6, docs/specs/260809-delta-app.md,
// «Обсяг M6», п.2, метрика «ціна гейта»: «сумарна вартість людської уваги
// на рішення (час × ставка + ціна затримки)» — конституція, «Метрики
// пілота» п.1). Живе В `mandatesDir`, КОМІТИТЬСЯ в git — той самий рівень
// публічності, що `device-registry.json` (не PII, організаційна політика,
// на відміну від `directory.json`/`candor/*.jsonl`, які лишаються поза
// git). Єдине поле зараз — `hourly_rate_eur`: ставка вартості людської
// години, дефолт **60 €/год** — задокументований дефолт цього застосунку
// (НЕ контракт mt, НЕ економічна модель — organizational input, який
// команда підлаштовує під себе редагуванням файлу).

const DEFAULT_HOURLY_RATE_EUR = 60

/**
 * @returns {{hourlyRateEur: number}} дефолтний org-конфіг
 */
export function defaultOrgConfig() {
  return { hourlyRateEur: DEFAULT_HOURLY_RATE_EUR }
}

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {string} абсолютний шлях до `.mt/org.json`
 */
export function orgConfigPath(mandatesDir) {
  return `${mandatesDir}/.mt/org.json`
}

/**
 * Розбирає `.mt/org.json` — відсутній/битий файл, чи невалідне
 * (не позитивне число) значення повертають дефолт, не кидають (той самий
 * fail-safe інваріант, що решта конфігів цього застосунку — `directory.js`/
 * `device-registry.js`).
 * @param {string|null|undefined} text сирий вміст файлу
 * @returns {{hourlyRateEur: number}} нормалізований org-конфіг
 */
export function parseOrgConfig(text) {
  if (!text) return defaultOrgConfig()
  try {
    const parsed = JSON.parse(text)
    const rate = typeof parsed?.hourly_rate_eur === 'number' && parsed.hourly_rate_eur > 0 ? parsed.hourly_rate_eur : DEFAULT_HOURLY_RATE_EUR
    return { hourlyRateEur: rate }
  } catch {
    return defaultOrgConfig()
  }
}

/**
 * @param {{hourlyRateEur: number}} config org-конфіг
 * @returns {string} pretty-print JSON текст файлу
 */
export function formatOrgConfig(config) {
  return `${JSON.stringify({ hourly_rate_eur: config.hourlyRateEur }, null, 2)}\n`
}

/**
 * Читає org-конфіг через generic `{readFile}` io — той самий підхід, що
 * `directory.js`: відсутність файлу — дефолт, не помилка (команда ще не
 * підлаштувала ставку під себе).
 * @param {{readFile: (path: string) => Promise<string|null>}} io fs-транспорт
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {Promise<{hourlyRateEur: number}>} нормалізований org-конфіг
 */
export async function loadOrgConfig(io, mandatesDir) {
  return parseOrgConfig(await io.readFile(orgConfigPath(mandatesDir)))
}
