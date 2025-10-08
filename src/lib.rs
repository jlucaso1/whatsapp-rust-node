#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use serde_json::json;
use std::sync::Arc;
use tokio::runtime::Runtime;
use waproto::whatsapp as wa;
use whatsapp_rust::{
    Client,
    bot::Bot,
    store::{sqlite_store::SqliteStore, traits::Backend},
    types::events::Event,
};

#[napi(js_name = "WaBot")]
pub struct WaBot {
    bot: Arc<tokio::sync::Mutex<Option<Bot>>>,
    client: Option<Arc<Client>>,
    rt: Arc<Runtime>,
}

#[napi]
impl WaBot {
    #[napi(constructor)]
    pub fn new(db_path: String, callback: ThreadsafeFunction<String>) -> Result<Self> {
        let rt = Arc::new(
            tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?,
        );

        let callback_arc = Arc::new(callback);

        let bot = rt.block_on(async {
            let backend = Arc::new(
                SqliteStore::new(&db_path)
                    .await
                    .expect("Failed to create SqliteStore"),
            ) as Arc<dyn Backend>;

            let bot = Bot::builder()
                .with_backend(backend)
                .on_event(move |event, _client| {
                    let tsfn_arc = callback_arc.clone();
                    async move {
                        // Let's create the JSON payload first
                        let event_payload = match event {
                            Event::PairingQrCode { code, timeout } => json!({
                                "type": "PairingQrCode",
                                "data": { "code": code, "timeout": timeout.as_secs() }
                            }),
                            Event::Message(message, info) => {
                                use whatsapp_rust::proto_helpers::MessageExt;
                                json!({
                                    "type": "Message",
                                    "data": {
                                        "info": {
                                            "id": info.id,
                                            "source": {
                                                "chat": info.source.chat.to_string(),
                                                "sender": info.source.sender.to_string(),
                                                "isFromMe": info.source.is_from_me,
                                                "isGroup": info.source.is_group,
                                            },
                                            "pushName": info.push_name,
                                            "timestamp": info.timestamp.to_rfc3339(),
                                        },
                                        "textContent": message.text_content()
                                    }
                                })
                            }
                            Event::Connected(_) => json!({"type": "Connected"}),
                            // ... other events
                            _ => json!({ "type": "Other", "data": "An unhandled event occurred" }),
                        };

                        // Convert to string and explicitly handle failure
                        let json_str = serde_json::to_string(&event_payload).unwrap_or_else(|e| {
                            // If serialization fails, create a valid JSON error string
                            json!({
                                "type": "SerializationError",
                                "error": e.to_string()
                            })
                            .to_string()
                        });

                        // Call the threadsafe function
                        tsfn_arc.call(Ok(json_str), ThreadsafeFunctionCallMode::Blocking);
                    }
                })
                .build()
                .await
                .expect("Failed to build bot");

            let client = bot.client().clone();

            Result::Ok((bot, client))
        })?;

        let (bot, client) = bot;

        Ok(Self {
            bot: Arc::new(tokio::sync::Mutex::new(Some(bot))),
            client: Some(client),
            rt,
        })
    }

    // Make `start` async again so JS can `await` its completion.
    // Mark it `unsafe` as required by napi-rs.
    /// # Safety
    /// This function is unsafe because it spawns a task that runs the bot.
    #[napi]
    pub async unsafe fn start(&mut self) -> Result<()> {
        let bot_arc = self.bot.clone();

        let bot_handle = self.rt.spawn(async move {
            let mut bot_lock = bot_arc.lock().await;
            if let Some(mut bot) = bot_lock.take() {
                drop(bot_lock);

                if let Ok(handle) = bot.run().await {
                    if let Err(e) = handle.await {
                        eprintln!(
                            "[whatsapp-rust-node] Bot run handle exited with an error: {}",
                            e
                        );
                    }
                } else {
                    eprintln!("[whatsapp-rust-node] Bot failed to start.");
                }
            }
        });

        // Await the handle. This makes the `start()` method's promise resolve
        // when the bot actually stops.
        bot_handle
            .await
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(())
    }

    #[napi]
    pub async fn send_message(&self, to_jid: String, text: String) -> Result<String> {
        if let Some(client) = &self.client {
            let jid = to_jid
                .parse()
                .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid JID: {}", e)))?;

            let msg = wa::Message {
                conversation: Some(text),
                ..Default::default()
            };

            client
                .send_message(jid, msg)
                .await
                .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
        } else {
            Err(Error::new(
                Status::GenericFailure,
                "Client not available".to_string(),
            ))
        }
    }
}
