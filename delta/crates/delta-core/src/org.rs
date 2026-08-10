//! Org-level конфіг `.mt/org.json` — порт `delta/src/org.js` (M6, метрика
//! «ціна гейта»). Живе В `mandatesDir`, КОМІТИТЬСЯ в git.

use crate::io::Io;

const DEFAULT_HOURLY_RATE_EUR: f64 = 60.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct OrgConfig {
    pub hourly_rate_eur: f64,
}

pub fn default_org_config() -> OrgConfig {
    OrgConfig {
        hourly_rate_eur: DEFAULT_HOURLY_RATE_EUR,
    }
}

pub fn org_config_path(mandates_dir: &str) -> String {
    format!("{mandates_dir}/.mt/org.json")
}

/// Розбирає `.mt/org.json` — відсутній/битий файл чи невалідне значення
/// повертає дефолт, не кидає (`org.js: parseOrgConfig`).
pub fn parse_org_config(text: Option<&str>) -> OrgConfig {
    let Some(text) = text else {
        return default_org_config();
    };
    if text.trim().is_empty() {
        return default_org_config();
    }
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) else {
        return default_org_config();
    };
    let rate = parsed
        .get("hourly_rate_eur")
        .and_then(|v| v.as_f64())
        .filter(|r| *r > 0.0)
        .unwrap_or(DEFAULT_HOURLY_RATE_EUR);
    OrgConfig {
        hourly_rate_eur: rate,
    }
}

pub fn format_org_config(config: &OrgConfig) -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(
            &serde_json::json!({"hourly_rate_eur": config.hourly_rate_eur})
        )
        .unwrap()
    )
}

/// Читає org-конфіг через `Io` — відсутність файлу — дефолт, не помилка
/// (`org.js: loadOrgConfig`).
pub async fn load_org_config(io: &dyn Io, mandates_dir: &str) -> OrgConfig {
    parse_org_config(
        io.read_file(&org_config_path(mandates_dir))
            .await
            .as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::MemoryIo;

    #[test]
    fn default_config_is_60_eur() {
        assert_eq!(default_org_config().hourly_rate_eur, 60.0);
    }

    #[test]
    fn parse_missing_or_invalid_is_default() {
        assert_eq!(parse_org_config(None).hourly_rate_eur, 60.0);
        assert_eq!(parse_org_config(Some("not json")).hourly_rate_eur, 60.0);
        assert_eq!(
            parse_org_config(Some(r#"{"hourly_rate_eur": -5}"#)).hourly_rate_eur,
            60.0
        );
    }

    #[test]
    fn parse_valid_rate() {
        assert_eq!(
            parse_org_config(Some(r#"{"hourly_rate_eur": 45}"#)).hourly_rate_eur,
            45.0
        );
    }

    #[test]
    fn format_round_trip() {
        let config = OrgConfig {
            hourly_rate_eur: 45.0,
        };
        let text = format_org_config(&config);
        assert_eq!(parse_org_config(Some(&text)).hourly_rate_eur, 45.0);
    }

    #[tokio::test]
    async fn load_org_config_missing_file_is_default() {
        let io = MemoryIo::default();
        let config = load_org_config(&io, "/root").await;
        assert_eq!(config.hourly_rate_eur, 60.0);
    }
}
