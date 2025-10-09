import { WaBot } from "./bot.ts";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log("--- WhatsApp Rust Node.js with JS Transport ---");

  const dbPath = path.join(__dirname, "whatsapp.db");
  console.log(`Using database at: ${dbPath}`);

  try {
    const bot = new WaBot(dbPath);

    bot.on("PairingQrCode", (data) => {
      if (data && data.code) {
        console.log("\n--- SCAN QR CODE ---");
        console.log(data.code);
        console.log("--------------------\n");
      }
    });

    bot.on("Message", async (data) => {
      const { info, textContent } = data;
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
        try {
          const msgId = await bot.sendMessage(chatJidString, pongText);
          console.log(`--> Pong sent successfully! (Message ID: ${msgId})`);
        } catch (err) {
          console.error("--> Failed to send pong message:", err);
        }
      }
    });

    bot.on("Connected", () => {
      console.log("[EVENT] Connected to WhatsApp");
    });

    bot.on("LoggedOut", (data) => {
      console.log(`[EVENT] Logged out. Reason: ${data.reason}`);
    });

    bot.on("error", (err) => {
      console.error("[ERROR]", err);
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
