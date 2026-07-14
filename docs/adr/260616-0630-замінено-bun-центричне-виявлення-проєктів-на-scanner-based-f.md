---
session: 0bc9b81d-37f8-4422-9adb-504713e21248
captured: 2026-06-16T06:30:59+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-task/0bc9b81d-37f8-4422-9adb-504713e21248.jsonl
---

Тепер маю всю картину. Ось детальний розбір по коду:

---

## 1. Що робила стара логіка

До зміни `list_project_workspaces` (відновлено з git-контексту і залишених коментарів):

```
~/www/<org>/<project>/package.json  ← перевірка обов'язкова
↓ якщо нема → vec![] (проєкт ігнорується)
↓ якщо є → parse workspaces[]
↓ expand globs "packages/*"
→ ProjectEntry { path: "<project>/mt", label: "<org>/<project>" }
```

Глибина: **2 рівні** (`<org>/<project>`) + розгортання workspace-ів. Без `package.json` — нічого.

---

## 2. Що робить `find_all_tasks_dirs_from` (код scanner/lib.rs:613)

```rust
pub fn find_all_tasks_dirs_from(start_dir: &Path) -> Vec<WorkspaceInfo> {
let git_root = find_git_root(start_dir).unwrap_or_else(|| start_dir.to_path_buf());
scan_for_workspaces(&git_root, &git_root, &mut result, 0, &[]);
}
```

Крок `find_git_root(~/www)` → проходить вгору по батьківських директоріях шукаючи `.git`. `~/www` зазвичай не є git-репо і не має `.git` в предках → повертає `None` → `git_root = ~/www`. Отже сканування починається **від `~/www`** — так само як і раніше.

---

## 3. Логіка `scan_for_workspaces` (код scanner/lib.rs:489)

Для **кожної** директорії (до depth 6):

```
1. load_gitignore → пропускає gitignored директорії           ← нова перевага

2. .mt.json є?
→ читає "mt_dir" або дефолтно ./mt
→ якщо mt_dir є і має task-вузли → WorkspaceInfo { path: mt_dir, label }
→ STOP, не рекурсить глибше                              ← ключовий кейс для whitekey

3. "mt/" або "tasks/" є + має task-вузли?
→ WorkspaceInfo { path: candidate, label }
→ STOP

4. Інакше → рекурсія в підпапки
(skip: node_modules, target, dist, build, hidden dirs)
```

---

## 4. Де `package.json` — нема жодної перевірки

В `scan_for_workspaces` **ні рядка** про `package.json`. Проєкт знаходиться якщо:
- є `.mt.json` (кастомний конфіг) **або**
- є `mt/` чи `tasks/` **з реальними task-вузлами** всередині

Це пряма відповідність специфікації `mt.md`.

---

## 5. Сумісність типів

| | Стара `ProjectEntry` | Нова `WorkspaceInfo` (scanner/lib.rs:41) |
|---|---|---|
| Поля | `path: String, label: String` | `label: String, path: String` |
| Serde | `#[derive(serde::Serialize)]` | `#[derive(Serialize, Deserialize)]` |
| JSON | `{"path":"...","label":"..."}` | `{"label":"...","path":"..."}` |
| JS споживач | `e.label`, `e.path` | `e.label`, `e.path` |

Різниця в порядку полів — для JSON це не має значення. JS composable (`use-project-workspaces.js:19`): `{ label: e.label, value: e.path }` — читає ті самі поля.

---

## 6. Label для whitekey

`workspace_label(git_root=~/www, current=~/www/vitaliytv/whitekey)` (scanner/lib.rs:441):
```rust
workspace_dir.strip_prefix(git_root)  // → "vitaliytv/whitekey"
```
Результат: `label = "vitaliytv/whitekey"` — те саме що й стара логіка генерувала для bun-проєктів.

---

## Підсумок

Заміна коректна тому що:
1. `path` в результаті — завжди абсолютний шлях до `mt/` → JS не змінюється
2. `label` — той самий формат `<org>/<project>`
3. Прибрано єдину точку відмови: перевірку `package.json`
4. Додано: `.gitignore` підтримка, глибина до 6 рівнів, `.mt.json` `mt_dir` override

---
---
[end of transcript]

## ADR Замінено bun-центричне виявлення проєктів на scanner-based `find_all_tasks_dirs_from`

## Context and Problem Statement
GUI додатку Task виявляло проєкти через Tauri-команду `list_project_workspaces`, яка шукала bun workspaces через `package.json`. Проєкти без `package.json` (наприклад, `/Users/vitaliytv/www/vitaliytv/whitekey`) повністю ігнорувалися пікером, навіть якщо мали `mt/` директорію чи `.mt.json`. Це суперечило специфікації `mt.md`, яка не висуває жодних вимог до наявності `package.json`.

## Considered Options
* Залишити bun-логіку і вимагати `package.json` у кожному проєкті
* Замінити кастомну логіку на виклик `mt_scanner::find_all_tasks_dirs_from`

## Decision Outcome
Chosen option: "Замінити кастомну логіку на виклик `mt_scanner::find_all_tasks_dirs_from`", because специфікація (`mt.md`) визначає проєкт через `.mt.json` або наявність `mt/`/`tasks/` директорії з task-вузлами — не через `package.json`. Scanner вже реалізує саме цю логіку, включно з підтримкою `.gitignore`, depth ≤ 6 та кастомного `mt_dir` з `.mt.json`.

### Consequences
* Good, because проєкти без `package.json` (не-bun, k8s-конфіги, home-lab репо тощо) тепер відображаються в пікері після `mt setup`.
* Good, because прибрано дублювання логіки виявлення workspace-ів між `app/src-tauri/src/lib.rs` і `mt_scanner`: єдиним source of truth залишається scanner.
* Good, because `scan_for_workspaces` (scanner/src/lib.rs:489) враховує `.gitignore`-паттерни, чого стара логіка не робила.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінений файл: `app/src-tauri/src/lib.rs` — функція `list_project_workspaces` (рядок 85) тепер є однорядковою обгорткою: `mt_scanner::find_all_tasks_dirs_from(&PathBuf::from(root))`. Видалено структуру `ProjectEntry` та функцію `resolve_workspace_entries`. Тип повернення змінено з `Vec<ProjectEntry>` на `Vec<WorkspaceInfo>` — JSON-сумісний (`{ label, path }`). JS-composable `app/src/composables/use-project-workspaces.js` (рядок 18-19) звертається до `list_projects_from_paths`, яка також делегує `find_all_tasks_dirs_from`, змін не потребує. Компіляція: `cargo build --manifest-path src-tauri/Cargo.toml` завершилася успішно.
