//! Ed25519-підпис пристрою — порт `delta/src/signing.js` на
//! `ed25519-dalek` (mt: `docs/architecture/access.md` — «Кожен пристрій має
//! Ed25519 keypair»; `docs/architecture/mandates.md`, «Розширення
//! ApprovalResponse»).
//!
//! **Канонікалізація** — байт-у-байт той самий формат, що JS
//! (`sortKeysDeep` + компактний `JSON.stringify`): рекурсивне сортування
//! ключів об'єктів (НЕ елементів масивів — порядок масиву семантичний),
//! без пробілів. Реалізовано явним рекурсивним сортуванням `serde_json::
//! Value`, а не покладанням на дефолтну поведінку `serde_json::Map`
//! (BTreeMap без фічі `preserve_order`) — Cargo уніфікує фічі одного
//! пакета на весь build graph, тож `preserve_order`, увімкнена десь ще у
//! графі (напр. `mt-mandates`/upstream), інакше тихо зламала б сортування.
//!
//! **Сумісність з `device_key.json`, записаним Web Crypto (JS, `crypto.
//! subtle.generateKey({name:'Ed25519'})`).** JWK OKP/Ed25519 приватного
//! ключа несе сирий 32-байтний seed у полі `d` (base64url без padding) —
//! той самий формат, що приймає `ed25519_dalek::SigningKey::from_bytes`.
//! Існуючий файл читається напряму (без пересборки/regen), якщо `d`
//! декодується у 32 байти і похідний публічний ключ збігається з `x`/
//! `publicKeyBase64` файлу — фактична перевірка сумісності, не сліпе
//! читання. Несумісний/битий файл — та сама доля, що відсутній: новий
//! keypair генерується `ed25519-dalek`-стороною, `created: true`; якщо
//! оригінальний текст існував, але виявився несумісним (а не просто
//! відсутнім/порожнім), позначаємо `migrated_from_web_crypto: true` —
//! задокументована міграційна позначка (демо-стадія, ключі не в проді).

use base64::engine::general_purpose::{STANDARD as B64_STD, URL_SAFE_NO_PAD as B64_URL};
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};
use serde_json::{Map, Value};

/// 32 криптографічно випадкові байти з ОС-джерела ентропії (`getrandom`) —
/// незалежно від `rand`/`rand_core`-версії, яку інші крейти графу залежностей
/// притягують для СВОЇХ цілей (Cargo уніфікує версії пакета на весь build
/// graph; `ed25519-dalek 3.0` і різні транзитивні залежники вимагали б
/// несумісних `rand_core 0.9`/`0.10` одночасно — обходимо це, не покладаючись
/// на фічу `rand_core` `ed25519-dalek`).
fn random_seed() -> [u8; 32] {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).expect("ОС-джерело ентропії доступне");
    seed
}

/// Канонічна серіалізація значення для підпису — 1:1 з `signing.js:
/// canonicalize`.
pub fn canonicalize(value: &Value) -> String {
    serde_json::to_string(&sort_keys_deep(value)).expect("Value серіалізується без помилок")
}

fn sort_keys_deep(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(sort_keys_deep).collect()),
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut sorted = Map::new();
            for key in keys {
                sorted.insert(key.clone(), sort_keys_deep(&map[key]));
            }
            Value::Object(sorted)
        }
        other => other.clone(),
    }
}

/// Портативний keypair пристрою — JWK-форма сумісна з Web Crypto-виходом
/// JS (`crv`, `kty`, `x`/`d` base64url), плюс `publicKeyBase64` (стандартний
/// base64 з padding — той самий шлях, що `signing.js: base64FromBytes`).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DeviceKeypair {
    pub public_key_jwk: Value,
    pub private_key_jwk: Value,
    pub public_key_base64: String,
}

/// Завантажений/згенерований ключ пристрою — обгортка над [`DeviceKeypair`]
/// з метаданими персисту (`signing.js: loadOrCreateDeviceKey`).
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceKey {
    pub keypair: DeviceKeypair,
    pub created_at: String,
    pub created: bool,
    /// `true` — існуючий JSON був присутній, але несумісний з
    /// `ed25519-dalek` (Web Crypto pkcs8/інший формат) — новий keypair
    /// згенеровано замість нього; задокументована різниця з JS, де ключ
    /// завжди генерувався й читався тим самим Web Crypto API (несумісності
    /// не було).
    pub migrated_from_web_crypto: bool,
}

fn public_jwk(raw_public: &[u8; 32]) -> Value {
    serde_json::json!({
        "crv": "Ed25519",
        "ext": true,
        "key_ops": ["verify"],
        "kty": "OKP",
        "x": B64_URL.encode(raw_public),
    })
}

fn private_jwk(raw_public: &[u8; 32], seed: &[u8; 32]) -> Value {
    serde_json::json!({
        "crv": "Ed25519",
        "ext": true,
        "key_ops": ["sign"],
        "kty": "OKP",
        "x": B64_URL.encode(raw_public),
        "d": B64_URL.encode(seed),
    })
}

/// Генерує новий Ed25519-keypair пристрою (`signing.js:
/// generateDeviceKeypair`).
pub fn generate_device_keypair() -> DeviceKeypair {
    let signing_key = SigningKey::from_bytes(&random_seed());
    let verifying_key = signing_key.verifying_key();
    let raw_public: [u8; 32] = verifying_key.to_bytes();
    let seed: [u8; 32] = signing_key.to_bytes();
    DeviceKeypair {
        public_key_jwk: public_jwk(&raw_public),
        private_key_jwk: private_jwk(&raw_public, &seed),
        public_key_base64: B64_STD.encode(raw_public),
    }
}

/// Декодує 32-байтний seed з поля `d` приватного JWK, якщо форма сумісна з
/// `ed25519-dalek` (base64url, рівно 32 байти). `pub(crate)` — `mandate_change.rs`
/// потребує СИРИЙ `ed25519_dalek::SigningKey` пристрою (не канонікалізований
/// JSON-підпис цього модуля) для підписів через `mt_mandates::change`
/// (domain-separated хеш, інший крипто-шлях, той самий фізичний ключ).
pub(crate) fn signing_key_from_jwk(private_jwk: &Value) -> Option<SigningKey> {
    let d = private_jwk.get("d")?.as_str()?;
    let seed_bytes = B64_URL.decode(d).ok()?;
    let seed: [u8; 32] = seed_bytes.try_into().ok()?;
    Some(SigningKey::from_bytes(&seed))
}

/// Завантажує ключ пристрою з тексту файлу, або генерує новий, якщо файл
/// відсутній/битий/несумісний. Транспорт (CLI/Tauri) відповідає за персист
/// результату, коли `created: true` — цей модуль fs не торкається
/// (`signing.js: loadOrCreateDeviceKey`).
pub fn load_or_create_device_key(existing_json_text: Option<&str>) -> DeviceKey {
    let text = existing_json_text.unwrap_or("").trim();
    if !text.is_empty() {
        if let Ok(keypair) = serde_json::from_str::<DeviceKeypair>(text) {
            if let Some(signing_key) = signing_key_from_jwk(&keypair.private_key_jwk) {
                let derived_public = B64_STD.encode(signing_key.verifying_key().to_bytes());
                if derived_public == keypair.public_key_base64 {
                    let created_at = serde_json::from_str::<Value>(text)
                        .ok()
                        .and_then(|v| {
                            v.get("createdAt")
                                .and_then(|c| c.as_str())
                                .map(str::to_string)
                        })
                        .unwrap_or_default();
                    return DeviceKey {
                        keypair,
                        created_at,
                        created: false,
                        migrated_from_web_crypto: false,
                    };
                }
            }
        }
        // Текст був, але несумісний/битий — регенеруємо з міграційною
        // позначкою (не той самий шлях, що "файл відсутній").
        let keypair = generate_device_keypair();
        return DeviceKey {
            keypair,
            created_at: chrono::Utc::now().to_rfc3339(),
            created: true,
            migrated_from_web_crypto: true,
        };
    }
    let keypair = generate_device_keypair();
    DeviceKey {
        keypair,
        created_at: chrono::Utc::now().to_rfc3339(),
        created: true,
        migrated_from_web_crypto: false,
    }
}

/// Джерело публічного ключа для перевірки — JWK, або base64 raw
/// (`signing.js: resolvePublicKey`, звужено до варіантів, релевантних цій
/// Rust-стороні: тут завжди є конкретні байти, немає `CryptoKey`-обгортки).
pub enum PublicKeySource<'a> {
    Jwk(&'a Value),
    Base64(&'a str),
}

fn resolve_verifying_key(source: PublicKeySource<'_>) -> Option<VerifyingKey> {
    let raw: [u8; 32] = match source {
        PublicKeySource::Base64(b64) => B64_STD.decode(b64).ok()?.try_into().ok()?,
        PublicKeySource::Jwk(jwk) => {
            let x = jwk.get("x")?.as_str()?;
            B64_URL.decode(x).ok()?.try_into().ok()?
        }
    };
    VerifyingKey::from_bytes(&raw).ok()
}

/// Підписує канонікалізований payload приватним ключем пристрою
/// (`signing.js: signPayload`).
pub fn sign_payload(private_key_jwk: &Value, payload: &Value) -> Option<String> {
    let signing_key = signing_key_from_jwk(private_key_jwk)?;
    let bytes = canonicalize(payload).into_bytes();
    let signature = signing_key.sign(&bytes);
    Some(B64_STD.encode(signature.to_bytes()))
}

/// Перевіряє підпис payload проти публічного ключа (`signing.js:
/// verifyPayload`).
pub fn verify_payload(
    public_key: PublicKeySource<'_>,
    payload: &Value,
    signature_base64: &str,
) -> bool {
    let Some(verifying_key) = resolve_verifying_key(public_key) else {
        return false;
    };
    let Ok(sig_bytes) = B64_STD.decode(signature_base64) else {
        return false;
    };
    let Ok(sig_bytes): Result<[u8; 64], _> = sig_bytes.try_into() else {
        return false;
    };
    let signature = ed25519_dalek::Signature::from_bytes(&sig_bytes);
    let bytes = canonicalize(payload).into_bytes();
    verifying_key.verify(&bytes, &signature).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonicalize_sorts_object_keys_recursively() {
        let a = canonicalize(&json!({"b": 1, "a": {"d": 2, "c": 3}}));
        let b = canonicalize(&json!({"a": {"c": 3, "d": 2}, "b": 1}));
        assert_eq!(a, b);
        assert_eq!(a, r#"{"a":{"c":3,"d":2},"b":1}"#);
    }

    #[test]
    fn canonicalize_does_not_sort_array_elements() {
        assert_eq!(canonicalize(&json!({"a": [3, 1, 2]})), r#"{"a":[3,1,2]}"#);
    }

    #[test]
    fn canonicalize_is_compact_no_whitespace() {
        assert!(!canonicalize(&json!({"x": 1})).contains(' '));
    }

    #[test]
    fn generate_device_keypair_produces_valid_ed25519_jwk() {
        let keypair = generate_device_keypair();
        assert_eq!(keypair.public_key_jwk["kty"], "OKP");
        assert_eq!(keypair.public_key_jwk["crv"], "Ed25519");
        assert!(!keypair.public_key_base64.is_empty());
    }

    #[test]
    fn sign_verify_round_trip_jwk_and_base64() {
        let keypair = generate_device_keypair();
        let payload = json!({"hello": "world", "n": 42});
        let sig = sign_payload(&keypair.private_key_jwk, &payload).expect("signs");
        assert!(verify_payload(
            PublicKeySource::Jwk(&keypair.public_key_jwk),
            &payload,
            &sig
        ));
        assert!(verify_payload(
            PublicKeySource::Base64(&keypair.public_key_base64),
            &payload,
            &sig
        ));
    }

    #[test]
    fn signature_does_not_verify_against_foreign_public_key() {
        let a = generate_device_keypair();
        let b = generate_device_keypair();
        let payload = json!({"a": 1});
        let sig = sign_payload(&a.private_key_jwk, &payload).expect("signs");
        assert!(!verify_payload(
            PublicKeySource::Jwk(&b.public_key_jwk),
            &payload,
            &sig
        ));
    }

    #[test]
    fn tampering_payload_after_signing_breaks_verification() {
        let keypair = generate_device_keypair();
        let sig = sign_payload(&keypair.private_key_jwk, &json!({"a": 1, "b": 2})).expect("signs");
        assert!(!verify_payload(
            PublicKeySource::Jwk(&keypair.public_key_jwk),
            &json!({"a": 1, "b": 3}),
            &sig
        ));
    }

    #[test]
    fn field_construction_order_does_not_affect_signature() {
        let keypair = generate_device_keypair();
        let sig = sign_payload(&keypair.private_key_jwk, &json!({"b": 2, "a": 1})).expect("signs");
        assert!(verify_payload(
            PublicKeySource::Jwk(&keypair.public_key_jwk),
            &json!({"a": 1, "b": 2}),
            &sig
        ));
    }

    #[test]
    fn load_or_create_device_key_missing_text_generates_new() {
        let key = load_or_create_device_key(None);
        assert!(key.created);
        assert!(!key.migrated_from_web_crypto);
    }

    #[test]
    fn load_or_create_device_key_corrupt_json_generates_new_with_migration_flag() {
        let key = load_or_create_device_key(Some("{not json"));
        assert!(key.created);
        assert!(key.migrated_from_web_crypto);
    }

    #[test]
    fn load_or_create_device_key_valid_existing_returns_it() {
        let generated = generate_device_keypair();
        let stored = serde_json::to_string(&generated).unwrap();
        let loaded = load_or_create_device_key(Some(&stored));
        assert!(!loaded.created);
        assert_eq!(
            loaded.keypair.public_key_base64,
            generated.public_key_base64
        );
    }

    /// Крос-мовна сумісність: справжній JWK/підпис, згенерований Web
    /// Crypto (`bun`, `delta/src/signing.js: generateDeviceKeypair` +
    /// `signPayload`) — Rust читає той самий приватний ключ і верифікує ТОЙ
    /// САМИЙ підпис проти ТОГО САМОГО canonical payload. Доводить, що
    /// існуючі `device_key.json`/фікстури підписів, записані JS-стороною,
    /// лишаються верифіковними після заміни на Rust (задокументована умова
    /// завдання: «якщо неможливо — перегенеруй фікстури» — тут МОЖЛИВО,
    /// нічого перегенеровувати не довелось).
    #[test]
    fn cross_language_fixture_from_web_crypto_verifies_in_rust() {
        let private_key_jwk = json!({
            "crv": "Ed25519",
            "ext": true,
            "key_ops": ["sign"],
            "kty": "OKP",
            "x": "gYrXlayUpFqTD16Lyhl25Qh9xFAfQQOMfYx7L1IO9yY",
            "d": "Jn94ZGUCm1RCXfZMixE1pCCRuIhWuTVd7nbuccy4NS0"
        });
        let public_key_jwk = json!({
            "crv": "Ed25519",
            "ext": true,
            "key_ops": ["verify"],
            "kty": "OKP",
            "x": "gYrXlayUpFqTD16Lyhl25Qh9xFAfQQOMfYx7L1IO9yY"
        });
        let public_key_base64 = "gYrXlayUpFqTD16Lyhl25Qh9xFAfQQOMfYx7L1IO9yY=";
        let payload = json!({
            "schema_version": 1,
            "request_id": "demo-1/0001",
            "approved": true,
            "chosen_option": "B",
            "quiz_ref": "decisions/0001-quiz.md",
            "signed_at": "2026-08-10T12:00:00.000Z"
        });
        let expected_canonical = r#"{"approved":true,"chosen_option":"B","quiz_ref":"decisions/0001-quiz.md","request_id":"demo-1/0001","schema_version":1,"signed_at":"2026-08-10T12:00:00.000Z"}"#;
        assert_eq!(canonicalize(&payload), expected_canonical);

        let js_signature = "jz2G6Qsd9sHNU4nfXB+V2DyLJEXBBGZ41Vo/J8+EWzerqjRdf51LVOLB+0b4ejyAXnl4w8p0Nrw+/D6H86YiCA==";
        assert!(verify_payload(
            PublicKeySource::Jwk(&public_key_jwk),
            &payload,
            js_signature
        ));
        assert!(verify_payload(
            PublicKeySource::Base64(public_key_base64),
            &payload,
            js_signature
        ));

        // Rust, підписуючи ТИМ САМИМ ключем ТОЙ САМИЙ payload, відтворює
        // байт-у-байт той самий підпис Ed25519 (детермінований — RFC 8032).
        let rust_signature = sign_payload(&private_key_jwk, &payload).expect("signs");
        assert_eq!(rust_signature, js_signature);
    }
}
