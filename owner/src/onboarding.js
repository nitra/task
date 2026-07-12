// Онбординг першого запуску: показуємо вступний діалог, поки власник явно
// не закрив його кнопкою «почати». Прапорець — у localStorage (переживає
// перезапуски) з in-memory дублем: без сховища діалог не докучає повторно
// хоча б у межах сесії.

const ONBOARDED_KEY = 'owner:onboarded'

let onboardedInSession = false

/**
 * Чи проходив власник онбординг (на цьому пристрої або в цій сесії).
 * @returns {boolean} true — вступ уже показано і закрито
 */
export function isOnboarded() {
  if (onboardedInSession) return true
  try {
    return globalThis.localStorage?.getItem(ONBOARDED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Зафіксувати проходження онбордингу.
 */
export function markOnboarded() {
  onboardedInSession = true
  try {
    globalThis.localStorage?.setItem(ONBOARDED_KEY, '1')
  } catch {
    // без localStorage — лишається сесійний прапорець
  }
}
