import { WaBot } from "./index.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("--- WhatsApp Rust Node.js POC ---");

  const dbPath = path.join(__dirname, "whatsapp.db");
  console.log(`Using database at: ${dbPath}`);

  try {
    console.log("Instantiating WaBot...");
    const bot = new WaBot(dbPath, (err: Error | null, eventJson: string) => {
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

          console.log(
            `[MSG] From: ${info.source.sender} | In: ${info.source.chat} | Text: "${text}"`
          );

          if (text.toLowerCase().trim() === "ping") {
            const replyToJid = info.source.chat;
            const pongText = "pong!";

            console.log(
              `--> Received 'ping', sending '${pongText}' back to ${replyToJid}`
            );

            bot
              .sendMessage(replyToJid, pongText)
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
    });

    console.log("Bot instance created. Starting connection...");
    await bot.start();

    console.log("Bot has stopped.");
  } catch (e) {
    console.error("An error occurred:", e);
    process.exit(1);
  }
}

main().catch(console.error);
