// Композабл довідника display-імен (M4): диспатчить `directory_show`/
// `directory_set` — той самий tool, що й CLI (`delta directory_show`),
// тож обидві поверхні бачать один довідник `.mt/directory.json` (PII поза
// git). Мандати мандатів/черга/«Довіряю» підставляють `displayName(handle)`
// із фолбеком на сам handle (М4 п.1, «Display-імена підставляються в усі
// екрани... з фолбеком на handle»).

import { ref } from 'vue'
import { dispatch } from '../tool/index.js'

/**
 * Display-імʼя для handle — фолбек на сам handle (1:1 з `delta-core::
 * directory::display_name`, чиста деривація над уже завантаженим довідником).
 * @param {object} entries довідник handle → {name, email, lang}
 * @param {string|null|undefined} handle handle для пошуку
 * @returns {string|null} display-імʼя, або сам handle
 */
function displayNameOf(entries, handle) {
  if (!handle) return null
  return entries[handle]?.name ?? handle
}

/**
 * @returns {object} реактивний стан довідника + дії load/setEntry/displayName
 */
export function useDirectory() {
  const entries = ref({})
  const loading = ref(false)
  const error = ref(null)

  /**
   * Перечитує `.mt/directory.json` цього воркспейсу.
   * @param {string|null|undefined} mandatesDir абсолютний шлях до воркспейсу
   * @returns {Promise<void>}
   */
  async function load(mandatesDir) {
    if (!mandatesDir) {
      entries.value = {}
      return
    }
    loading.value = true
    const res = await dispatch('directory_show', { mandatesDir })
    loading.value = false
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    error.value = null
    entries.value = res.output
  }

  /**
   * Записує (чи оновлює) display-запис одного handle — адмін-редагування
   * (М4 п.1: «UI: адмін-секція... список handle-ів з display-іменами;
   * редагування»).
   * @param {string} mandatesDir абсолютний шлях до воркспейсу
   * @param {string} handle handle запису
   * @param {{name?: string, email?: string, lang?: string}} patch поля для оновлення
   * @returns {Promise<void>}
   */
  async function setEntry(mandatesDir, handle, patch) {
    const res = await dispatch('directory_set', { mandatesDir, handle, ...patch })
    if (!res.ok) {
      error.value = res.error.message
      return
    }
    error.value = null
    entries.value = { ...entries.value, [handle]: res.output }
  }

  /**
   * @param {string|null|undefined} handle handle для пошуку
   * @returns {string|null} display-імʼя, фолбек на сам handle (`directory.js`)
   */
  function displayName(handle) {
    return displayNameOf(entries.value, handle)
  }

  return { entries, loading, error, load, setEntry, displayName }
}
