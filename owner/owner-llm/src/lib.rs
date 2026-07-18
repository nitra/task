//! Agent/LLM-логіка owner — тонкий шар над крейтом `llm-cascade` (окреме
//! репо nitra/7n-rules, llm-lib/crates/llm-cascade). Свідомо **без залежності
//! на tauri** (n-tauri: core_test_isolation) — `cargo test -p owner-llm`
//! ганяється без перезбірки Tauri-застосунку.
//!
//! Жодної драбини ACP → local → cloud тут: той самий fail-fast принцип, що
//! й у самому крейті (кожен `one_shot_*` — рівно один виклик). Драбину і
//! рішення «чи дозволена ACP-підписка на цьому вузлі» (autonomy.yml, клас
//! `external_comms`) компонує JS-шар owner
//! (`owner/src/composables/use-llm-cascade.js`) — тут лише дві незалежні
//! точки входу крейта.

use std::collections::HashMap;
use std::path::Path;

use llm_cascade::local_cloud::LocalProvider;
use llm_cascade::{one_shot_acp as cascade_one_shot_acp, AcpAgentKind, LocalCloud, Tier};

fn parse_tier(tier: &str) -> Result<Tier, String> {
    match tier {
        "min" => Ok(Tier::Min),
        "avg" => Ok(Tier::Avg),
        "max" => Ok(Tier::Max),
        other => Err(format!("невідомий тир {other:?}: очікується min|avg|max")),
    }
}

/// `Url::join`-семантика Rust трактує base URL без завершального слеша як
/// "файл" і зʼїдає останній сегмент шляху — `LocalProvider::base_url` мусить
/// завершуватись `/`.
fn with_trailing_slash(mut url: String) -> String {
    if !url.ends_with('/') {
        url.push('/');
    }
    url
}

/// Онбординг-конфіг omlx (UI, localStorage) — єдине джерело моделі local-тиру,
/// доки власник не задав реальний env-контракт `N_LOCAL_*_MODEL`
/// (`@7n/llm-lib`, той самий, що читає `llm_cascade::tiers`). Якщо змінна вже
/// задана ззовні — вона має пріоритет, тут її не чіпаємо.
fn seed_local_tier_env_default(omlx_model: &str) {
    for var in ["N_LOCAL_MIN_MODEL", "N_LOCAL_AVG_MODEL", "N_LOCAL_MAX_MODEL"] {
        if std::env::var(var).is_ok_and(|v| !v.is_empty()) {
            continue;
        }
        // SAFETY: owner — однопотоковий що до читання цих змінних (жоден
        // інший код процесу не читає їх конкурентно); той самий патерн, що
        // й у тестах llm-cascade (tiers.rs).
        unsafe { std::env::set_var(var, format!("omlx/{omlx_model}")) };
    }
}

/// Один виклик локального/хмарного тиру каскаду через `genai`. `omlx_*` —
/// онбординг-конфіг власника (baseUrl/model/apiKey), що йде в
/// `local_providers` крейта під префіксом `omlx`.
///
/// # Errors
/// Невалідний `tier`, відсутня конфігурація тиру (`N_LOCAL_*`/`N_CLOUD_*`),
/// чи помилка самого виклику — усе як `Err(String)`.
pub async fn one_shot(
    tier: &str,
    system: Option<&str>,
    user: &str,
    omlx_base_url: String,
    omlx_model: String,
    omlx_api_key: Option<String>,
) -> Result<String, String> {
    let tier = parse_tier(tier)?;
    seed_local_tier_env_default(&omlx_model);

    let mut providers = HashMap::new();
    providers.insert(
        "omlx".to_string(),
        LocalProvider {
            base_url: with_trailing_slash(omlx_base_url),
            api_key: omlx_api_key.filter(|k| !k.is_empty()),
        },
    );
    let local_cloud = LocalCloud::new(providers);
    local_cloud
        .one_shot(tier, system, user)
        .await
        .map_err(|e| e.to_string())
}

/// Один виклик через ACP — спавнить залогінений локально агентський CLI
/// (`agent acp` чи `codex-acp`) і веде сесію по stdio/JSON-RPC у робочій
/// директорії `cwd` (owner передає `tasksDir` вузла — природний «проєктний»
/// корінь для ACP-сесії). Викликач (JS-драбина) вирішує, чи падати далі на
/// [`one_shot`].
///
/// # Errors
/// Невідомий `agent`, чи агент не встановлений/не залогінений підпискою.
pub async fn one_shot_acp(agent: &str, prompt: &str, cwd: &Path) -> Result<String, String> {
    let kind = match agent {
        "cursor" => AcpAgentKind::Cursor,
        "codex" => AcpAgentKind::Codex,
        other => return Err(format!("невідомий ACP-агент {other:?}: очікується cursor|codex")),
    };
    cascade_one_shot_acp(kind, prompt, cwd).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_tier_accepts_known_values_rejects_unknown() {
        assert!(matches!(parse_tier("min"), Ok(Tier::Min)));
        assert!(matches!(parse_tier("avg"), Ok(Tier::Avg)));
        assert!(matches!(parse_tier("max"), Ok(Tier::Max)));
        assert!(parse_tier("huge").is_err());
    }

    #[test]
    fn with_trailing_slash_appends_only_when_missing() {
        assert_eq!(with_trailing_slash("http://127.0.0.1:8000/v1".to_string()), "http://127.0.0.1:8000/v1/");
        assert_eq!(with_trailing_slash("http://127.0.0.1:8000/v1/".to_string()), "http://127.0.0.1:8000/v1/");
    }

    #[tokio::test]
    async fn one_shot_rejects_unknown_tier_without_touching_env() {
        let err = one_shot("huge", None, "привіт", "http://x/v1".into(), "m".into(), None)
            .await
            .unwrap_err();
        assert!(err.contains("невідомий тир"));
    }

    #[tokio::test]
    async fn one_shot_acp_rejects_unknown_agent() {
        let err = one_shot_acp("claude", "привіт", Path::new(".")).await.unwrap_err();
        assert!(err.contains("невідомий ACP-агент"));
    }
}
