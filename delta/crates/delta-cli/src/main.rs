//! `delta` CLI (фаза A) — headless вхід у tool-поверхню Delta App
//! (n-tool-surface), Rust-заміна фази A `bin/delta.mjs`: `delta <tool>
//! '<json>'`, той самий envelope (`{ok, output|error}`), той самий
//! config.json/DELTA_CONFIG_PATH, ті самі шляхи (device_key.json/
//! knowledge.json/model_keys/{handle}.json — файли-сусіди config.json,
//! поза git; `device-registry.json` — У `mandatesDir`, комітиться).
//!
//! **Гібридний CLI (перехідний стан фази A):** цей бінарник реалізує ЛИШЕ
//! tools фази A (мандати/decisions/квіз-гейт/кворум/mandate-change/довіра).
//! `bin/delta.mjs` лишається для tools фази B (knowledge/drift/candor/
//! delegation/watcher/staff/report/review/kill-switch/directory/org) —
//! див. `delta/README.md`, «Фаза A Rust-порту».

mod config;

use clap::Parser;
use delta_core::decision_flow::Answer;
use delta_core::device_registry::SignerRole;
use delta_core::track_record::DecisionsDirScan;
use mt_mandates::MandatesFile;
use serde_json::{json, Value};

#[derive(Parser)]
#[command(name = "delta", about = "Delta App CLI (фаза A)")]
struct Cli {
    /// Ім'я тула (напр. mandates_show) — відсутнє/`list` друкує підказку.
    tool: Option<String>,
    /// JSON-payload вхідних параметрів тула.
    payload: Option<String>,
}

const MANDATES_DIR_DEFAULT_TOOLS: &[&str] = &[
    "mandates_show",
    "decisions_show",
    "decision_quiz",
    "decision_approve",
    "trust_show",
    "mandate_narrow",
    "mandate_widen_propose",
    "ai_petition",
    "mandate_change_apply",
    "quorum_quiz",
    "quorum_approve",
    "quorum_status",
];
const HANDLE_DEFAULT_TOOLS: &[&str] = &["mandates_show", "decisions_show", "trust_show"];

const PHASE_A_TOOLS: &[&str] = &[
    "whoami",
    "set_identity",
    "mandates_dir",
    "set_mandates_dir",
    "mandates_show",
    "decisions_show",
    "decision_quiz",
    "decision_approve",
    "device_pubkey",
    "llm_config",
    "set_llm_config",
    "trust_show",
    "mandate_narrow",
    "mandate_widen_propose",
    "ai_petition",
    "mandate_change_apply",
    "quorum_quiz",
    "quorum_approve",
    "quorum_status",
];

fn require_str(input: &Value, key: &str) -> Result<String, String> {
    input
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("Missing required field: {key}"))
}

fn opt_str(input: &Value, key: &str) -> Option<String> {
    input.get(key).and_then(|v| v.as_str()).map(str::to_string)
}

fn parse_answer(input: &Value) -> Option<Answer<'_>> {
    let v = input.get("answer")?;
    if let Some(n) = v.as_i64() {
        Some(Answer::Index(n))
    } else {
        v.as_str().map(Answer::Text)
    }
}

fn build_dir_scans(raw: &[(String, Vec<(String, String)>)]) -> Vec<DecisionsDirScan<'_>> {
    raw.iter()
        .map(|(dir, files)| DecisionsDirScan { dir, files })
        .collect()
}

/// Читає `.mt/mandates.yaml` — файл відсутній — доброзичливий empty state
/// (`{generation: 1, mandates: []}`, той самий M0-інваріант, що
/// `mandates_show`/`trust_show` мали в JS-мока); файл ІСНУЄ, але
/// структурно невалідний — пропагує помилку (реальна валідація
/// `mt_mandates`, задокументована зміна семантики фази A).
fn read_mandates_file_or_empty(mandates_dir: &str) -> Result<MandatesFile, String> {
    let path = config::mandates_yaml_path(mandates_dir);
    if !std::path::Path::new(&path).exists() {
        return Ok(MandatesFile {
            generation: 1,
            mandates: Vec::new(),
        });
    }
    config::read_mandates_file(mandates_dir)
}

async fn dispatch(tool: &str, input: &Value) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let llm_config = config::read_llm_config();

    match tool {
        "whoami" => Ok(config::read_config()
            .get("identity")
            .cloned()
            .unwrap_or(Value::Null)),
        "set_identity" => {
            let handle = require_str(input, "handle")?;
            config::write_config_patch(json!({"identity": handle.trim()}))
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "mandates_dir" => Ok(config::read_config()
            .get("mandates_dir")
            .cloned()
            .unwrap_or(Value::Null)),
        "set_mandates_dir" => {
            let dir = require_str(input, "dir")?;
            config::write_config_patch(json!({"mandates_dir": dir.trim()}))
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "mandates_show" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = opt_str(input, "handle");
            let file = read_mandates_file_or_empty(&mandates_dir)?;
            let view =
                delta_core::mandates::derive_mandates_view(&file.mandates, handle.as_deref());
            Ok(delta_core::mandates::mandates_view_to_json(&view))
        }
        "decisions_show" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = opt_str(input, "handle");
            let raw = config::scan_decisions_dirs(&mandates_dir);
            let dirs: Vec<delta_core::decisions::DecisionsDir> = raw
                .into_iter()
                .map(|(dir, files)| delta_core::decisions::DecisionsDir { dir, files })
                .collect();
            // Kill-switch-перенаправлення (M6) лишається JS/фаза B — цей
            // шлях завжди None (задокументоване обмеження фази A).
            let queue = delta_core::decisions::derive_queue(&dirs, handle.as_deref(), None);
            Ok(Value::Array(
                queue
                    .iter()
                    .map(delta_core::decisions::queue_item_to_json)
                    .collect(),
            ))
        }
        "decision_quiz" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let run_id = require_str(input, "runId")?;
            let nnnn = require_str(input, "nnnn")?;
            let chosen_option = require_str(input, "chosenOption")?;
            let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
            delta_core::decision_flow::decision_quiz(
                &config::FsIo,
                &client,
                &llm_config,
                &decisions_dir,
                &nnnn,
                &chosen_option,
                Some(&config::FsKnowledgeIo),
                None,
            )
            .await
        }
        "decision_approve" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let run_id = require_str(input, "runId")?;
            let nnnn = require_str(input, "nnnn")?;
            let chosen_option = require_str(input, "chosenOption")?;
            let answer = parse_answer(input);
            let transcript = opt_str(input, "transcript");
            let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
            let device_key = config::load_or_create_key_at(&config::device_key_path());
            delta_core::decision_flow::decision_approve(
                &config::FsIo,
                &client,
                &llm_config,
                &decisions_dir,
                &run_id,
                &nnnn,
                &chosen_option,
                answer,
                transcript.as_deref(),
                &device_key,
                Some(&config::FsKnowledgeIo),
                None,
            )
            .await
        }
        "device_pubkey" => {
            let device_key = config::load_or_create_key_at(&config::device_key_path());
            Ok(json!({"publicKeyBase64": device_key.public_key_base64}))
        }
        "llm_config" => Ok(json!({"baseUrl": llm_config.base_url, "model": llm_config.model})),
        "set_llm_config" => {
            let mut patch = serde_json::Map::new();
            if let Some(base_url) = opt_str(input, "baseUrl") {
                patch.insert("llm_base_url".to_string(), json!(base_url.trim()));
            }
            if let Some(model) = opt_str(input, "model") {
                patch.insert("llm_model".to_string(), json!(model.trim()));
            }
            config::write_config_patch(Value::Object(patch)).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "trust_show" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = opt_str(input, "handle");
            let file = read_mandates_file_or_empty(&mandates_dir)?;
            let registry = config::read_device_registry(&mandates_dir);
            let raw = config::scan_decisions_dirs(&mandates_dir);
            let dirs = build_dir_scans(&raw);
            Ok(delta_core::trust::derive_trust_view(
                &file,
                &registry,
                &dirs,
                handle.as_deref(),
            ))
        }
        "mandate_narrow" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let owner_handle = require_str(input, "ownerHandle")?;
            let old = read_mandates_file_or_empty(&mandates_dir)?;
            let mandate = old
                .mandates
                .iter()
                .find(|m| m.owner == owner_handle)
                .ok_or_else(|| {
                    format!("mandate_narrow: owner '{owner_handle}' не знайдено в mandates.yaml")
                })?;
            let role = if mandate.kind == mt_mandates::MandateKind::Model {
                SignerRole::Model
            } else {
                SignerRole::Human
            };
            let new_file = delta_core::trust::with_mandate_replaced(
                &old,
                &owner_handle,
                delta_core::trust::narrow_mandate_one_step,
            );
            let device_key = if role == SignerRole::Model {
                config::load_or_create_key_at(&config::model_key_path(&owner_handle))
            } else {
                config::load_or_create_key_at(&config::device_key_path())
            };
            config::ensure_registered(
                &mandates_dir,
                &owner_handle,
                role,
                &device_key.public_key_base64,
            );
            Ok(delta_core::change_proposal::apply_mandate_narrow(
                &config::FsIo,
                &config::mandates_yaml_path(&mandates_dir),
                &old,
                &new_file,
                &owner_handle,
                role,
                &device_key,
            )
            .await)
        }
        "mandate_widen_propose" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let owner_handle = require_str(input, "ownerHandle")?;
            let initiated_by = require_str(input, "initiatedByHandle")?;
            let old = read_mandates_file_or_empty(&mandates_dir)?;
            let mandate = old
                .mandates
                .iter()
                .find(|m| m.owner == owner_handle)
                .ok_or_else(|| {
                    format!(
                        "mandate_widen_propose: owner '{owner_handle}' не знайдено в mandates.yaml"
                    )
                })?;
            let delegator = mandate.escalates_to.clone().ok_or_else(|| format!("mandate_widen_propose: '{owner_handle}' — кореневий мандат, немає делегатора для підпису"))?;
            let new_file = delta_core::trust::with_mandate_replaced(
                &old,
                &owner_handle,
                delta_core::trust::widen_mandate_one_step,
            );
            let change_id = opt_str(input, "changeId")
                .unwrap_or_else(|| format!("mc-{}", chrono::Utc::now().timestamp_millis()));
            let reason = format!("{initiated_by} пропонує розширити мандат '{owner_handle}' на один щабель (audacity/budget_eur).");
            let written = delta_core::change_proposal::write_change_proposal(
                &config::FsIo,
                &mandates_dir,
                &change_id,
                &old,
                &new_file,
                &owner_handle,
                &delegator,
                &initiated_by,
                &reason,
                None,
            )
            .await;
            Ok(
                json!({"changeId": change_id, "delegatorHandle": delegator, "decisionRequestPath": written.decision_request_path, "changeJsonPath": written.change_json_path}),
            )
        }
        "ai_petition" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let model_handle = require_str(input, "modelHandle")?;
            let old = read_mandates_file_or_empty(&mandates_dir)?;
            let mandate = old
                .mandates
                .iter()
                .find(|m| m.owner == model_handle)
                .ok_or_else(|| {
                    format!("ai_petition: model '{model_handle}' не знайдено в mandates.yaml")
                })?;
            if mandate.kind != mt_mandates::MandateKind::Model {
                return Err(format!(
                    "ai_petition: owner '{model_handle}' не kind: model"
                ));
            }
            let delegator = mandate.escalates_to.clone().ok_or_else(|| format!("ai_petition: '{model_handle}' — кореневий мандат, немає делегатора для петиції"))?;
            let new_file = delta_core::trust::with_mandate_replaced(
                &old,
                &model_handle,
                delta_core::trust::widen_mandate_one_step,
            );
            let change_id = opt_str(input, "changeId")
                .unwrap_or_else(|| format!("mc-{}", chrono::Utc::now().timestamp_millis()));
            let raw = config::scan_decisions_dirs(&mandates_dir);
            let dirs = build_dir_scans(&raw);
            let registry = config::read_device_registry(&mandates_dir);
            let track = delta_core::track_record::derive_track_record(
                &dirs,
                &registry,
                &model_handle,
                None,
            );
            let model_key = config::load_or_create_key_at(&config::model_key_path(&model_handle));
            config::ensure_registered(
                &mandates_dir,
                &model_handle,
                SignerRole::Model,
                &model_key.public_key_base64,
            );
            let result = delta_core::ai_petition::ai_petition(
                &config::FsIo,
                &mandates_dir,
                &change_id,
                &old,
                &new_file,
                &model_handle,
                &delegator,
                &track,
                &model_key,
                None,
            )
            .await
            .ok_or("ai_petition: ключ пристрою моделі несумісний з ed25519-dalek")?;
            Ok(json!({
                "changeId": change_id, "delegatorHandle": delegator,
                "petitionPath": result.petition_path,
                "decisionRequestPath": result.written.decision_request_path,
                "changeJsonPath": result.written.change_json_path,
                "evidenceText": result.evidence_text,
                "petition": result.petition,
            }))
        }
        "mandate_change_apply" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let change_id = require_str(input, "changeId")?;
            let handle = require_str(input, "handle")?;
            let role_str = opt_str(input, "role").unwrap_or_else(|| "human".to_string());
            let role = if role_str == "model" {
                SignerRole::Model
            } else {
                SignerRole::Human
            };
            let (old, new_file) = delta_core::change_proposal::read_change_proposal(
                &config::FsIo,
                &mandates_dir,
                &change_id,
            )
            .await
            .ok_or_else(|| {
                format!("mandate_change_apply: change-proposal '{change_id}' не знайдено")
            })?;
            let decisions_dir = delta_core::change_proposal::change_proposal_decisions_dir(
                &mandates_dir,
                &change_id,
            );
            let approval_path = format!("{decisions_dir}/0001-approval.json");
            let approval_text = delta_core::io::Io::read_file(&config::FsIo, &approval_path).await.ok_or_else(|| {
                format!(
                    "mandate_change_apply: decision-request change-proposal '{change_id}' ще не підписано (немає 0001-approval.json) — спершу пройди decision_quiz/decision_approve з runId '{}'",
                    delta_core::change_proposal::change_proposal_run_id(&change_id)
                )
            })?;
            let approval: Value =
                serde_json::from_str(&approval_text).map_err(|e| e.to_string())?;
            let device_key = if role == SignerRole::Model {
                config::load_or_create_key_at(&config::model_key_path(&handle))
            } else {
                config::load_or_create_key_at(&config::device_key_path())
            };
            config::ensure_registered(&mandates_dir, &handle, role, &device_key.public_key_base64);
            let applied_marker = format!("{decisions_dir}/0001-applied.json");
            Ok(delta_core::change_proposal::apply_mandate_change_proposal(
                &config::FsIo,
                &config::mandates_yaml_path(&mandates_dir),
                &old,
                &new_file,
                &approval,
                &handle,
                role,
                &device_key,
                vec![],
                Some(&applied_marker),
                None,
            )
            .await)
        }
        "quorum_quiz" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let run_id = require_str(input, "runId")?;
            let nnnn = require_str(input, "nnnn")?;
            let signer_handle = require_str(input, "signerHandle")?;
            let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
            delta_core::quorum::quorum_quiz(
                &config::FsIo,
                &decisions_dir,
                &nnnn,
                &signer_handle,
                None,
            )
            .await
        }
        "quorum_approve" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let run_id = require_str(input, "runId")?;
            let nnnn = require_str(input, "nnnn")?;
            let signer_handle = require_str(input, "signerHandle")?;
            let chosen_option = require_str(input, "chosenOption")?;
            let transcript = require_str(input, "transcript")?;
            let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
            let device_key = config::load_or_create_key_at(&config::device_key_path());
            delta_core::quorum::quorum_approve(
                &config::FsIo,
                &client,
                &llm_config,
                &decisions_dir,
                &run_id,
                &nnnn,
                &signer_handle,
                &chosen_option,
                &transcript,
                &device_key,
                None,
            )
            .await
        }
        "quorum_status" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let run_id = require_str(input, "runId")?;
            let nnnn = require_str(input, "nnnn")?;
            let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
            delta_core::quorum::load_quorum_status(&config::FsIo, &decisions_dir, &nnnn).await
        }
        _ => Err(format!(
            "tool \"{tool}\" has no CLI transport (фаза B — див. bin/delta.mjs)"
        )),
    }
}

fn apply_defaults(tool: &str, input: &mut Value) {
    if !input.is_object() {
        *input = json!({});
    }
    let obj = input
        .as_object_mut()
        .expect("щойно гарантовано об'єктом вище");
    if MANDATES_DIR_DEFAULT_TOOLS.contains(&tool) && !obj.contains_key("mandatesDir") {
        obj.insert(
            "mandatesDir".to_string(),
            config::read_config()
                .get("mandates_dir")
                .cloned()
                .unwrap_or(Value::Null),
        );
    }
    if HANDLE_DEFAULT_TOOLS.contains(&tool) && !obj.contains_key("handle") {
        obj.insert(
            "handle".to_string(),
            config::read_config()
                .get("identity")
                .cloned()
                .unwrap_or(Value::Null),
        );
    }
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    let Some(tool) = cli.tool else {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!(PHASE_A_TOOLS)).unwrap()
        );
        std::process::exit(0);
    };
    if tool == "list" {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!(PHASE_A_TOOLS)).unwrap()
        );
        std::process::exit(0);
    }

    let mut input: Value = match &cli.payload {
        Some(p) => match serde_json::from_str(p) {
            Ok(v) => v,
            Err(_) => {
                eprintln!("Invalid JSON input: {p}");
                std::process::exit(2);
            }
        },
        None => json!({}),
    };
    apply_defaults(&tool, &mut input);

    let envelope = match dispatch(&tool, &input).await {
        Ok(output) => json!({"ok": true, "output": output}),
        Err(message) => json!({"ok": false, "error": {"code": "io", "message": message}}),
    };
    println!("{}", serde_json::to_string_pretty(&envelope).unwrap());
    std::process::exit(if envelope["ok"] == json!(true) { 0 } else { 2 });
}
