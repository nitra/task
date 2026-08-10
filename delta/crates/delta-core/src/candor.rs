//! Панель «незручна правда» — ШІ-кандор — порт `delta/src/candor.js`
//! (M5). Власний лог `.mt/candor/{handle}.jsonl` (append-only JSONL),
//! ВІДДІЛЕНИЙ від `decisions/`/`notifications/{handle}.jsonl` watcher-а —
//! інший інбокс, щоб «не губилось і не пом'якшувалось». Бюджет зухвалості
//! запису ≤ `thresholds.audacity` мандата моделі (`trust::audacity_of`).
//! Позначка «прочитано» — локальна, поза git (`KnowledgeIo`-сайдкар),
//! НЕ синхронізується між пристроями/людьми.

use std::collections::HashSet;

use mt_mandates::{AudacityLevel, MandateKind, MandatesFile};
use serde_json::{json, Value};

use crate::io::{Io, KnowledgeIo};

pub fn candor_log_path(mandates_dir: &str, handle: &str) -> String {
    format!("{mandates_dir}/.mt/candor/{handle}.jsonl")
}

/// Розбирає JSONL-лог кандору — фейл-сейф, той самий підхід, що
/// `watcher::parse_notifications_log` (битий рядок пропускається).
pub fn parse_candor_log(text: Option<&str>) -> Vec<Value> {
    let Some(text) = text else {
        return Vec::new();
    };
    text.split(['\r', '\n'])
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

fn audacity_rank(level: AudacityLevel) -> u8 {
    match level {
        AudacityLevel::Low => 0,
        AudacityLevel::Medium => 1,
        AudacityLevel::High => 2,
    }
}

fn parse_audacity_level(s: &str) -> Option<AudacityLevel> {
    match s {
        "low" => Some(AudacityLevel::Low),
        "medium" => Some(AudacityLevel::Medium),
        "high" => Some(AudacityLevel::High),
        _ => None,
    }
}

/// Кидає, якщо `audacity_level` перевищує бюджет зухвалості мандата
/// моделі — модель без мандата (чи не `kind: model`) теж відхилено
/// (`candor.js: validateCandorAudacity`).
pub fn validate_candor_audacity(
    mandates_file: &MandatesFile,
    from_model_handle: &str,
    audacity_level: &str,
) -> Result<(), String> {
    let mandate = mandates_file
        .mandates
        .iter()
        .find(|m| m.owner == from_model_handle);
    let Some(mandate) = mandate else {
        return Err(format!("ai_candor: '{from_model_handle}' не має ШІ-мандата (kind: model) — кандор без мандата відхилено"));
    };
    if mandate.kind != MandateKind::Model {
        return Err(format!("ai_candor: '{from_model_handle}' не має ШІ-мандата (kind: model) — кандор без мандата відхилено"));
    }
    let budget = mandate.thresholds.audacity_or_default();
    let level = parse_audacity_level(audacity_level).unwrap_or(AudacityLevel::High);
    if audacity_rank(level) > audacity_rank(budget) {
        let budget_str = match budget {
            AudacityLevel::Low => "low",
            AudacityLevel::Medium => "medium",
            AudacityLevel::High => "high",
        };
        return Err(format!(
            "ai_candor: audacity_level '{audacity_level}' перевищує бюджет зухвалості мандата '{from_model_handle}' ('{budget_str}') — модель не може палити заяви понад власний бюджет (mandates.md: «зухвалість обмежена»)"
        ));
    }
    Ok(())
}

/// Будує один кандор-запис — `{from_model, statement, evidence_refs,
/// audacity_level, created_at}` (`candor.js: buildCandorRecord`).
pub fn build_candor_record(
    from_model_handle: &str,
    statement: &str,
    evidence_refs: &[String],
    audacity_level: &str,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Value {
    json!({
        "from_model": from_model_handle,
        "statement": statement,
        "evidence_refs": evidence_refs,
        "audacity_level": audacity_level,
        "created_at": now.unwrap_or_else(chrono::Utc::now).to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    })
}

/// Дописує один кандор-запис у JSONL-лог адресата — read-append-write, той
/// самий патерн, що `watcher::append_notifications` (`candor.js:
/// appendCandorRecord`).
pub async fn append_candor_record(io: &dyn Io, path: &str, record: &Value) {
    let existing = io.read_file(path).await.unwrap_or_default();
    let prefix = if !existing.is_empty() && !existing.ends_with('\n') {
        format!("{existing}\n")
    } else {
        existing
    };
    io.write_file(path, &format!("{prefix}{record}\n")).await;
}

/// `id` стабільний для одного кандор-запису — композиція з полів запису,
/// не окремий лічильник (`candor.js: candorId`).
pub fn candor_id(record: &Value) -> String {
    format!(
        "{}@{}",
        record["from_model"].as_str().unwrap_or_default(),
        record["created_at"].as_str().unwrap_or_default()
    )
}

/// headless-tool `ai_candor` — формує, валідує (бюджет зухвалості) і
/// дописує кандор-запис у лог адресата (`candor.js: aiCandor`).
#[allow(clippy::too_many_arguments)]
pub async fn ai_candor(
    io: &dyn Io,
    mandates_dir: &str,
    to_handle: &str,
    from_model_handle: &str,
    statement: &str,
    evidence_refs: &[String],
    audacity_level: &str,
    mandates_file: &MandatesFile,
    now: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Value, String> {
    validate_candor_audacity(mandates_file, from_model_handle, audacity_level)?;
    let record = build_candor_record(
        from_model_handle,
        statement,
        evidence_refs,
        audacity_level,
        now,
    );
    let path = candor_log_path(mandates_dir, to_handle);
    append_candor_record(io, &path, &record).await;
    Ok(json!({"path": path, "record": record}))
}

/// Розбирає локальні позначки «прочитано» — фейл-сейф, той самий
/// підхід, що `knowledge`-парсери (`candor.js: parseCandorReadMarks`).
pub fn parse_candor_read_marks(text: Option<&str>) -> HashSet<String> {
    let Some(text) = text else {
        return HashSet::new();
    };
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Array(items)) => items
            .into_iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        _ => HashSet::new(),
    }
}

pub fn format_candor_read_marks(read_ids: &HashSet<String>) -> String {
    let mut sorted: Vec<&String> = read_ids.iter().collect();
    sorted.sort();
    format!(
        "{}\n",
        serde_json::to_string_pretty(&sorted).expect("Vec<&String> серіалізується без помилок")
    )
}

/// Тіло `candor_show` — читає лог адресата й позначки «прочитано» ЦЬОГО
/// пристрою, повертає записи з доданими `id`/`read` (`candor.js:
/// candorShow`).
pub async fn candor_show(
    io: &dyn Io,
    mandates_dir: &str,
    handle: &str,
    read_marks_io: Option<&dyn KnowledgeIo>,
) -> Vec<Value> {
    let text = io.read_file(&candor_log_path(mandates_dir, handle)).await;
    let records = parse_candor_log(text.as_deref());
    let read_ids = match read_marks_io {
        Some(read_marks_io) => parse_candor_read_marks(read_marks_io.read().await.as_deref()),
        None => HashSet::new(),
    };
    records
        .into_iter()
        .map(|mut r| {
            let id = candor_id(&r);
            let read = read_ids.contains(&id);
            let obj = r.as_object_mut().expect("candor-запис завжди JSON-обʼєкт");
            obj.insert("id".to_string(), json!(id));
            obj.insert("read".to_string(), json!(read));
            r
        })
        .collect()
}

/// Тіло `candor_mark_read` — додає `id` до локальних позначок «прочитано»
/// ЦЬОГО пристрою (`candor.js: markCandorRead`).
pub async fn mark_candor_read(read_marks_io: &dyn KnowledgeIo, id: &str) {
    let mut read_ids = parse_candor_read_marks(read_marks_io.read().await.as_deref());
    read_ids.insert(id.to_string());
    read_marks_io
        .write(&format_candor_read_marks(&read_ids))
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::{MemoryIo, MemoryKnowledgeIo};
    use mt_mandates::{Mandate, Scope, Thresholds};

    fn mandates_fixture() -> MandatesFile {
        MandatesFile {
            generation: 1,
            mandates: vec![
                Mandate {
                    owner: "fable-5".into(),
                    kind: MandateKind::Model,
                    scope: Scope {
                        refs: vec!["refs/mt/tasks/routine/**".into()],
                        decision_types: vec!["ops".into()],
                    },
                    thresholds: Thresholds {
                        audacity: Some(AudacityLevel::Medium),
                        ..Default::default()
                    },
                    escalates_to: Some("olena".into()),
                },
                Mandate {
                    owner: "olena".into(),
                    kind: MandateKind::Person,
                    scope: Scope {
                        refs: vec!["refs/mt/tasks/design/**".into()],
                        decision_types: vec!["architecture".into()],
                    },
                    thresholds: Thresholds::default(),
                    escalates_to: Some("vitalii".into()),
                },
            ],
        }
    }

    fn now() -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339("2026-08-09T10:00:00.000Z")
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    #[test]
    fn candor_log_path_is_separated_from_notifications() {
        assert_eq!(
            candor_log_path("/root", "olena"),
            "/root/.mt/candor/olena.jsonl"
        );
    }

    #[test]
    fn validate_within_budget_ok() {
        let mandates = mandates_fixture();
        assert!(validate_candor_audacity(&mandates, "fable-5", "low").is_ok());
        assert!(validate_candor_audacity(&mandates, "fable-5", "medium").is_ok());
    }

    #[test]
    fn validate_over_budget_errors() {
        let mandates = mandates_fixture();
        let err = validate_candor_audacity(&mandates, "fable-5", "high").unwrap_err();
        assert!(err.contains("перевищує бюджет зухвалості"));
    }

    #[test]
    fn validate_no_model_mandate_errors() {
        let mandates = mandates_fixture();
        let err = validate_candor_audacity(&mandates, "ghost-model", "low").unwrap_err();
        assert!(err.contains("не має ШІ-мандата"));
    }

    #[test]
    fn validate_person_handle_errors() {
        let mandates = mandates_fixture();
        let err = validate_candor_audacity(&mandates, "olena", "low").unwrap_err();
        assert!(err.contains("не має ШІ-мандата"));
    }

    #[tokio::test]
    async fn ai_candor_valid_appends_to_separated_log() {
        let io = MemoryIo::default();
        let mandates = mandates_fixture();
        let result = ai_candor(
            &io,
            "/root",
            "olena",
            "fable-5",
            "Ти три тижні не піднімаєш ціну постачальнику X.",
            &["runs/demo-1/decisions/0001-decision-request.md".to_string()],
            "medium",
            &mandates,
            Some(now()),
        )
        .await
        .unwrap();
        assert_eq!(result["path"], "/root/.mt/candor/olena.jsonl");
        let entries = parse_candor_log(io.get("/root/.mt/candor/olena.jsonl").as_deref());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["from_model"], "fable-5");
        assert_eq!(entries[0]["audacity_level"], "medium");
        assert_eq!(entries[0]["created_at"], "2026-08-09T10:00:00.000Z");
    }

    #[tokio::test]
    async fn ai_candor_over_budget_writes_nothing() {
        let io = MemoryIo::default();
        let mandates = mandates_fixture();
        let err = ai_candor(
            &io,
            "/root",
            "olena",
            "fable-5",
            "x",
            &[],
            "high",
            &mandates,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("перевищує бюджет"));
        assert!(io.get("/root/.mt/candor/olena.jsonl").is_none());
    }

    #[tokio::test]
    async fn second_record_appends_not_overwrites() {
        let io = MemoryIo::default();
        let mandates = mandates_fixture();
        ai_candor(
            &io,
            "/root",
            "olena",
            "fable-5",
            "перше",
            &[],
            "low",
            &mandates,
            None,
        )
        .await
        .unwrap();
        ai_candor(
            &io,
            "/root",
            "olena",
            "fable-5",
            "друге",
            &[],
            "low",
            &mandates,
            None,
        )
        .await
        .unwrap();
        let entries = parse_candor_log(io.get("/root/.mt/candor/olena.jsonl").as_deref());
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["statement"], "перше");
        assert_eq!(entries[1]["statement"], "друге");
    }

    #[tokio::test]
    async fn candor_show_without_read_marks_io_is_unread() {
        let io = MemoryIo::default();
        let mandates = mandates_fixture();
        ai_candor(
            &io,
            "/root",
            "olena",
            "fable-5",
            "x",
            &[],
            "low",
            &mandates,
            None,
        )
        .await
        .unwrap();
        let inbox = candor_show(&io, "/root", "olena", None).await;
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0]["read"], false);
        assert_eq!(inbox[0]["id"], json!(candor_id(&inbox[0])));
    }

    #[tokio::test]
    async fn mark_candor_read_is_private_per_device() {
        let io = MemoryIo::default();
        let mandates = mandates_fixture();
        ai_candor(
            &io,
            "/root",
            "olena",
            "fable-5",
            "x",
            &[],
            "low",
            &mandates,
            None,
        )
        .await
        .unwrap();
        let inbox = candor_show(&io, "/root", "olena", None).await;
        let id = inbox[0]["id"].as_str().unwrap().to_string();

        let read_marks_io = MemoryKnowledgeIo::new(None);
        mark_candor_read(&read_marks_io, &id).await;
        let after_mark = candor_show(&io, "/root", "olena", Some(&read_marks_io)).await;
        assert_eq!(after_mark[0]["read"], true);

        let other_device_marks = MemoryKnowledgeIo::new(None);
        let other_view = candor_show(&io, "/root", "olena", Some(&other_device_marks)).await;
        assert_eq!(other_view[0]["read"], false);
    }

    #[test]
    fn parse_candor_read_marks_missing_or_broken_is_empty() {
        assert_eq!(parse_candor_read_marks(None), HashSet::new());
        assert_eq!(parse_candor_read_marks(Some("not json")), HashSet::new());
    }

    #[tokio::test]
    async fn other_handle_log_does_not_see_my_records() {
        let io = MemoryIo::default();
        let mandates = mandates_fixture();
        ai_candor(
            &io,
            "/root",
            "olena",
            "fable-5",
            "x",
            &[],
            "low",
            &mandates,
            None,
        )
        .await
        .unwrap();
        let vitalii_inbox = candor_show(&io, "/root", "vitalii", None).await;
        assert!(vitalii_inbox.is_empty());
    }
}
