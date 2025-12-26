# WhatsApp Rust Node.js Copilot Instructions

## Project Overview

This is a Node.js native addon written in Rust using napi-rs that provides WhatsApp bot functionality. It wraps the `whatsapp-rust` and `waproto` crates to create a type-safe JavaScript API for WhatsApp messaging.

## Architecture

- **Rust-First**: WebSocket and protocol handling entirely in Rust via `tokio-websockets`
- **Event-Driven**: Type-safe discriminated union events from Rust to JavaScript
- **Persistent Storage**: SQLite database for WhatsApp session state
- **Thread Safety**: Uses napi-rs threadsafe functions for cross-language communication
- **Auto-Generated Types**: TypeScript types generated from Rust structs via napi-rs

## Project Structure

```
whatsapp-rust-node/
├── src/
│   └── lib.rs          # Core Rust implementation
├── examples/
│   └── basic.ts        # Example bot usage
├── index.js            # Auto-generated ESM wrapper
├── index.d.ts          # Auto-generated TypeScript types
├── index.node          # Native binary (gitignored)
├── Cargo.toml          # Rust dependencies
├── package.json        # Node.js package config
└── tsconfig.json       # TypeScript config
```

## Build & Development Workflow

```bash
# Install dependencies
bun install

# Build Rust native module (release)
bun run build          # napi build --release

# Build for debugging
bun run build:debug    # napi build

# Type check
bun run typecheck      # tsc --noEmit

# Run example
bun run example        # bun examples/basic.ts
```

## Type System

Events use Rust discriminated unions with `#[napi(discriminant = "type")]`:

```rust
#[napi(discriminant = "type")]
pub enum BotEvent {
    PairingQrCode { code: String, timeout: u32 },
    Message { info: MessageInfo, text_content: Option<String> },
    Connected,
    LoggedOut { reason: String },
    Other,
}
```

Generates fully type-safe TypeScript:

```typescript
export type BotEvent =
  | { type: 'PairingQrCode', code: string, timeout: number }
  | { type: 'Message', info: MessageInfo, textContent?: string }
  | { type: 'Connected' }
  | { type: 'LoggedOut', reason: string }
  | { type: 'Other' }
```

## Code Patterns

### Event Handling

```typescript
const bot = new WaBot(dbPath, (err, event) => {
  switch (event.type) {
    case "PairingQrCode":
      console.log(event.code);  // TypeScript knows code exists
      break;
    case "Message":
      console.log(event.info);  // TypeScript knows info exists
      break;
  }
});
```

### Message Sending

```typescript
const messageId = await bot.sendMessage(jid, text);
```

## Dependencies

- **Rust**: `whatsapp-rust` (with `tokio-transport`, `sqlite-storage`, `ureq-client` features), `waproto`, `napi`, `tokio`
- **Node.js**: `@napi-rs/cli`, TypeScript

## Database

- SQLite file: `whatsapp.db` (auto-created, ignored in git)
- WAL mode: Accompanied by `.db-shm` and `.db-wal` files
- Schema managed by `whatsapp-rust::store::SqliteStore`

## Key Files

- `src/lib.rs`: Core Rust implementation with napi bindings
- `examples/basic.ts`: Example bot with event handling
- `Cargo.toml`: Rust dependencies and build config
- `package.json`: Node.js scripts and napi configuration

## Development Notes

- Requires Rust **nightly** toolchain (see `rust-toolchain.toml`)
- Always build in release mode for production (`bun run build`)
- Database files are gitignored - each developer gets fresh state
- QR code pairing required on first run
- Bot runs indefinitely until stopped (Ctrl+C)
