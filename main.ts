import { WaBot } from "./index.js";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WA_URL = "wss://web.whatsapp.com/ws/chat";

async function main() {
  console.log("--- WhatsApp Rust Node.js with JS Transport ---");

  const dbPath = path.join(__dirname, "whatsapp.db");
  console.log(`Using database at: ${dbPath}`);

  try {
    let ws: WebSocket | null = null;
    let isWsOpen = false;
    // Frame queuing to handle race condition between Rust and WebSocket
    const outgoingFrameQueue: Buffer[] = [];

    console.log("Instantiating WaBot with transport callbacks...");
    const bot = new WaBot(
      dbPath,
      // 1. Event Callback (for QR codes, messages, etc.)
      (err: Error | null, eventJson: string) => {
        if (err) {
          console.error("[EVENT] Error from Rust:", err);
          return;
        }

        if (!eventJson) {
          console.error(
            "[EVENT] Received an empty or null event string from Rust."
          );
          return;
        }

        try {
          const event = JSON.parse(eventJson);
          if (!event) {
            console.error(
              "[EVENT] JSON parsing resulted in null. Original string:",
              eventJson
            );
            return;
          }

          if (event.type === "PairingQrCode") {
            console.log("\n--- SCAN QR CODE ---");
            console.log(event.data.code);
            console.log("--------------------\n");
          }

          if (event.type === "Message") {
            const { info, textContent } = event.data;
            const text = textContent || "<Media>";

            // Convert JID objects to string format
            const chatJidObject = info.source.chat;
            const chatJidString = `${chatJidObject.user}@${chatJidObject.server}`;

            const senderJidObject = info.source.sender;
            const senderJidString = `${senderJidObject.user}@${senderJidObject.server}`;

            console.log(
              `[MSG] From: ${senderJidString} | In: ${chatJidString} | Text: "${text}"`
            );

            if (text.toLowerCase().trim() === "ping") {
              const pongText = "pong!";

              console.log(
                `--> Received 'ping', sending '${pongText}' back to ${chatJidString}`
              );

              bot
                .sendMessage(chatJidString, pongText)
                .then((msgId: string) => {
                  console.log(
                    `--> Pong sent successfully! (Message ID: ${msgId})`
                  );
                })
                .catch((err: any) => {
                  console.error("--> Failed to send pong message:", err);
                });
            }
          }

          if (event.type === "SerializationError") {
            console.error(
              "[RUST ERROR] Failed to serialize an event:",
              event.error
            );
          }
        } catch (e) {
          console.error("Failed to parse event JSON:", e);
          console.error("Original string from Rust:", eventJson);
        }
      },
      // 2. Send Frame Callback (for sending data from Rust to JS)
      (err: Error | null, frameBuffer: Buffer) => {
        if (err) {
          console.error("[TRANSPORT] Error receiving frame from Rust:", err);
          return;
        }

        // Queue or send frame based on connection state
        if (isWsOpen && ws) {
          ws.send(frameBuffer);
        } else {
          console.log(
            `[TRANSPORT] WebSocket not open, queuing frame of ${frameBuffer.length} bytes.`
          );
          outgoingFrameQueue.push(frameBuffer);
        }
      }
    );

    console.log("Bot instance created. Starting WebSocket connection...");

    ws = new WebSocket(WA_URL, {
      headers: {
        origin: "https://web.whatsapp.com",
      },
    });

    // Set max listeners to prevent memory leaks
    ws.setMaxListeners(0);

    // 3. Wire up WebSocket events to the Rust core
    ws.on("open", () => {
      console.log("[TRANSPORT] WebSocket connection opened.");
      isWsOpen = true;

      // Flush the queued frames
      console.log(
        `[TRANSPORT] Flushing ${outgoingFrameQueue.length} queued frames...`
      );
      while (outgoingFrameQueue.length > 0) {
        const frame = outgoingFrameQueue.shift();
        if (frame && ws) {
          ws.send(frame);
        }
      }

      // Notify the Rust client that the transport is ready
      bot.notifyConnected();
    });

    ws.on("message", (data: Buffer) => {
      // `data` is a Buffer, which is what our Rust function expects.
      // Feed the received frame into the Rust core.
      bot.receiveFrame(data);
    });

    ws.on("close", () => {
      console.log("[TRANSPORT] WebSocket connection closed.");
      isWsOpen = false; // Update connection state
      // Notify the Rust client that the transport has disconnected.
      bot.notifyDisconnected();
    });

    ws.on("error", (err: Error) => {
      console.error("[TRANSPORT] WebSocket error:", err);
    });

    console.log("Starting the bot's main loop...");
    await bot.start();

    console.log("Bot has stopped. The script will now exit.");
  } catch (e) {
    console.error("An error occurred:", e);
    process.exit(1);
  }
}

main().catch(console.error);
