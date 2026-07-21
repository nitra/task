//! Живий смок-тест (не автотест — реальна квота, як приклади llm-cascade
//! README): б'є в реальний локальний omlx-сервер точно тим самим шляхом, що
//! й `use-staff.js` → `llm_one_shot` → `owner_llm::one_shot` — доводить, що
//! новий Tauri-command реально відповідає через каскад, а не лише компілюється.
//!
//! ```bash
//! cargo run --example staff_brief_live -p owner-llm
//! ```
//! Читає `OMLX_BASE_URL`/`OMLX_MODEL`/`OMLX_API_KEY` з env (значення за
//! замовчуванням — типовий локальний omlx: `http://127.0.0.1:8000/v1`,
//! `gemma-4-e4b-it-OptiQ-4bit`, той самий дефолт, що й owner-онбординг).

#[tokio::main]
async fn main() {
    let base_url =
        std::env::var("OMLX_BASE_URL").unwrap_or_else(|_| "http://127.0.0.1:8000/v1".to_string());
    let model =
        std::env::var("OMLX_MODEL").unwrap_or_else(|_| "gemma-4-e4b-it-OptiQ-4bit".to_string());
    let api_key = std::env::var("OMLX_API_KEY").ok();

    let system = "Ти — штаб власника. Дай короткий бриф рішення одним реченням.";
    let user = "Вузол: goal [plan_review]\nПричина в черзі: план декомпозиції чекає approve.\nКонтракт: Зробити лендинг";

    println!("→ owner_llm::one_shot(Max) до {base_url} ({model})");
    match owner_llm::one_shot("max", Some(system), user, base_url, model, api_key).await {
        Ok(reply) => println!("✓ відповідь ({} символів):\n{reply}", reply.len()),
        Err(err) => {
            eprintln!("✗ провал: {err}");
            std::process::exit(1);
        }
    }
}
