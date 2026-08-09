---
type: JS Module
title: device-registry.js
resource: delta/src/device-registry.js
docgen:
  crc: 6a01120f
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл забезпечує роботу з реєстром пристроїв через локальний JSON-файл для зв'язування ідентифікаторів з публічними ключами. Він реалізує `emptyDeviceRegistry`, `parseDeviceRegistry` та `formatDeviceRegistry` для роботи зі структурою даних, `upsertDevice` для оновлення прив'язок, а також `findRegisteredSigner` та `findByPubkey` для верифікації заявлених пристроїв.

## Поведінка

Реєстр є публічним довідником, що зберігається у файлі `device-registry.json` поруч із `config.json` та `device_key.json`. Дані з файлу зчитуються через `parseDeviceRegistry` або створюються за допомогою `emptyDeviceRegistry`, забезпечуючи стабільний масив записів навіть за відсутності файлу чи помилках у ньому. Для збереження змін використовується `formatDeviceRegistry`, що готує текст для запису.

Процес реєстрації пристроїв через `upsertDevice` забезпечує унікальність: новий запис з певним `handle` замінює старий, дозволяючи оновлювати прив'язку ключа до ідентифікатора. Для перевірки прав підпису використовується `findRegisteredSigner`, що гарантує відповідність заявленого `handle` та його ключа. Для отримання атрибуції (ідентифікатора та ролі) за ключем, що приходить з `NNNN-approval.json`, застосовується `findByPubkey`.

## Публічний API

- parseDeviceRegistry — Розбирає сирий текст `device-registry.json` — відсутній/битий файл
повертає порожній масив (не кидає), той самий інваріант, що
`knowledge.js: parseKnowledgeFile` (відсутність реєстру — стан «ще жоден
пристрій не підписував», не помилка).
- formatDeviceRegistry — Серіалізує реєстр у pretty-print JSON з кінцевим переносом рядка.
- upsertDevice — Реєструє (або оновлює) публічний ключ пристрою під `handle` — pure-функція
(повертає новий масив, не мутує вхідний). Той самий `handle` з тим самим
`pubkeyBase64` — заміна запису на місці (не дублікат); зміна `pubkeyBase64`
під тим самим `handle` — теж заміна (нова активна прив'язка, стара мовчки
витісняється — той самий рівень довіри, що git push без CI-перевірки
ротації ключа, прийнятний для мок-реєстру M3).
- findRegisteredSigner — Знаходить запис реєстру, що ОДНОЧАСНО збігається за `handle` і
`pubkeyBase64` — навмисно суворіше за одинарний lookup за pubkey: підпис
зараховується лише коли підписант заявив саме той `handle`, під яким сам
же й зареєстрував саме цей ключ (запобігає підміні заявленої ролі чужим
зареєстрованим ключем).
- findByPubkey — Знаходить `{handle, role}` за самим лише `pubkeyBase64` — потрібно
трек-рекорду (`track-record.js`), що бачить у `NNNN-approval.json` лише
`pubkey`, не `handle` (схема `ApprovalResponse` контракту не несе
`handle` — атрибуція завжди йде через реєстр).
- emptyDeviceRegistry — створює порожній реєстр пристроїв, використовуючи конфіги device_key.json, config.json, device-registry.json та NNNN-approval.json.

## Сценарії використання

- `delta/src/tests/device-registry.test.js` (parseDeviceRegistry; emptyDeviceRegistry) — відсутній/битий/порожній текст — порожній масив, не помилка; валідний масив round-trip через formatDeviceRegistry; порожній масив; додає новий запис для нового handle; той самий handle — замінює попередній запис (не дублює); ще 7

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
