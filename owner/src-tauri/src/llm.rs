//! Тонкі tauri::command-обгортки над `owner-llm` (агентна логіка, окремий
//! workspace crate без залежності на tauri — n-tauri: core_test_isolation).
//! Жодної драбини тут: дві незалежні точки входу крейта llm-cascade, драбину
//! ACP → local/cloud компонує JS (owner/src/composables/use-llm-cascade.js),
//! бо саме там уже живе рішення «чи дозволена ACP-підписка на цьому вузлі»
//! (autonomy.yml, клас `external_comms`).

#[tauri::command]
pub async fn llm_one_shot(
    tier: String,
    system: Option<String>,
    user: String,
    omlx_base_url: String,
    omlx_model: String,
    omlx_api_key: Option<String>,
) -> Result<String, String> {
    owner_llm::one_shot(
        &tier,
        system.as_deref(),
        &user,
        omlx_base_url,
        omlx_model,
        omlx_api_key,
    )
    .await
}

#[tauri::command]
pub async fn llm_one_shot_acp(
    agent: String,
    prompt: String,
    cwd: String,
) -> Result<String, String> {
    owner_llm::one_shot_acp(&agent, &prompt, std::path::Path::new(&cwd)).await
}
