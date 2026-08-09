// Kill-switch (M6, docs/specs/260809-delta-app.md, «Обсяг M6», п.3;
// конституція п.10: «будь-хто одним актом повертає весь свій мандат у
// «все через мене»; використання — сигнал каліброваності, не саботаж»).
//
// **SUSPENSION-шар, НЕ мутація мандата** — `.mt/mandates.yaml` НІКОЛИ не
// торкається (реверсивність — вимкнути так само легко, як увімкнути, без
// жодного change-proposal/квізу): активний kill-switch лише ЗМІНЮЄ
// ДЕРИВАЦІЮ черг (`decisions.js: deriveQueue` через `killSwitchRedirect`,
// `watcher.js: scanForNotifications` через `killSwitchSuppressed`) —
// розвилки, делеговані моїм ШІ-мандатам (`escalates_to === я`), і НОВІ
// розвилки їхніх scope-ів деривуються в МОЮ чергу замість моделі, а
// watcher НЕ пінгує/ескалює по них (я свідомо все забрав, повторний пінг
// моделі чи ескалація собі ж — шум).
//
// **Панічна кнопка — БЕЗ квізу, БЕЗ підтвердження** (задокументоване
// рішення, буквально з задачі M6, п.3: «UI-кнопка... без підтверджувального
// квізу — панічна кнопка МАЄ бути миттєвою»): на відміну від КОЖНОГО іншого
// акту цього застосунку (approval/quorum/delegation/mandate-change), тут
// НЕМАЄ квіз-гейта — момент, коли треба забрати все собі, НЕ момент для
// роздумів над формулюванням квізу.
//
// **Маркер активності — `write('')` замість Rust-команди видалення файлу**
// (той самий інваріант, що `watcher.js`/`drift.js`: «жодних нових Tauri-
// команд» над generic `read_text_file`/`write_text_file`): `killSwitchOn`
// пише підписаний JSON, `killSwitchOff` перезаписує ПОРОЖНІМ рядком —
// {@link isKillSwitchActive} трактує порожній/відсутній вміст як
// «неактивний». Обидві дії, попри відсутність квізу, підписуються (Ed25519,
// той самий крипто-шар, що решта застосунку) і ДОПИСУЮТЬСЯ в спільний
// append-only лог (`killSwitchLogPath`) — це единий слід АКТИВАЦІЙ, який
// читає `report.js` для метрики «активацій kill-switch» (маркер-файл сам
// по собі несе лише ПОТОЧНИЙ стан, історія активацій/деактивацій живе в
// лозі).

import { signPayload } from './signing.js'

/**
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} handle handle власника kill-switch
 * @returns {string} абсолютний шлях до маркера поточного стану
 */
export function killSwitchPath(mandatesDir, handle) {
  return `${mandatesDir}/.mt/kill-switch/${handle}.json`
}

/**
 * Спільний append-only лог активацій/деактивацій — ОДИН файл на воркспейс
 * (не per-handle, як `.mt/candor/`): звіт (`report.js`) читає лише
 * АГРЕГОВАНУ кількість, не потребує per-handle розбивки (профспілковий
 * принцип — п.9: звіт директору не показує «хто», лише «скільки»).
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @returns {string} абсолютний шлях до `.mt/kill-switch/log.jsonl`
 */
export function killSwitchLogPath(mandatesDir) {
  return `${mandatesDir}/.mt/kill-switch/log.jsonl`
}

/**
 * @param {string|null|undefined} text сирий вміст маркера {@link killSwitchPath}
 * @returns {boolean} true — kill-switch активний (непорожній валідний JSON)
 */
export function isKillSwitchActive(text) {
  if (!text || !text.trim()) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/**
 * Будує й підписує один запис акта kill-switch — канонікалізований payload
 * через `signing.js: signPayload` (той самий крипто-шар, що approval/quorum/
 * delegation/mandate-change), попри відсутність квіз-гейта над цим актом.
 * @param {object} params вхідні параметри
 * @param {string} params.handle handle власника
 * @param {'on'|'off'} params.action дія
 * @param {object} params.privateKeyJwk приватний ключ пристрою (JWK)
 * @param {string} params.publicKeyBase64 публічний ключ пристрою (base64)
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<object>} підписаний запис `{schema_version, type, handle, action, at, pubkey, signature}`
 */
export async function buildAndSignKillSwitchRecord({ handle, action, privateKeyJwk, publicKeyBase64, now }) {
  const payload = { schema_version: 1, type: 'kill-switch', handle, action, at: (now ? now() : new Date()).toISOString() }
  const signature = await signPayload(privateKeyJwk, payload)
  return { ...payload, pubkey: publicKeyBase64, signature }
}

/**
 * Дописує один запис у спільний лог — той самий read-append-write патерн,
 * що `watcher.js: appendNotifications`/`candor.js: appendCandorRecord`.
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} io fs-транспорт
 * @param {string} path абсолютний шлях до логу
 * @param {object} record запис
 * @returns {Promise<void>}
 */
async function appendKillSwitchLog(io, path, record) {
  const existing = (await io.readFile(path)) ?? ''
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing
  await io.writeFile(path, `${prefix}${JSON.stringify(record)}\n`)
}

/**
 * `kill_switch_on` — пише активний маркер + дописує лог. БЕЗ квізу
 * (заголовок модуля) — викликач (tool-шар) не гейтує це жодним
 * підтвердженням, лише самим ключем пристрою.
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {string} params.handle handle власника
 * @param {{privateKeyJwk: object, publicKeyBase64: string}} params.deviceKey ключ пристрою
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{active: true, activatedAt: string}>} новий стан
 */
export async function killSwitchOn({ io, mandatesDir, handle, deviceKey, now }) {
  const record = await buildAndSignKillSwitchRecord({
    handle,
    action: 'on',
    privateKeyJwk: deviceKey.privateKeyJwk,
    publicKeyBase64: deviceKey.publicKeyBase64,
    now
  })
  const marker = { activated_at: record.at, pubkey: record.pubkey, signature: record.signature }
  await io.writeFile(killSwitchPath(mandatesDir, handle), `${JSON.stringify(marker, null, 2)}\n`)
  await appendKillSwitchLog(io, killSwitchLogPath(mandatesDir), record)
  return { active: true, activatedAt: record.at }
}

/**
 * `kill_switch_off` — перезаписує маркер порожнім (реверсивність,
 * заголовок модуля) і дописує лог НОВИМ підписом (задача M6, п.3: «Off —
 * видаляє файл новим підписом» — тут «видаляє» означає «спорожнює», див.
 * заголовок модуля щодо відсутності Rust-команди видалення файлу).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>, writeFile: (path: string, content: string) => Promise<void>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {string} params.handle handle власника
 * @param {{privateKeyJwk: object, publicKeyBase64: string}} params.deviceKey ключ пристрою
 * @param {() => Date} [params.now] ін'єкція годинника (тести)
 * @returns {Promise<{active: false, deactivatedAt: string}>} новий стан
 */
export async function killSwitchOff({ io, mandatesDir, handle, deviceKey, now }) {
  const record = await buildAndSignKillSwitchRecord({
    handle,
    action: 'off',
    privateKeyJwk: deviceKey.privateKeyJwk,
    publicKeyBase64: deviceKey.publicKeyBase64,
    now
  })
  await io.writeFile(killSwitchPath(mandatesDir, handle), '')
  await appendKillSwitchLog(io, killSwitchLogPath(mandatesDir), record)
  return { active: false, deactivatedAt: record.at }
}

/**
 * `kill_switch_status` — читає ПОТОЧНИЙ стан маркера одного handle.
 * @param {{readFile: (path: string) => Promise<string|null>}} io fs-транспорт
 * @param {string} mandatesDir абсолютний шлях до воркспейсу
 * @param {string} handle handle власника
 * @returns {Promise<{active: boolean}>} поточний стан
 */
export async function killSwitchStatus(io, mandatesDir, handle) {
  const text = await io.readFile(killSwitchPath(mandatesDir, handle))
  return { active: isKillSwitchActive(text) }
}

/**
 * Будує деривовану карту перенаправлення черги (`decisions.js: deriveQueue`)
 * і множину пригнічених для watcher-а (`watcher.js: scanForNotifications`)
 * — ОДИН прохід по person-owner карти мандатів: для кожного, чий kill-switch
 * активний, усі ЙОГО ШІ-мандати (`escalates_to === owner`) перенаправляються
 * на нього (заголовок модуля).
 * @param {object} params вхідні параметри
 * @param {{readFile: (path: string) => Promise<string|null>}} params.io fs-транспорт
 * @param {string} params.mandatesDir абсолютний шлях до воркспейсу
 * @param {object[]} params.mandates нормалізовані мандати (`mandates.js`/`mandate-change.js` camelCase форма)
 * @returns {Promise<{redirect: Map<string, string>, activeHandles: Set<string>}>}
 *   `redirect`: modelHandle → humanHandle (делегатор з активним kill-switch);
 *   `activeHandles`: усі person-owner з активним kill-switch
 */
export async function buildKillSwitchRedirect({ io, mandatesDir, mandates }) {
  const people = mandates.filter(m => m.kind !== 'model')
  const activeHandles = new Set()
  for (const person of people) {
    const status = await killSwitchStatus(io, mandatesDir, person.owner)
    if (status.active) activeHandles.add(person.owner)
  }
  const redirect = new Map()
  const models = mandates.filter(m => m.kind === 'model')
  for (const model of models) {
    if (model.escalatesTo && activeHandles.has(model.escalatesTo)) redirect.set(model.owner, model.escalatesTo)
  }
  return { redirect, activeHandles }
}
