---
kind: nitra-spec
status: design-approved
plan: null
risk: med
date: 2026-06-15
---

# Agent Gateway — додаток як агентний інтерфейс (поверх `tool-surface`)

> Дизайн погоджено, реалізації ще нема. Надбудова над `docs/specs/260614-n-tool-surface.md`.

## Принцип

**Один агент, спільний.** Не будуємо окремий «API для агентів». Будуємо **один** NL-агент, якісний для людини — і **тим самим** входом ділимося з іншими агентами. Якість для людини = якість для агента **за побудовою**: якщо агент недостатньо добрий, щоб людина ним користувалась як основним інтерфейсом, він не випускається — і агентам діставатиметься рівно те, що людині.

**Рекурсія `tool-surface`:** сам агент — це **headless-callable surface** (тул `request`). Людина кличе його через UI, інший агент — через gateway; обидва йдуть через той самий `dispatch`/`runAgent`/контракт. Gateway — це **ще один транспорт** до `dispatch`, а не окрема система.

## Дві ланки (delegation by intent)

Зовнішня LLM-оркестратор делегує **намір природною мовою** вбудованому агенту `task`, який володіє доменними знаннями (тули, схеми, розкладка проєктів, дефолти) і сам перекладає намір у виклики тулів. Замість «знай параметри й нюанси CLI» — «скажи task що треба».

## Архітектура

```
людина (UI)              зовнішній агент (MCP-stdio, --actor)
     │ request(intent)            │ request(intent) / respond(id, msg)
     ▼                            ▼
        ┌──────────── Gateway ────────────┐
        │ actor (від транспорту)           │
        │ scope: фільтр маніфесту тулів    │  (D-E1)
        │ destructive → needs_approval     │  (D-E2)
        └───────────────┬─────────────────┘
                        ▼
   runAgent (sessional, resume-capable)  ←──→  journal (per-file, app-data)
                        │  tool_call (у межах scope)      ↑ messages[], actions[], status, actor
                        ▼
        dispatch → Tool Surface (catalog: name/summary/schema/handler/tier)
```

GUI (людина) і `task mcp` (агенти) — **два рівноправні фронти** над спільними **ФС + omlx + журнал**.

## Контракт

Два MCP-тули (обидва б'ють у того ж агента):

- **`request(intent)`** — мінімальний вхід. Жодного `context`/`project`: агент **завжди** ґраундить сам (скан workspaces, резолв «k8s»); неоднозначність → `needs_clarification`.
- **`respond(requestId, message)`** — продовження сесії (sessional): відповідь на уточнення / апрув.

Результат обох:

```jsonc
{
  "requestId": "…",
  "status": "done | partial | needs_clarification | needs_approval | failed",
  "summary": "…",                         // NL — і людині, і агенту
  "actions": [ { "tool": "create", "input": {…}, "envelope": { "ok": true, "output": {…} } } ],
  "question": "Який саме k8s — abie/k8s чи infra/k8s?"   // при needs_clarification/approval
}
```

`actions` = джерело правди (наш `trace`); `summary` = NL-обгортка; `requestId` → щоб `respond`.

**`actor` у вхід НЕ входить** — приходить від транспорту (UI=human, MCP=сконфігурований id), щоб caller не міг себе підмінити.

## Журнал запитів (durable backbone)

Спільна черга/інбокс усіх звернень (людських і агентських) — одна стрічка для аудиту + репару.

- **Розташування:** `appLocalDataDir/requests/<id>.json` (Mac app-data; обидва процеси резолвлять детерміновано за bundle-id).
- **Per-file record**, immutable-аудит (нічого не видаляємо); ретраї — нові записи через `parentId`.
- Запис:

```jsonc
{
  "id": "…", "createdAt": "…", "updatedAt": "…",
  "actor": { "kind": "human" | "agent", "id": "claude-cursor" },
  "intent": "…",
  "status": "needs_clarification",
  "messages": [ /* system, user, assistant(tool_calls), tool, … */ ],  // для sessional-resume
  "actions": [ … ],          // накопичується через усі ходи сесії
  "summary": "…", "question": "…", "error": null,
  "parentId": null           // лише для явних ретраїв
}
```

- **Аудит-UI:** людина бачить що/хто/коли/статус + **повну нитку розмови** на запит; `failed`/`needs_clarification`/`needs_approval` → відповідає/апрувить/редагує прямо звідти.
- **Незалежність від транспорту:** журнал пише handler, хто б не покликав (UI чи MCP).

## Sessional clarification / approval

- `runAgent` — **resume-capable**: стартує з наявних `messages`, не лише з `prompt`.
- needs_clarification/approval ставить статус + зберігає `messages`; `respond` дописує user-message і **відновлює той самий запис** (нитка всередині запису, не новий).
- **running-лок** на записі — щоб два `respond` не запустили loop одночасно.
- Те саме і для людини (UI), і для агента (MCP) — одна механіка, різний рендер.

## Транспорт — MCP-stdio (єдиний)

- Стандарт «агент ↔ додаток»: зовнішня Claude/Cursor/агент-фреймворк підключають `task` нативно, discoverable, типізовано.
- **stdio-flavor:** host спавнить `task mcp` на сесію; без порту/демона. Лягає на наявний `bin/task.mjs` (новий режим поверх того самого `dispatch`/каталогу).
- Експонує `request` + `respond` (+ опційно granular-тули для сильних callerів).
- `actor.id` — з launch-arg/env (`task mcp --actor "…"`, дефолт `"agent"`).

## Trust / scope

- Тулам у каталозі — **`tier: read | write | destructive`** (scan/workspaces=read, create=write).
- **Scope за actor-kind:** human=всі tiers; agent(default)=read+write; destructive агенту заборонено. Per-agent-id політика — пізніше.
- **Enforcement у двох точках:** (1) маніфест тулів **фільтрується** під actor (модель не бачить заборонених); (2) `dispatch` ріже виклик поза скоупом (`{ ok:false, error:{ code:"forbidden" } }`).
- **Деструктив:** дефолт — заборонено агенту; механізм, коли дозволено — `needs_approval` через журнал (людина апрувить в аудиті, та сама `respond`-петля). Людські деструктиви в UI — звичайний confirm.
- **Чесно про identity:** MCP-stdio локальний → `actor.id` це **audit-лейбл, не auth**. Реальний захист = scope (sandbox тул-сурфейсу) + local-only (нема мережі) + human-approval на деструктив.

## Платформа — тільки Mac

- Повний desktop-профіль: людина + агенти + локальна модель + локальні репо.
- **omlx завжди у фоні** (локальний MLX на `localhost`) → lifecycle тривіальний; `chat` лишається інжектованим, але реалізація одна.
- Android **виключено** (sandbox ФС, відсутність MCP-stdio, MLX Apple-only) — профілі можливостей і `Store`-абстракція не потрібні.

## Звʼязок із `n-tool-surface`

- Агент = тул `request`/`respond` у тому ж каталозі → успадковує `dispatch`/валідацію/конверт.
- Gateway (MCP) = ще один **транспорт** до `dispatch` (поряд із UI-транспортом і CLI).
- Інваріант паритету застосовано на рівень вище: агент — headless-callable.
- Нове в каталозі: поле **`tier`** на тулах (feeds back у правило `tool-surface`/`tauri`).

## Лог рішень

1. Принцип: один спільний агент; human-grade = agent-grade; агент як headless surface.
2. Журнал: спільний для людини й агента; per-file `appLocalDataDir/requests/<id>.json` (b — global app-data); immutable-аудит; `parentId` для ретраїв.
3. Транспорт: **MCP-stdio** — єдиний; desktop/Mac-only.
4. Вхід `request`: **мінімальний** `{ intent }` (без `context`) — агент ґраундить сам; наслідок — паритет ціною більшого числа уточнень.
5. Clarification/approval: **sessional** (resume з `messages`); `respond` як друга точка входу; running-лок.
6. MCP-тули: **два** — `request` + `respond` (LLM-чіткість > «один тул»).
7. Trust: tier-scope (фільтр маніфесту + dispatch-guard); деструктив → human-approval; `actor.id` = audit-лейбл.
8. Платформа: **тільки Mac**; omlx локальний завжди.

## MVP-обсяг (коли дійде до реалізації)

- `bin/task.mjs` → режим `mcp` (MCP-stdio через SDK) з тулами `request`/`respond`, backed наявним `dispatch`.
- `runAgent` → resume-варіант (старт з `messages`).
- Журнал-модуль (write/read per-file у app-data) + запис у `request`-handler.
- Поле `tier` у каталозі + фільтр маніфесту під actor + guard у `dispatch`.
- Аудит-UI (нова в'юха: список запитів, статус, нитка, дії `respond`/approve/retry).
- Статуси `needs_clarification` / `needs_approval` у loop.

## Ризики / відкрите

- **Слабка локальна модель** (Gemma 4B) — стеля якості спільного агента; тримати малий тул-сет, structured-вивід, валідацію до `dispatch`. Якщо стелі бракує для людини — це проблема всього підходу (за принципом).
- **`actor.id` без auth** — прийнятно локально; якщо зʼявиться мережевий транспорт — переглянути.
- **Конкурентність журналу** (GUI + MCP пишуть) — running-лок + атомарний запис файлу.
- **Sessional-сесії висять** невідповідженими — прибирання/TTL в аудит-UI (необовʼязково для v1).
