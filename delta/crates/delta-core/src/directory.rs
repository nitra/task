//! PII-довідник `handle → {name, email, lang}` — порт `delta/src/directory.js`
//! (M4). Живе В `mandatesDir`, ПОЗА git (`.gitignore`).

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct DirectoryEntry {
    pub name: Option<String>,
    pub email: Option<String>,
    pub lang: Option<String>,
}

fn normalize_str(v: Option<&str>) -> Option<String> {
    v.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn normalize_entry(raw: &serde_json::Value) -> DirectoryEntry {
    DirectoryEntry {
        name: normalize_str(raw.get("name").and_then(|v| v.as_str())),
        email: normalize_str(raw.get("email").and_then(|v| v.as_str())),
        lang: normalize_str(raw.get("lang").and_then(|v| v.as_str())),
    }
}

pub type Directory = BTreeMap<String, DirectoryEntry>;

pub fn empty_directory() -> Directory {
    BTreeMap::new()
}

/// Розбирає сирий текст `directory.json` — відсутній/битий файл повертає
/// порожній довідник (не кидає) — `directory.js: parseDirectory`.
pub fn parse_directory(text: Option<&str>) -> Directory {
    let Some(text) = text else {
        return empty_directory();
    };
    if text.trim().is_empty() {
        return empty_directory();
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) else {
        return empty_directory();
    };
    let Some(obj) = parsed.as_object() else {
        return empty_directory();
    };
    obj.iter()
        .map(|(handle, raw)| (handle.clone(), normalize_entry(raw)))
        .collect()
}

/// Серіалізує довідник у pretty-print JSON, ключі відсортовані (`directory.js:
/// formatDirectory`) — `BTreeMap` уже дає стабільний ітераційний порядок.
pub fn format_directory(entries: &Directory) -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(entries).expect("Directory серіалізується без помилок")
    )
}

pub struct DirectoryPatch {
    pub name: Option<String>,
    pub email: Option<String>,
    pub lang: Option<String>,
}

/// Записує (чи оновлює) запис одного handle — part update (лише передані
/// поля змінюються) — `directory.js: setDirectoryEntry`.
pub fn set_directory_entry(entries: &Directory, handle: &str, patch: DirectoryPatch) -> Directory {
    let current = entries.get(handle).cloned().unwrap_or_default();
    let merged = DirectoryEntry {
        name: patch.name.or(current.name),
        email: patch.email.or(current.email),
        lang: patch.lang.or(current.lang),
    };
    let mut next = entries.clone();
    next.insert(handle.to_string(), merged);
    next
}

/// Display-імʼя для handle — фолбек на сам handle (`directory.js:
/// displayName`).
pub fn display_name<'a>(entries: &'a Directory, handle: Option<&'a str>) -> Option<&'a str> {
    let handle = handle?;
    Some(
        entries
            .get(handle)
            .and_then(|e| e.name.as_deref())
            .unwrap_or(handle),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_missing_or_corrupt_is_empty() {
        assert!(parse_directory(None).is_empty());
        assert!(parse_directory(Some("not json")).is_empty());
        assert!(parse_directory(Some("[]")).is_empty());
    }

    #[test]
    fn set_and_display_name() {
        let entries = empty_directory();
        let updated = set_directory_entry(
            &entries,
            "olena",
            DirectoryPatch {
                name: Some("Olena K.".into()),
                email: None,
                lang: None,
            },
        );
        assert_eq!(display_name(&updated, Some("olena")), Some("Olena K."));
    }

    #[test]
    fn display_name_falls_back_to_handle_when_no_entry() {
        let entries = empty_directory();
        assert_eq!(display_name(&entries, Some("ghost")), Some("ghost"));
        assert_eq!(display_name(&entries, None), None);
    }

    #[test]
    fn partial_update_preserves_other_fields() {
        let entries = empty_directory();
        let step1 = set_directory_entry(
            &entries,
            "olena",
            DirectoryPatch {
                name: Some("Olena".into()),
                email: Some("o@x.com".into()),
                lang: None,
            },
        );
        let step2 = set_directory_entry(
            &step1,
            "olena",
            DirectoryPatch {
                name: None,
                email: None,
                lang: Some("uk".into()),
            },
        );
        let entry = &step2["olena"];
        assert_eq!(entry.name.as_deref(), Some("Olena"));
        assert_eq!(entry.email.as_deref(), Some("o@x.com"));
        assert_eq!(entry.lang.as_deref(), Some("uk"));
    }

    #[test]
    fn format_round_trips() {
        let entries = empty_directory();
        let updated = set_directory_entry(
            &entries,
            "olena",
            DirectoryPatch {
                name: Some("Olena".into()),
                email: None,
                lang: None,
            },
        );
        let text = format_directory(&updated);
        assert_eq!(parse_directory(Some(&text)), updated);
    }
}
