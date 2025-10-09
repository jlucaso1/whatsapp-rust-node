import { WaBot as NativeWaBot } from "./index.js";
import { EventEmitter } from "events";
import WebSocket from "ws";

const WA_URL = "wss://web.whatsapp.com/ws/chat";

export class WaBot extends EventEmitter {
  private nativeBot: NativeWaBot;
  private ws: WebSocket | null = null;
  private isWsOpen = false;
  private outgoingFrameQueue: Buffer[] = [];

  constructor(dbPath: string) {
    super();

    this.nativeBot = new NativeWaBot(
      dbPath,
      (err, eventJson) => {
        if (err) {
          this.emit("error", err);
          return;
        }
        if (!eventJson) {
          this.emit(
            "error",
            new Error("Received an empty event string from Rust.")
          );
          return;
        }
        try {
          const event = JSON.parse(eventJson);
          if (event.type) {
            this.emit(event.type, event.data);
          } else {
            this.emit("unknown_event", event);
          }
        } catch (e) {
          this.emit(
            "error",
            new Error(`Failed to parse event JSON: ${eventJson}`)
          );
        }
      },
      (err, frameBuffer) => {
        if (err) {
          console.error("[TRANSPORT] Error receiving frame from Rust:", err);
          this.emit("error", err);
          return;
        }
        if (this.isWsOpen && this.ws) {
          this.ws.send(frameBuffer);
        } else {
          this.outgoingFrameQueue.push(frameBuffer);
        }
      }
    );
  }

  private connectWebSocket() {
    this.ws = new WebSocket(WA_URL, {
      headers: {
        origin: "https://web.whatsapp.com",
      },
    });

    this.ws.setMaxListeners(0);

    this.ws.on("open", () => {
      console.log("[WS] WebSocket connection opened");
      this.isWsOpen = true;
      while (this.outgoingFrameQueue.length > 0) {
        console.log("[WS] Sending queued frame");
        const frame = this.outgoingFrameQueue.shift();
        if (frame && this.ws) {
          this.ws.send(frame);
        }
      }
      this.nativeBot.notifyConnected();
    });

    this.ws.on("message", (data: Buffer) => {
      this.nativeBot.receiveFrame(data);
    });

    this.ws.on("close", () => {
      this.isWsOpen = false;
      this.nativeBot.notifyDisconnected();
    });

    this.ws.on("error", (err) => {
      this.emit("error", err);
    });
  }

  public async start() {
    this.connectWebSocket();
    // This is unsafe as it spawns a long-running task.
    // Ensure the process is managed correctly.
    await this.nativeBot.start();
  }

  public async sendMessage(toJid: string, text: string): Promise<string> {
    return this.nativeBot.sendMessage(toJid, text);
  }
}
