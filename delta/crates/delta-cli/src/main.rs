//! `delta` CLI — headless вхід у tool-поверхню Delta App (n-tool-surface),
//! Rust-заміна `bin/delta.mjs`: `delta <tool> '<json>'`, той самий envelope
//! (`{ok, output|error}`), той самий config.json/DELTA_CONFIG_PATH, ті самі
//! шляхи (device_key.json/knowledge.json/model_keys/{handle}.json —
//! файли-сусіди config.json, поза git; `device-registry.json` — У
//! `mandatesDir`, комітиться).
//!
//! Усі tools — і фаза A (мандати/decisions/квіз-гейт/кворум/mandate-change/
//! довіра), і фаза B (knowledge/drift/candor/delegation/watcher/staff/
//! report/review/kill-switch/directory/org) — реалізовані тут напряму над
//! `delta-core`; `bin/delta.mjs`/`bin/delta-watcher.mjs` видалено (фаза B
//! міграції завершена, див. `delta/README.md`).

mod config;

use std::collections::HashSet;

use clap::Parser;
use delta_core::decision_flow::Answer;
use delta_core::decisions::DecisionRequestMeta;
use delta_core::device_registry::SignerRole;
use delta_core::track_record::DecisionsDirScan;
use mt_mandates::MandatesFile;
use serde_json::{json, Value};

#[derive(Parser)]
#[command(name = "delta", about = "Delta App CLI")]
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
    "simulate_mandate_scope",
    "mandate_request_propose",
    "onboarding_status",
    "entry_quiz_start",
    "entry_quiz_submit",
    "profile_show",
    "profile_set_growth_edge",
    "quorum_quiz",
    "quorum_approve",
    "quorum_status",
    "directory_show",
    "directory_set",
    "watcher_scan",
    "notifications_show",
    "what_system_knows",
    "decision_brief",
    "ai_candor",
    "candor_show",
    "drift_scan",
    "delegation_quiz",
    "decision_delegate",
    "delta_report",
    "kill_switch_on",
    "kill_switch_off",
    "kill_switch_status",
    "review_agenda",
];
const HANDLE_DEFAULT_TOOLS: &[&str] = &[
    "mandates_show",
    "decisions_show",
    "trust_show",
    "notifications_show",
    "what_system_knows",
    "candor_show",
    "drift_scan",
    "kill_switch_on",
    "kill_switch_off",
    "kill_switch_status",
];

const ALL_TOOLS: &[&str] = &[
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
    "simulate_mandate_scope",
    "mandate_request_propose",
    "onboarding_status",
    "entry_quiz_start",
    "entry_quiz_submit",
    "profile_show",
    "profile_set_growth_edge",
    "quorum_quiz",
    "quorum_approve",
    "quorum_status",
    "knowledge_show",
    "directory_show",
    "directory_set",
    "watcher_scan",
    "notifications_show",
    "quiet_hours",
    "set_quiet_hours",
    "what_system_knows",
    "decision_brief",
    "ai_candor",
    "candor_show",
    "candor_mark_read",
    "drift_scan",
    "drift_show",
    "delegation_quiz",
    "decision_delegate",
    "delta_report",
    "kill_switch_on",
    "kill_switch_off",
    "kill_switch_status",
    "review_agenda",
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

/// Крок гейт-незалежного «на виріст» (п.2(г)): якщо `decision_quiz`
/// повернув `domain`, і той домен — заявлена зона росту computed_owner-а
/// розвилки, вставляє окреме поле `growthEdge` у відповідь ПІСЛЯ звичайного
/// квіз-гейта (`profiles::build_growth_edge_field` — ніколи не входить у
/// сам квіз-файл/questions[], фізично не може підняти вимоги до підпису).
/// Best-effort: будь-яка відсутність (профілю, decision-request-а) мовчки
/// не додає поля, не зриває сам quiz-виклик.
async fn attach_growth_edge(
    mandates_dir: &str,
    decisions_dir: &str,
    nnnn: &str,
    result: &mut Value,
) {
    let Some(domain) = result
        .as_object()
        .and_then(|o| o.get("domain"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
    else {
        return;
    };
    let dr_path = format!("{decisions_dir}/{nnnn}-decision-request.md");
    let Some(dr_text) = delta_core::io::Io::read_file(&config::FsIo, &dr_path).await else {
        return;
    };
    let Ok(dr) =
        delta_core::decisions::parse_decision_request(&dr_text, DecisionRequestMeta::default())
    else {
        return;
    };
    let Some(owner) = dr.computed_owner.clone() else {
        return;
    };
    let profile_path = delta_core::profiles::profile_path(mandates_dir, &owner);
    let profile_text = delta_core::io::Io::read_file(&config::FsIo, &profile_path).await;
    let growth_edge = delta_core::profiles::parse_growth_edge_profile(profile_text.as_deref());
    if let Some(field) = delta_core::profiles::build_growth_edge_field(&growth_edge, &domain, &dr) {
        if let Some(obj) = result.as_object_mut() {
            obj.insert("growthEdge".to_string(), field);
        }
    }
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
            let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
            let kill_switch_ctx = delta_core::kill_switch::build_kill_switch_redirect(
                &config::FsIo,
                &mandates_dir,
                &mandates_file.mandates,
            )
            .await;
            let queue = delta_core::decisions::derive_queue(
                &dirs,
                handle.as_deref(),
                Some(&kill_switch_ctx.redirect),
            );
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
            let mut result = delta_core::decision_flow::decision_quiz(
                &config::FsIo,
                &client,
                &llm_config,
                &decisions_dir,
                &nnnn,
                &chosen_option,
                Some(&config::FsKnowledgeIo),
                None,
            )
            .await?;
            attach_growth_edge(&mandates_dir, &decisions_dir, &nnnn, &mut result).await;
            Ok(result)
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
        // Симуляція на історії (конституція п.12, delta_core::simulation
        // module doc) — детермінований прогноз «за N днів у scope потрапило
        // б стільки-то рішень», викликається ДО підпису change-proposal-у
        // (onboarding-майстер, «Довіряю»). Матчить лише вісь decision_types
        // (свідома межа обсягу — refs немає в мок-схемі decision-request-а).
        "simulate_mandate_scope" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let decision_types: Vec<String> = input
                .get("decisionTypes")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let exclude_decision_types: Option<Vec<String>> =
                input.get("excludeDecisionTypes").and_then(|v| {
                    v.as_array().map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .collect()
                    })
                });
            let period_days = input
                .get("periodDays")
                .and_then(|v| v.as_i64())
                .unwrap_or(90);
            let raw = config::scan_decisions_dirs(&mandates_dir);
            let dirs: Vec<delta_core::decisions::DecisionsDir> = raw
                .into_iter()
                .map(|(dir, files)| delta_core::decisions::DecisionsDir { dir, files })
                .collect();
            let scope = mt_mandates::Scope {
                refs: vec!["refs/mt/**".into()],
                decision_types,
            };
            let exclude_scope = exclude_decision_types.map(|decision_types| mt_mandates::Scope {
                refs: vec!["refs/mt/**".into()],
                decision_types,
            });
            let result = delta_core::simulation::simulate_scope(
                &dirs,
                &scope,
                exclude_scope.as_ref(),
                period_days,
                chrono::Utc::now(),
            );
            Ok(delta_core::simulation::simulation_to_json(&result))
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
        // Онбординг = перший мандат (конституція п.10, delta_core::onboarding
        // module doc): "mandate_request_propose" покриває кроки (а)/(б) —
        // шаблон мінімального мандата + change-proposal тим самим
        // `ChangeKind::Added`-шляхом mt_mandates, що розширення ШІ-мандата.
        // Крок (в) — уже наявні tools decision_quiz/decision_approve
        // (делегатор) + mandate_change_apply (застосування) — жодного нового
        // tool-а не потрібно. Крок (г) — "entry_quiz_start"/"entry_quiz_submit".
        "mandate_request_propose" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            let delegator_handle = require_str(input, "delegatorHandle")?;
            let initiated_by =
                opt_str(input, "initiatedByHandle").unwrap_or_else(|| handle.clone());
            let kind = match opt_str(input, "kind").as_deref() {
                Some("model") => mt_mandates::MandateKind::Model,
                _ => mt_mandates::MandateKind::Person,
            };
            let refs: Vec<String> = input
                .get("refs")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let decision_types: Vec<String> = input
                .get("decisionTypes")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let old = read_mandates_file_or_empty(&mandates_dir)?;
            let scope = mt_mandates::Scope {
                refs,
                decision_types,
            };
            let new_file = delta_core::onboarding::build_onboarding_mandate_file(
                &old,
                &handle,
                &delegator_handle,
                kind,
                scope,
            )?;
            let change_id = opt_str(input, "changeId")
                .unwrap_or_else(|| delta_core::onboarding::onboarding_change_id(&handle));
            let reason = opt_str(input, "reason").unwrap_or_else(|| {
                format!(
                    "Онбординг: '{handle}' запросив(ла) перший мандат під делегатором '{delegator_handle}' (докладніше: docs/specs/260809-delta-app.md, конституція п.10)."
                )
            });
            let written = delta_core::change_proposal::write_change_proposal(
                &config::FsIo,
                &mandates_dir,
                &change_id,
                &old,
                &new_file,
                &handle,
                &delegator_handle,
                &initiated_by,
                &reason,
                None,
            )
            .await;
            Ok(json!({
                "changeId": change_id,
                "runId": delta_core::change_proposal::change_proposal_run_id(&change_id),
                "delegatorHandle": delegator_handle,
                "decisionRequestPath": written.decision_request_path,
                "changeJsonPath": written.change_json_path,
            }))
        }
        "onboarding_status" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
            let needs_onboarding =
                delta_core::onboarding::needs_onboarding(&mandates_file, &handle);
            let entry_quiz_complete =
                delta_core::onboarding::entry_quiz_completed(&config::FsIo, &mandates_dir, &handle)
                    .await;
            Ok(json!({
                "needsOnboarding": needs_onboarding,
                "entryQuizComplete": entry_quiz_complete,
                "onboardingComplete": !needs_onboarding && entry_quiz_complete,
            }))
        }
        "entry_quiz_start" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
            let mandate = mandates_file
                .mandates
                .iter()
                .find(|m| m.owner == handle)
                .ok_or_else(|| format!("entry_quiz_start: '{handle}' ще не має мандата в mandates.yaml — спершу mandate_request_propose → decision_quiz/decision_approve делегатора → mandate_change_apply"))?;
            Ok(delta_core::onboarding::entry_quiz_start(
                &config::FsIo,
                &mandates_dir,
                &handle,
                mandate,
                mandates_file.generation,
                None,
            )
            .await)
        }
        // Мок профілів компетенцій (п.2(г) конституції, `delta_core::profiles`
        // module doc) — .mt/profiles/{handle}.yaml, ЛИШЕ growth_edge (mandates.md:
        // «ЄДИНА секція, яку пише сама людина»).
        "profile_show" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            let path = delta_core::profiles::profile_path(&mandates_dir, &handle);
            let text = delta_core::io::Io::read_file(&config::FsIo, &path).await;
            let growth_edge = delta_core::profiles::parse_growth_edge_profile(text.as_deref());
            Ok(json!({"handle": handle, "growthEdge": growth_edge}))
        }
        "profile_set_growth_edge" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            let growth_edge: Vec<String> = input
                .get("growthEdge")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let path = delta_core::profiles::profile_path(&mandates_dir, &handle);
            delta_core::io::Io::write_file(
                &config::FsIo,
                &path,
                &delta_core::profiles::format_growth_edge_profile(&growth_edge),
            )
            .await;
            Ok(json!({"handle": handle, "growthEdge": growth_edge}))
        }
        "entry_quiz_submit" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            let answers: Vec<i64> = input
                .get("answers")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_i64()).collect())
                .ok_or("Missing required field: answers")?;
            delta_core::onboarding::entry_quiz_submit(
                &config::FsIo,
                &mandates_dir,
                &handle,
                &answers,
                None,
            )
            .await
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

        // --- Фаза B -----------------------------------------------------------
        "knowledge_show" => {
            use delta_core::io::KnowledgeIo;
            let text = config::FsKnowledgeIo.read().await;
            let entries = delta_core::knowledge::parse_knowledge_file(text.as_deref());
            let digest = delta_core::knowledge::domain_digest(&entries);
            let trend = delta_core::knowledge::time_to_understanding_trend(&entries);
            Ok(json!({"digest": digest, "trend": trend, "entryCount": entries.len()}))
        }
        "directory_show" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let text = delta_core::io::Io::read_file(
                &config::FsIo,
                &config::directory_path(&mandates_dir),
            )
            .await;
            let directory = delta_core::directory::parse_directory(text.as_deref());
            Ok(serde_json::to_value(&directory).unwrap())
        }
        "directory_set" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            let path = config::directory_path(&mandates_dir);
            let text = delta_core::io::Io::read_file(&config::FsIo, &path).await;
            let directory = delta_core::directory::parse_directory(text.as_deref());
            let patch = delta_core::directory::DirectoryPatch {
                name: opt_str(input, "name"),
                email: opt_str(input, "email"),
                lang: opt_str(input, "lang"),
            };
            let updated = delta_core::directory::set_directory_entry(&directory, &handle, patch);
            delta_core::io::Io::write_file(
                &config::FsIo,
                &path,
                &delta_core::directory::format_directory(&updated),
            )
            .await;
            Ok(serde_json::to_value(&updated[&handle]).unwrap())
        }
        "watcher_scan" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
            let kill_switch_ctx = delta_core::kill_switch::build_kill_switch_redirect(
                &config::FsIo,
                &mandates_dir,
                &mandates_file.mandates,
            )
            .await;
            let raw = config::scan_decisions_dirs(&mandates_dir);
            let dirs: Vec<delta_core::decisions::DecisionsDir> = raw
                .into_iter()
                .map(|(dir, files)| delta_core::decisions::DecisionsDir { dir, files })
                .collect();
            let watcher_config = input.get("config").and_then(|v| {
                Some(delta_core::watcher::WatcherConfig {
                    sla_hours: v.get("slaHours")?.as_f64()?,
                    grace_hours: v.get("graceHours")?.as_f64()?,
                })
            });
            let suppressed: HashSet<String> = kill_switch_ctx.redirect.keys().cloned().collect();
            Ok(delta_core::watcher::run_watcher_scan(
                &config::FsIo,
                &mandates_dir,
                &dirs,
                watcher_config,
                config::read_quiet_hours().as_ref(),
                Some(&suppressed),
                chrono::Utc::now(),
                chrono::Local::now(),
            )
            .await)
        }
        "notifications_show" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            let path = delta_core::watcher::notifications_log_path(&mandates_dir, &handle);
            let text = delta_core::io::Io::read_file(&config::FsIo, &path).await;
            Ok(Value::Array(delta_core::watcher::parse_notifications_log(
                text.as_deref(),
            )))
        }
        "quiet_hours" => Ok(match config::read_quiet_hours() {
            Some(qh) => json!({"start": qh.start, "end": qh.end}),
            None => Value::Null,
        }),
        "set_quiet_hours" => {
            let start = require_str(input, "start")?;
            let end = require_str(input, "end")?;
            config::write_config_patch(
                json!({"quiet_hours_start": start.trim(), "quiet_hours_end": end.trim()}),
            )
            .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "what_system_knows" => {
            use delta_core::io::KnowledgeIo;
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = opt_str(input, "handle");
            let text = config::FsKnowledgeIo.read().await;
            let knowledge_entries = delta_core::knowledge::parse_knowledge_file(text.as_deref());
            let notifications = match &handle {
                Some(h) => {
                    let path = delta_core::watcher::notifications_log_path(&mandates_dir, h);
                    let text = delta_core::io::Io::read_file(&config::FsIo, &path).await;
                    delta_core::watcher::parse_notifications_log(text.as_deref())
                }
                None => Vec::new(),
            };
            let device_registry = config::read_device_registry(&mandates_dir);
            Ok(delta_core::what_system_knows::build_what_system_knows(
                handle.as_deref(),
                &knowledge_entries,
                &notifications,
                &device_registry,
            ))
        }
        "decision_brief" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let run_id = require_str(input, "runId")?;
            let nnnn = require_str(input, "nnnn")?;
            let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
            let path = format!("{decisions_dir}/{nnnn}-decision-request.md");
            let text = delta_core::io::Io::read_file(&config::FsIo, &path)
                .await
                .ok_or_else(|| format!("decision_brief: decision-request не знайдено: {nnnn}"))?;
            let dr = delta_core::decisions::parse_decision_request(
                &text,
                DecisionRequestMeta {
                    nnnn: Some(nnnn.clone()),
                    ..Default::default()
                },
            )
            .map_err(|e| e.to_string())?;
            let staff_llm_config = delta_core::staff::StaffLlmConfig {
                base_url: llm_config.base_url.clone(),
                model: llm_config.model.clone(),
            };
            let (brief, compressed) =
                delta_core::staff::decision_brief(&client, &staff_llm_config, &dr).await;
            let mut value = serde_json::to_value(&brief).unwrap();
            value["compressed"] = json!(compressed);
            Ok(value)
        }
        "ai_candor" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let to_handle = require_str(input, "toHandle")?;
            let from_model_handle = require_str(input, "fromModelHandle")?;
            let statement = require_str(input, "statement")?;
            let audacity_level = require_str(input, "audacityLevel")?;
            let evidence_refs: Vec<String> = input
                .get("evidenceRefs")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
            delta_core::candor::ai_candor(
                &config::FsIo,
                &mandates_dir,
                &to_handle,
                &from_model_handle,
                &statement,
                &evidence_refs,
                &audacity_level,
                &mandates_file,
                None,
            )
            .await
        }
        "candor_show" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            let read_marks_io = config::SiblingFileIo(config::candor_read_marks_path());
            Ok(Value::Array(
                delta_core::candor::candor_show(
                    &config::FsIo,
                    &mandates_dir,
                    &handle,
                    Some(&read_marks_io),
                )
                .await,
            ))
        }
        "candor_mark_read" => {
            let id = require_str(input, "id")?;
            let read_marks_io = config::SiblingFileIo(config::candor_read_marks_path());
            delta_core::candor::mark_candor_read(&read_marks_io, &id).await;
            Ok(Value::Null)
        }
        "drift_scan" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = opt_str(input, "handle");
            let raw = config::scan_decisions_dirs(&mandates_dir);
            let dirs: Vec<delta_core::decisions::DecisionsDir> = raw
                .into_iter()
                .map(|(dir, files)| delta_core::decisions::DecisionsDir { dir, files })
                .collect();
            let drift_io = config::SiblingFileIo(config::drift_path());
            let cards = delta_core::drift::run_drift_scan(
                &dirs,
                handle.as_deref(),
                Some(&drift_io),
                None,
                chrono::Utc::now(),
            )
            .await;
            Ok(serde_json::to_value(&cards).unwrap())
        }
        "drift_show" => {
            let drift_io = config::SiblingFileIo(config::drift_path());
            let cards = delta_core::drift::load_drift_cards(Some(&drift_io)).await;
            Ok(serde_json::to_value(&cards).unwrap())
        }
        "delegation_quiz" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let run_id = require_str(input, "runId")?;
            let nnnn = require_str(input, "nnnn")?;
            let model_handle = require_str(input, "modelHandle")?;
            let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
            let path = format!("{decisions_dir}/{nnnn}-decision-request.md");
            let text = delta_core::io::Io::read_file(&config::FsIo, &path)
                .await
                .ok_or_else(|| format!("delegation_quiz: decision-request не знайдено: {nnnn}"))?;
            delta_core::delegation::delegation_quiz(
                &config::FsIo,
                &decisions_dir,
                &nnnn,
                &model_handle,
                &text,
                None,
            )
            .await
        }
        "decision_delegate" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let run_id = require_str(input, "runId")?;
            let nnnn = require_str(input, "nnnn")?;
            let model_handle = require_str(input, "modelHandle")?;
            let delegated_by_handle = require_str(input, "delegatedByHandle")?;
            let answer = parse_answer(input)
                .ok_or_else(|| "decision_delegate: Missing required field: answer".to_string())?;
            let decisions_dir = format!("{mandates_dir}/runs/{run_id}/decisions");
            let device_key = config::load_or_create_key_at(&config::device_key_path());
            delta_core::delegation::delegate_decision(
                &config::FsIo,
                &decisions_dir,
                &run_id,
                &nnnn,
                &model_handle,
                &delegated_by_handle,
                answer,
                &device_key,
                None,
            )
            .await
        }
        "delta_report" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let period_days = input
                .get("periodDays")
                .and_then(|v| v.as_i64())
                .unwrap_or(7);
            let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
            let raw = config::scan_decisions_dirs(&mandates_dir);
            let dirs: Vec<delta_core::decisions::DecisionsDir> = raw
                .into_iter()
                .map(|(dir, files)| delta_core::decisions::DecisionsDir { dir, files })
                .collect();
            let output = delta_core::report::delta_report(
                &config::FsIo,
                &mandates_dir,
                &mandates_file,
                &dirs,
                period_days,
                None,
            )
            .await?;
            Ok(serde_json::to_value(&output).unwrap())
        }
        "kill_switch_on" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            let device_key = config::load_or_create_key_at(&config::device_key_path());
            Ok(delta_core::kill_switch::kill_switch_on(
                &config::FsIo,
                &mandates_dir,
                &handle,
                &device_key,
                None,
            )
            .await)
        }
        "kill_switch_off" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            let device_key = config::load_or_create_key_at(&config::device_key_path());
            Ok(delta_core::kill_switch::kill_switch_off(
                &config::FsIo,
                &mandates_dir,
                &handle,
                &device_key,
                None,
            )
            .await)
        }
        "kill_switch_status" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let handle = require_str(input, "handle")?;
            Ok(
                delta_core::kill_switch::kill_switch_status(&config::FsIo, &mandates_dir, &handle)
                    .await,
            )
        }
        "review_agenda" => {
            let mandates_dir = require_str(input, "mandatesDir")?;
            let period_days = input
                .get("periodDays")
                .and_then(|v| v.as_i64())
                .unwrap_or(7);
            let mandates_file = read_mandates_file_or_empty(&mandates_dir)?;
            let kill_switch_ctx = delta_core::kill_switch::build_kill_switch_redirect(
                &config::FsIo,
                &mandates_dir,
                &mandates_file.mandates,
            )
            .await;
            let raw = config::scan_decisions_dirs(&mandates_dir);
            let dirs: Vec<delta_core::decisions::DecisionsDir> = raw
                .into_iter()
                .map(|(dir, files)| delta_core::decisions::DecisionsDir { dir, files })
                .collect();
            let device_registry = config::read_device_registry(&mandates_dir);
            let loader = CliModelDeviceKeyLoader;
            let registrar = CliDeviceRegistrar {
                mandates_dir: mandates_dir.clone(),
            };
            let output = delta_core::review::review_agenda(
                &config::FsIo,
                &mandates_dir,
                &mandates_file,
                &dirs,
                &device_registry,
                &kill_switch_ctx.active_handles,
                &loader,
                Some(&registrar),
                period_days,
                None,
                None,
            )
            .await?;
            Ok(serde_json::to_value(&output).unwrap())
        }

        _ => Err(format!("tool \"{tool}\" is unknown")),
    }
}

/// `ModelDeviceKeyLoader` — CLI-транспорт: локально утримуваний ключ моделі,
/// той самий каталог, що людський `device_key.json` (`bin/delta.mjs:
/// loadOrCreateModelDeviceKeyCli`).
struct CliModelDeviceKeyLoader;

#[async_trait::async_trait]
impl delta_core::review::ModelDeviceKeyLoader for CliModelDeviceKeyLoader {
    async fn load_model_device_key(&self, handle: &str) -> delta_core::signing::DeviceKeypair {
        config::load_or_create_key_at(&config::model_key_path(handle))
    }
}

/// `DeviceRegistrar` — CLI-транспорт: реєструє pubkey у
/// `device-registry.json` (`bin/delta.mjs: ensureRegisteredCli`).
struct CliDeviceRegistrar {
    mandates_dir: String,
}

#[async_trait::async_trait]
impl delta_core::review::DeviceRegistrar for CliDeviceRegistrar {
    async fn register_device(&self, handle: &str, role: SignerRole, pubkey_base64: &str) {
        config::ensure_registered(&self.mandates_dir, handle, role, pubkey_base64);
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
            serde_json::to_string_pretty(&json!(ALL_TOOLS)).unwrap()
        );
        std::process::exit(0);
    };
    if tool == "list" {
        println!(
            "{}",
            serde_json::to_string_pretty(&json!(ALL_TOOLS)).unwrap()
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
