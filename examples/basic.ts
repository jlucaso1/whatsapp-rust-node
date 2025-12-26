import { WaBot } from "../index.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("--- WhatsApp Rust Node.js ---");

  const dbPath = path.join(__dirname, "whatsapp.db");
  console.log(`Using database at: ${dbPath}`);

  try {
    const bot = new WaBot(dbPath, (err, event) => {
      if (err) {
        console.error("[ERROR]", err);
        return;
      }

      switch (event.type) {
        case "PairingQrCode":
          console.log("\n--- SCAN QR CODE ---");
          console.log(event.code);
          console.log("--------------------\n");
          break;

        case "Message": {
          const { info, textContent } = event;
          const text = textContent ?? "<Media>";

          const chatJid = `${info.source.chat.user}@${info.source.chat.server}`;
          const senderJid = `${info.source.sender.user}@${info.source.sender.server}`;

          console.log(
            `[MSG] From: ${senderJid} | In: ${chatJid} | Text: "${text}"`
          );

          if (text.toLowerCase().trim() === "ping") {
            const pongText = "pong!";
            console.log(
              `--> Received 'ping', sending '${pongText}' back to ${chatJid}`
            );
            bot
              .sendMessage(chatJid, pongText)
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
          console.log(`[EVENT] Logged out. Reason: ${event.reason}`);
          break;

        case "Other":
          // Ignore other events
          break;
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
