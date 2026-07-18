//! Fake/mock OpenAI-сумісний провайдер (n-tauri: core_test_isolation) —
//! доводить, що `owner_llm::one_shot` реально виконує HTTP-раунд-тріп проти
//! конфігурованого `omlx_base_url`, а не мовчки пропускає LLM-логіку чи б'є
//! по реальному провайдеру. Без мережі назовні: сервер — локальний
//! ephemeral-порт (127.0.0.1:0), одна фіксована відповідь.

use std::io::{Read, Write};
use std::net::TcpListener;

/// Піднімає fake-сервер на один запит-відповідь і повертає його base URL.
fn spawn_fake_omlx(body: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake omlx server");
    let addr = listener.local_addr().expect("local_addr");
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf); // тіло запиту не цікавить double — one-shot
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    format!("http://{addr}/v1")
}

#[tokio::test]
async fn one_shot_round_trips_through_fake_openai_compatible_server() {
    let body = r#"{"choices":[{"message":{"role":"assistant","content":"fake-response"}}]}"#;
    let base_url = spawn_fake_omlx(body);

    let reply = owner_llm::one_shot("min", Some("sys"), "hi", base_url, "fake-model".to_string(), None)
        .await
        .expect("fake omlx round-trip failed");

    assert_eq!(reply, "fake-response");
}

#[tokio::test]
async fn one_shot_surfaces_provider_error_as_err_not_panic() {
    // Порт без слухача — з'єднання провалиться швидко (fail-fast, як і решта крейта).
    let reply = owner_llm::one_shot(
        "min",
        None,
        "hi",
        "http://127.0.0.1:1".to_string(),
        "fake-model".to_string(),
        None
    )
    .await;

    assert!(reply.is_err());
}
