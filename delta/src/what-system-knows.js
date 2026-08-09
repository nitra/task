// «Що про мене знає система» — профспілковий режим за замовчуванням (M4,
// docs/specs/260809-delta-app.md, «Обсяг M4», п.5; конституція п.9:
// «Усе, що система міряє про людину... видно їй першій; екран «що про мене
// знає система» — обов'язкова частина референсу»).
//
// **Чистий агрегатор, БЕЗ нових зборів даних** (п.5 задачі М4, буквально).
// Кожне поле тут — дзеркало вже наявного джерела: `knowledge.js` (M2, база
// знань і тренд), `watcher.js` (M4, лог нотифікацій — і пінги собі, і
// ескалації, що пішли вгору), `device-registry.js` (M3, публічний
// pubkey-кеш). Модуль не читає диск сам — приймає вже завантажені дані,
// той самий підхід, що `trust.js: deriveTrustView`.

import { domainDigest, timeToUnderstandingTrend } from './knowledge.js'

/**
 * Агрегує усі джерела «що система знає про мене» в один зріз для одного
 * `handle` — лише МОЇ записи скрізь (фільтр за `to`/`handle` на кожному
 * джерелі, ЖОДНОГО чужого запису не просочується).
 * @param {object} params вхідні параметри
 * @param {string|null|undefined} params.handle handle, чий зріз деривувати
 * @param {object[]} [params.knowledgeEntries] усі записи бази знань цього пристрою (M2, вже per-device — приватні, тому й так лише мої)
 * @param {object[]} [params.notifications] усі записи логу нотифікацій `{handle}.jsonl` (watcher.js) — вже per-handle файл, фільтр тут — лише прикраса інваріанту
 * @param {object[]} [params.deviceRegistry] публічний реєстр пристроїв (device-registry.js)
 * @returns {object} агрегований зріз «профспілкового режиму»
 */
export function buildWhatSystemKnows({ handle, knowledgeEntries = [], notifications = [], deviceRegistry = [] }) {
  const myNotifications = notifications.filter(n => n.to === handle)
  const registryEntry = deviceRegistry.find(e => e.handle === handle) ?? null

  return {
    handle: handle ?? null,
    knowledge: {
      entryCount: knowledgeEntries.length,
      digest: domainDigest(knowledgeEntries),
      trend: timeToUnderstandingTrend(knowledgeEntries)
    },
    notifications: {
      total: myNotifications.length,
      // «мої пінги від watcher-а» — SLA-нагадування, адресовані мені як виконавцю.
      pingsToMe: myNotifications.filter(n => n.kind === 'sla-ping-executor'),
      // «і що з них пішло вгору» — прозора копія власного пінгу, коли grace скінчився
      // (mandates.md: «виконавець бачить, що і коли піде вгору»), НЕ сама ескалація
      // (та адресована власнику, не мені — інший `to`, тут не зʼявиться).
      escalatedFromMe: myNotifications.filter(n => n.kind === 'sla-escalated-notice'),
      batchedNow: myNotifications.filter(n => n.batched === true)
    },
    registry: {
      role: registryEntry?.role ?? null,
      pubkeyBase64: registryEntry?.pubkeyBase64 ?? null,
      registeredAt: registryEntry?.registeredAt ?? null
    }
  }
}
