#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::runtime::Runtime;
use tokio::sync::mpsc;

// Import the new transport traits
use async_trait::async_trait;
use bytes::Bytes;
use waproto::whatsapp as wa;
use whatsapp_rust::http::{HttpClient, HttpRequest, HttpResponse};
use whatsapp_rust::transport::{Transport, TransportEvent, TransportFactory};
use whatsapp_rust::{bot::Bot, client::Client, types::events::Event};

// --- N-API HTTP Client Implementation ---

// This struct will be the JavaScript promise that Rust awaits.
#[napi(object)]
pub struct JsHttpResponse {
    pub status_code: u16,
    pub body: Buffer,
}

// The request object that Rust will send to JavaScript.
#[napi(object)]
pub struct JsHttpRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<Buffer>,
}

#[derive(Clone)]
struct NapiHttpClient {
    // A thread-safe function to execute an HTTP request in JavaScript.
    // It takes a JsHttpRequest and expects a Promise<JsHttpResponse> back.
    execute_request_in_js: Arc<ThreadsafeFunction<JsHttpRequest, Promise<JsHttpResponse>>>,
}

#[async_trait]
impl HttpClient for NapiHttpClient {
    async fn execute(&self, request: HttpRequest) -> anyhow::Result<HttpResponse> {
        // 1. Convert Rust HttpRequest to a JsHttpRequest that can be passed to N-API
        let js_request = JsHttpRequest {
            url: request.url,
            method: request.method,
            headers: request.headers,
            body: request.body.map(Buffer::from),
        };

        // 2. Call the JavaScript function and await the resulting Promise
        let promise: Promise<JsHttpResponse> = self
            .execute_request_in_js
            .call_async(Ok(js_request))
            .await
            .map_err(|e| anyhow::anyhow!("N-API call to JS for HTTP request failed: {}", e))?;

        let js_response: JsHttpResponse = promise
            .await
            .map_err(|e| anyhow::anyhow!("JavaScript HTTP request promise rejected: {}", e))?;

        // 3. Convert the JsHttpResponse back to a Rust HttpResponse
        Ok(HttpResponse {
            status_code: js_response.status_code,
            body: js_response.body.into(),
        })
    }
}

#[derive(Clone)]
struct NapiTransport {
    send_frame_to_js: Arc<ThreadsafeFunction<Buffer>>,
}

#[async_trait]
impl Transport for NapiTransport {
    async fn send(&self, frame: &[u8]) -> anyhow::Result<()> {
        let buffer = Buffer::from(frame);
        self.send_frame_to_js
            .call(Ok(buffer), ThreadsafeFunctionCallMode::Blocking);
        Ok(())
    }

    async fn disconnect(&self) {
        // Disconnect handled by JS
    }
}

#[derive(Clone)]
struct NapiTransportFactory {
    send_frame_to_js: Arc<ThreadsafeFunction<Buffer>>,
    event_rx: Arc<tokio::sync::Mutex<Option<mpsc::Receiver<TransportEvent>>>>,
}

#[async_trait]
impl TransportFactory for NapiTransportFactory {
    async fn create_transport(
        &self,
    ) -> anyhow::Result<(Arc<dyn Transport>, mpsc::Receiver<TransportEvent>)> {
        let transport = Arc::new(NapiTransport {
            send_frame_to_js: self.send_frame_to_js.clone(),
        });

        let mut rx_guard = self.event_rx.lock().await;
        let rx = rx_guard
            .take()
            .ok_or_else(|| anyhow::anyhow!("Transport already created"))?;

        Ok((transport, rx))
    }
}

#[napi(js_name = "WaBot")]
pub struct WaBot {
    bot: Arc<tokio::sync::Mutex<Option<Bot>>>,
    client: Arc<tokio::sync::Mutex<Option<Arc<Client>>>>,
    rt: Arc<Runtime>,
    transport_event_sender: mpsc::Sender<TransportEvent>,
}

#[napi]
impl WaBot {
    #[napi(constructor)]
    pub fn new(
        _db_path: String,
        event_callback: ThreadsafeFunction<String>,
        send_frame_callback: ThreadsafeFunction<Buffer>,
        execute_http_callback: ThreadsafeFunction<JsHttpRequest, Promise<JsHttpResponse>>,
    ) -> Result<Self> {
        let rt = Arc::new(
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?,
        );

        let event_callback_arc = Arc::new(event_callback);
        let send_frame_callback_arc = Arc::new(send_frame_callback);
        let execute_http_callback_arc = Arc::new(execute_http_callback);

        let (transport_event_tx, transport_event_rx) = mpsc::channel::<TransportEvent>(100);

        let factory = NapiTransportFactory {
            send_frame_to_js: send_frame_callback_arc,
            event_rx: Arc::new(tokio::sync::Mutex::new(Some(transport_event_rx))),
        };

        let http_client = NapiHttpClient {
            execute_request_in_js: execute_http_callback_arc,
        };

        let bot = rt.block_on(async {
            Bot::builder()
                .with_transport_factory(factory)
                .with_http_client(http_client)
                .on_event(move |event, _client| {
                    let tsfn_arc = event_callback_arc.clone();
                    async move {
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
                                        "info": info,
                                        "textContent": message.text_content()
                                    }
                                })
                            }
                            Event::Connected(_) => json!({"type": "Connected"}),
                            Event::LoggedOut(logout_info) => json!({
                                "type": "LoggedOut",
                                "data": { "reason": format!("{:?}", logout_info.reason) }
                            }),
                            _ => json!({ "type": "Other" }),
                        };
                        let json_str = serde_json::to_string(&event_payload).unwrap();
                        tsfn_arc.call(Ok(json_str), ThreadsafeFunctionCallMode::Blocking);
                    }
                })
                .build()
                .await
                .expect("Failed to build bot")
        });

        Ok(Self {
            bot: Arc::new(tokio::sync::Mutex::new(Some(bot))),
            client: Arc::new(tokio::sync::Mutex::new(None)),
            rt,
            transport_event_sender: transport_event_tx,
        })
    }

    /// # Safety
    /// This function is unsafe because it spawns a task that runs the bot.
    #[napi]
    pub async unsafe fn start(&mut self) -> Result<()> {
        let bot_arc = self.bot.clone();
        let client_arc = self.client.clone();

        let bot_handle = self.rt.spawn(async move {
            let mut bot_lock = bot_arc.lock().await;
            if let Some(mut bot) = bot_lock.take() {
                // Store client reference before moving bot
                let client_ref = bot.client();
                *client_arc.lock().await = Some(client_ref.clone());

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

        bot_handle
            .await
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(())
    }

    #[napi]
    pub async fn send_message(&self, to_jid: String, text: String) -> Result<String> {
        let client_lock = self.client.lock().await;
        if let Some(client) = &*client_lock {
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
                "Bot not available".to_string(),
            ))
        }
    }

    #[napi]
    pub async fn notify_connected(&self) -> Result<()> {
        self.transport_event_sender
            .send(TransportEvent::Connected)
            .await
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    #[napi]
    pub async fn receive_frame(&self, frame: Buffer) -> Result<()> {
        self.transport_event_sender
            .send(TransportEvent::DataReceived(Bytes::from(frame.to_vec())))
            .await
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    #[napi]
    pub async fn notify_disconnected(&self) -> Result<()> {
        self.transport_event_sender
            .send(TransportEvent::Disconnected)
            .await
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }
}
