import { WaBot } from "./index.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("--- WhatsApp Rust Node.js ---");

  const dbPath = path.join(__dirname, "whatsapp.db");
  console.log(`Using database at: ${dbPath}`);

  try {
    const bot = new WaBot(dbPath, (err, eventJson) => {
      if (err) {
        console.error("[ERROR]", err);
        return;
      }
      if (!eventJson) {
        console.error("[ERROR] Received empty event");
        return;
      }

      try {
        const event = JSON.parse(eventJson);

        switch (event.type) {
          case "PairingQrCode":
            if (event.data?.code) {
              console.log("\n--- SCAN QR CODE ---");
              console.log(event.data.code);
              console.log("--------------------\n");
            }
            break;

          case "Message": {
            const { info, textContent } = event.data;
            const text = textContent || "<Media>";

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
                .then((msgId) => {
                  console.log(
                    `--> Pong sent successfully! (Message ID: ${msgId})`
                  );
                })
                .catch((err) => {
                  console.error("--> Failed to send pong message:", err);
                });
            }
            break;
          }

          case "Connected":
            console.log("[EVENT] Connected to WhatsApp");
            break;

          case "LoggedOut":
            console.log(`[EVENT] Logged out. Reason: ${event.data?.reason}`);
            break;

          default:
            // Ignore other events
            break;
        }
      } catch (e) {
        console.error("[ERROR] Failed to parse event:", e);
      }
    });

    console.log("Starting the bot...");
    await bot.start();

    console.log("Bot has stopped. The script will now exit.");
  } catch (e) {
    console.error("An error occurred:", e);
    process.exit(1);
  }
}

main().catch(console.error);
