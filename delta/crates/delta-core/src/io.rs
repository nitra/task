//! Транспорт-незалежні fs-абстракції — `decision_flow`/`quorum`/
//! `change_proposal` приймають `&dyn Io`/`&dyn KnowledgeIo` замість
//! конкретного fs-виклику, той самий інваріант, що JS-оригінали
//! (`decision-flow.js`/`quorum.js`: параметр `io` з контрактом
//! `{readFile, writeFile}`) — CLI (`tokio::fs`) і Tauri (invoke-based) дають
//! власну реалізацію, уся логіка гейт-ядра лишається спільною.

use std::collections::HashMap;
use std::sync::Mutex;

/// `readFile`/`writeFile` над абсолютними шляхами всередині `decisions/`
/// (і споріднених — `.mt/mandates.yaml`, `device-registry.json`).
/// `read_file` повертає `None`, коли файл відсутній (не Err) — той самий
/// контракт, що JS `io.readFile`.
#[async_trait::async_trait]
pub trait Io: Send + Sync {
    async fn read_file(&self, path: &str) -> Option<String>;
    async fn write_file(&self, path: &str, content: &str);
}

/// `{read, write}` бази знань/дрейф-карток — окремий контракт від [`Io`]
/// (немає шляху — рівно один файл на застосунок, `knowledge.js`-стиль).
#[async_trait::async_trait]
pub trait KnowledgeIo: Send + Sync {
    async fn read(&self) -> Option<String>;
    async fn write(&self, content: &str);
}

/// In-memory `Io`-двійник для тестів — той самий дух, що JS `memoryIo`
/// (`decision-flow.test.js`).
#[derive(Default)]
pub struct MemoryIo {
    pub store: Mutex<HashMap<String, String>>,
}

impl MemoryIo {
    pub fn new(seed: impl IntoIterator<Item = (String, String)>) -> Self {
        MemoryIo {
            store: Mutex::new(seed.into_iter().collect()),
        }
    }

    pub fn get(&self, path: &str) -> Option<String> {
        self.store.lock().unwrap().get(path).cloned()
    }

    pub fn has(&self, path: &str) -> bool {
        self.store.lock().unwrap().contains_key(path)
    }
}

#[async_trait::async_trait]
impl Io for MemoryIo {
    async fn read_file(&self, path: &str) -> Option<String> {
        self.store.lock().unwrap().get(path).cloned()
    }

    async fn write_file(&self, path: &str, content: &str) {
        self.store
            .lock()
            .unwrap()
            .insert(path.to_string(), content.to_string());
    }
}

/// In-memory `KnowledgeIo`-двійник для тестів — той самий дух, що JS
/// `memoryKnowledgeIo`.
#[derive(Default)]
pub struct MemoryKnowledgeIo {
    pub text: Mutex<Option<String>>,
}

impl MemoryKnowledgeIo {
    pub fn new(text: Option<String>) -> Self {
        MemoryKnowledgeIo {
            text: Mutex::new(text),
        }
    }
}

#[async_trait::async_trait]
impl KnowledgeIo for MemoryKnowledgeIo {
    async fn read(&self) -> Option<String> {
        self.text.lock().unwrap().clone()
    }

    async fn write(&self, content: &str) {
        *self.text.lock().unwrap() = Some(content.to_string());
    }
}
