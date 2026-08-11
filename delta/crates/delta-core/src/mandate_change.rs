//! Застосування зміни `.mt/mandates.yaml` — тонкий bridge над
//! `mt_mandates::change` (domain-hash Ed25519, `mt-mandate-change-v1`).
//!
//! **Заміна JS-крипто мока, не порт byte-у-byte.** Стара `mandate-change.js`
//! підписувала ПОВНИЙ канонікалізований payload через `signing.js`
//! (той самий шлях, що `ApprovalResponse`) — задокументована власна
//! криптосхема M3, відмінна від `mt-rust/crates/mt-mandates/src/change.rs`.
//! Фаза A замінює це справжнім викликом `mt_mandates::{sign_mandate_change,
//! validate_mandate_change}` — domain-separated хеш
//! (`DOMAIN \0 old_generation \0 new_generation \0 sha256(new_file)_hex`),
//! перевірений crate mt-rust. **Наслідок:** старі демо-підписи
//! mandate-change (M3-фікстури, підписані через `signPayload`) стають
//! криптографічно невалідними проти нового домену — очікувано, не регресія
//! (задокументовано в README/change-файлі фази A); ApprovalResponse
//! decision-request-гейта (`approval.rs`) НЕ зачеплений — той шлях і далі
//! свій власний канонікалізований JSON-підпис (окрема крипто-схема, той
//! самий фізичний ключ підписує ОБИДВА незалежно, mist `change_proposal.rs`).

use mt_mandates::{
    sign_mandate_change, validate_mandate_change, MandateChangePayload, MandateChangeSignature,
    MandateSigner, MandatesFile, Verdict,
};
use serde_json::{json, Value};

use crate::io::Io;
use crate::signing::{signing_key_from_jwk, DeviceKeypair};

/// Серіалізує `{generation, mandates}` назад у YAML — `mt_mandates::
/// MandatesFile` власним derive (snake_case, контрактна форма
/// `.mt/mandates.yaml`) через `serde_norway`.
pub fn format_mandates_yaml(file: &MandatesFile) -> String {
    serde_norway::to_string(file).expect("MandatesFile серіалізується в YAML без помилок")
}

/// Підписує акт зміни ФІЗИЧНИМ ключем пристрою (JWK) через
/// `mt_mandates::sign_mandate_change` — розпаковує сирий Ed25519-seed з
/// JWK (`signing::signing_key_from_jwk`, той самий ключ, що підписує
/// `ApprovalResponse`, інша крипто-схема для ЦЬОГО акту).
pub fn sign_mandate_change_act(
    device_key: &DeviceKeypair,
    old_generation: u64,
    new_file: &MandatesFile,
) -> Option<Vec<u8>> {
    let signing_key = signing_key_from_jwk(&device_key.private_key_jwk)?;
    let payload = MandateChangePayload::for_file(old_generation, new_file);
    Some(
        sign_mandate_change(&signing_key, &payload)
            .to_bytes()
            .to_vec(),
    )
}

fn verdict_to_json(verdict: Verdict) -> Value {
    match verdict {
        Verdict::Valid => json!({"valid": true}),
        Verdict::Invalid(reason) => json!({"valid": false, "reason": reason}),
    }
}

/// Застосовує зміну — пише новий `.mt/mandates.yaml` ЛИШЕ після
/// Valid-вердикту `mt_mandates::validate_mandate_change` (fail-closed:
/// Invalid — файл не чіпається).
pub async fn apply_mandate_change_if_valid(
    io: &dyn Io,
    mandates_yaml_path: &str,
    old: &MandatesFile,
    new_file: &MandatesFile,
    signatures: &[MandateChangeSignature],
) -> Value {
    let verdict = validate_mandate_change(old, new_file, signatures);
    if !verdict.is_valid() {
        return verdict_to_json(verdict);
    }
    io.write_file(mandates_yaml_path, &format_mandates_yaml(new_file))
        .await;
    verdict_to_json(verdict)
}

/// Будує один `MandateSigner` з ключа пристрою + заявленого handle/ролі —
/// хелпер для викликачів (`change_proposal.rs`), щоб не імпортувати
/// `ed25519_dalek`/`mt_mandates` напряму на боці CLI/Tauri.
pub fn mandate_signer(
    handle: &str,
    role: crate::device_registry::SignerRole,
    device_key: &DeviceKeypair,
) -> Option<MandateSigner> {
    let signing_key = signing_key_from_jwk(&device_key.private_key_jwk)?;
    Some(MandateSigner {
        handle: handle.to_string(),
        role: role.into(),
        pubkey: signing_key.verifying_key(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device_registry::SignerRole;
    use crate::io::MemoryIo;
    use crate::signing::generate_device_keypair;
    use crate::test_support::base_file;
    use mt_mandates::AudacityLevel;

    #[test]
    fn format_mandates_yaml_round_trips_through_parse_mandates() {
        let file = base_file(1);
        let text = format_mandates_yaml(&file);
        let parsed = mt_mandates::parse_mandates_str(&text).unwrap();
        assert_eq!(parsed, file);
    }

    #[tokio::test]
    async fn narrowing_without_self_signature_is_invalid() {
        let old = base_file(1);
        let mut new_file = base_file(2);
        new_file.mandates[0].thresholds.budget_eur = Some(1000.0);
        let io = MemoryIo::default();
        let result =
            apply_mandate_change_if_valid(&io, "/x/.mt/mandates.yaml", &old, &new_file, &[]).await;
        assert_eq!(result["valid"], false);
        assert!(!io.has("/x/.mt/mandates.yaml"));
    }

    #[tokio::test]
    async fn narrowing_with_self_signature_applies_and_writes_file() {
        let old = base_file(1);
        let mut new_file = base_file(2);
        new_file.mandates[0].thresholds.budget_eur = Some(1000.0);
        let keypair = generate_device_keypair();
        let sig_bytes = sign_mandate_change_act(&keypair, 1, &new_file).unwrap();
        let signer = mandate_signer("olena", SignerRole::Human, &keypair).unwrap();
        let io = MemoryIo::default();
        let result = apply_mandate_change_if_valid(
            &io,
            "/x/.mt/mandates.yaml",
            &old,
            &new_file,
            &[MandateChangeSignature {
                signer,
                signature: sig_bytes,
            }],
        )
        .await;
        assert_eq!(result["valid"], true);
        assert!(io.has("/x/.mt/mandates.yaml"));
    }

    #[tokio::test]
    async fn model_mandate_widening_rejects_model_signature_last_constant() {
        let old = base_file(1);
        let mut new_file = base_file(2);
        new_file.mandates[2].thresholds.audacity = Some(AudacityLevel::High); // widen fable-5
        let keypair = generate_device_keypair(); // signed as olena (delegator) but with role Model
        let sig_bytes = sign_mandate_change_act(&keypair, 1, &new_file).unwrap();
        let signer = mandate_signer("olena", SignerRole::Model, &keypair).unwrap();
        let io = MemoryIo::default();
        let result = apply_mandate_change_if_valid(
            &io,
            "/x/.mt/mandates.yaml",
            &old,
            &new_file,
            &[MandateChangeSignature {
                signer,
                signature: sig_bytes,
            }],
        )
        .await;
        assert_eq!(result["valid"], false);
        assert!(result["reason"].as_str().unwrap().contains("людський"));
        assert!(!io.has("/x/.mt/mandates.yaml"));
    }

    #[tokio::test]
    async fn model_mandate_widening_with_human_delegator_signature_is_valid() {
        let old = base_file(1);
        let mut new_file = base_file(2);
        new_file.mandates[2].thresholds.audacity = Some(AudacityLevel::High);
        let keypair = generate_device_keypair();
        let sig_bytes = sign_mandate_change_act(&keypair, 1, &new_file).unwrap();
        let signer = mandate_signer("olena", SignerRole::Human, &keypair).unwrap();
        let io = MemoryIo::default();
        let result = apply_mandate_change_if_valid(
            &io,
            "/x/.mt/mandates.yaml",
            &old,
            &new_file,
            &[MandateChangeSignature {
                signer,
                signature: sig_bytes,
            }],
        )
        .await;
        assert_eq!(result["valid"], true);
    }
}
