//! Реєстр публічних ключів пристроїв — порт `delta/src/device-registry.js`.
//! Мок «pubkey-кешу», на який спирається `mt_mandates::change` (docs-
//! коментар crate: «чи pubkey справді належить заявленому handle/ролі —
//! відповідальність викликача»). Живе В `mandatesDir` поруч із
//! `.mt/mandates.yaml`, комітиться в git (ПУБЛІЧНИЙ довідник) — на відміну
//! від приватного `device_key.json` (поза git).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SignerRole {
    Human,
    Model,
}

impl From<SignerRole> for mt_mandates::SignerRole {
    fn from(role: SignerRole) -> Self {
        match role {
            SignerRole::Human => mt_mandates::SignerRole::Human,
            SignerRole::Model => mt_mandates::SignerRole::Model,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DeviceRegistryEntry {
    pub handle: String,
    pub role: SignerRole,
    #[serde(rename = "pubkeyBase64")]
    pub pubkey_base64: String,
    #[serde(rename = "registeredAt")]
    pub registered_at: String,
}

pub fn empty_device_registry() -> Vec<DeviceRegistryEntry> {
    Vec::new()
}

/// Розбирає сирий текст `device-registry.json` — відсутній/битий файл
/// повертає порожній масив (не кидає) — `device-registry.js:
/// parseDeviceRegistry`.
pub fn parse_device_registry(text: Option<&str>) -> Vec<DeviceRegistryEntry> {
    let Some(text) = text else { return Vec::new() };
    serde_json::from_str(text).unwrap_or_default()
}

/// Серіалізує реєстр у pretty-print JSON з кінцевим переносом рядка.
pub fn format_device_registry(entries: &[DeviceRegistryEntry]) -> String {
    let mut text = serde_json::to_string_pretty(entries)
        .expect("Vec<DeviceRegistryEntry> серіалізується без помилок");
    text.push('\n');
    text
}

/// Реєструє (або оновлює) публічний ключ пристрою під `handle` —
/// pure-функція (`device-registry.js: upsertDevice`).
pub fn upsert_device(
    entries: &[DeviceRegistryEntry],
    handle: &str,
    role: SignerRole,
    pubkey_base64: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> Vec<DeviceRegistryEntry> {
    let mut next: Vec<DeviceRegistryEntry> = entries
        .iter()
        .filter(|e| e.handle != handle)
        .cloned()
        .collect();
    next.push(DeviceRegistryEntry {
        handle: handle.to_string(),
        role,
        pubkey_base64: pubkey_base64.to_string(),
        registered_at: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    });
    next
}

/// Знаходить запис, що ОДНОЧАСНО збігається за `handle` і `pubkey_base64`
/// (`device-registry.js: findRegisteredSigner`).
pub fn find_registered_signer<'a>(
    entries: &'a [DeviceRegistryEntry],
    handle: &str,
    pubkey_base64: &str,
) -> Option<&'a DeviceRegistryEntry> {
    entries
        .iter()
        .find(|e| e.handle == handle && e.pubkey_base64 == pubkey_base64)
}

/// Знаходить `{handle, role}` за самим лише `pubkey_base64`
/// (`device-registry.js: findByPubkey`).
pub fn find_by_pubkey<'a>(
    entries: &'a [DeviceRegistryEntry],
    pubkey_base64: &str,
) -> Option<&'a DeviceRegistryEntry> {
    entries.iter().find(|e| e.pubkey_base64 == pubkey_base64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> chrono::DateTime<chrono::Utc> {
        chrono::Utc.with_ymd_and_hms(2026, 8, 9, 10, 0, 0).unwrap()
    }

    #[test]
    fn parse_missing_or_corrupt_is_empty() {
        assert!(parse_device_registry(None).is_empty());
        assert!(parse_device_registry(Some("{not json")).is_empty());
    }

    #[test]
    fn upsert_adds_new_entry() {
        let entries = upsert_device(&[], "fable-5", SignerRole::Model, "abc==", now());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].handle, "fable-5");
        assert_eq!(entries[0].role, SignerRole::Model);
    }

    #[test]
    fn upsert_replaces_existing_handle_not_duplicates() {
        let first = upsert_device(&[], "olena", SignerRole::Human, "aaa==", now());
        let second = upsert_device(&first, "olena", SignerRole::Human, "bbb==", now());
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].pubkey_base64, "bbb==");
    }

    #[test]
    fn find_registered_signer_requires_handle_and_pubkey_match() {
        let entries = upsert_device(&[], "olena", SignerRole::Human, "aaa==", now());
        assert!(find_registered_signer(&entries, "olena", "aaa==").is_some());
        assert!(find_registered_signer(&entries, "olena", "wrong==").is_none());
        assert!(find_registered_signer(&entries, "ghost", "aaa==").is_none());
    }

    #[test]
    fn find_by_pubkey_attributes_handle_and_role() {
        let entries = upsert_device(&[], "fable-5", SignerRole::Model, "xyz==", now());
        let found = find_by_pubkey(&entries, "xyz==").unwrap();
        assert_eq!(found.handle, "fable-5");
        assert_eq!(found.role, SignerRole::Model);
        assert!(find_by_pubkey(&entries, "nope==").is_none());
    }

    #[test]
    fn format_device_registry_round_trip() {
        let entries = upsert_device(&[], "olena", SignerRole::Human, "aaa==", now());
        let text = format_device_registry(&entries);
        assert!(text.ends_with('\n'));
        let parsed = parse_device_registry(Some(&text));
        assert_eq!(parsed, entries);
    }
}
