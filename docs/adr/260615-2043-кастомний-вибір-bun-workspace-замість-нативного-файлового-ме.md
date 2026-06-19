---
session: d927b0b9-d125-498a-8cc7-e1e46c7a7121
captured: 2026-06-15T20:43:10+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/d927b0b9-d125-498a-8cc7-e1e46c7a7121.jsonl
---

## ADR Кастомний вибір bun workspace замість нативного файлового менеджера

## Context and Problem Statement

Діалог "Нова задача" (`CreateTaskDialog.vue`) використовував нативний OS-файловий менеджер (`open()` з `@tauri-apps/plugin-dialog`) для вибору директорії проєкту. За специфікацією `mt/` може існувати лише у bun workspace директоріях. Показувати всю файлову систему — надмірно й вводить в оману.

## Considered Options

* Нативний OS-файловий менеджер (попередній стан)
* Кастомний `q-select` лише з bun workspace директоріями під `www`

## Decision Outcome

Chosen option: "Кастомний `q-select` лише з bun workspace директоріями під `www`", because специфікація обмежує розміщення `mt/` виключно bun workspace директоріями — показувати решту файлової системи некоректно.

### Consequences

* Good, because transcript фіксує очікувану користь: користувач бачить лише валідні цілі, без зайвого "шуму" файлової системи.
* Bad, because якщо структура проєкту нестандартна (без `workspaces`-поля у `package.json`), директорію не буде видно у пікері.

## More Information

* Новий Tauri-команд `list_project_workspaces(root)` у `app/src-tauri/src/lib.rs` — сканує `www/<org>/<project>/` на 2 рівні, читає `package.json`, розгортає поле `workspaces` (підтримує glob `packages/*`), повертає `Vec<{path, label}>`.
* Новий composable `app/src/composables/use-project-workspaces.js` — кешує результат, повторно отримує через `refresh()`.
* `app/src/components/CreateTaskDialog.vue` — `open()` замінено на `q-select` що отримує дані з composable.

---

## ADR Динамічне визначення `home_dir` замість хардкоду

## Context and Problem Statement

У `use-projects-dir.js` шлях за замовчуванням `DEFAULT_PROJECTS_DIR` був хардкодований як `/Users/vitalii/www/`, що не відповідало реальному імені користувача `vitaliytv` і призводило до порожнього списку в пікері.

## Considered Options

* Хардкоданий шлях (`/Users/vitalii/www/`)
* Новий Tauri-команд `home_dir`, який повертає `$HOME` з оточення

## Decision Outcome

Chosen option: "Новий Tauri-команд `home_dir`", because хардкод імені користувача некоректний між машинами та обліковими записами; `std::env::var("HOME")` дає правильний шлях портативно.

### Consequences

* Good, because transcript фіксує очікувану користь: шлях `$HOME/www` коректно резолвиться на будь-якій машині.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* Tauri-команд `home_dir` у `app/src-tauri/src/lib.rs`: `std::env::var("HOME")`.
* `app/src/composables/use-projects-dir.js`: при ініціалізації, якщо `localStorage` порожній — викликає `invoke('home_dir')` і будує `$HOME/www`.

---

## ADR Мульти-токенний AND-пошук у пікері проєктів

## Context and Problem Statement

Пошук у `q-select` пікері проєктів перевіряв лише точне входження рядка (`.includes(q)`). Користувач хотів фільтрувати за декількома незалежними ключовими словами: наприклад, `abie k8s` — знайти проєкти, де обидва слова присутні в label-і, незалежно від порядку.

## Considered Options

* Точний substring match (попередній стан)
* Split по пробілах + перевірка що кожен термін присутній у label (AND-логіка)

## Decision Outcome

Chosen option: "Split по пробілах + AND-логіка", because користувач явно зазначив що хоче шукати `abie k8s` і отримувати результати де обидва слова входять у повний шлях.

### Consequences

* Good, because transcript фіксує очікувану користь: пошук стає природнішим — порядок слів не важливий.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

* `app/src/components/CreateTaskDialog.vue`: `wsFilter.value.toLowerCase().split(/\s+/).filter(Boolean)` → `terms.every(t => w.label.toLowerCase().includes(t))`.
