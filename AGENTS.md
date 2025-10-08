# WhatsApp Rust Node.js Copilot Instructions

## Project Overview

This is a Node.js addon written in Rust using napi-rs that provides WhatsApp bot functionality. It wraps the `whatsapp-rust` and `waproto` crates to create a JavaScript API for WhatsApp messaging.

## Architecture

- **Hybrid Architecture**: Node.js (TypeScript) frontend with Rust native addon backend
- **Event-Driven**: Asynchronous event callbacks from Rust to JavaScript
- **Persistent Storage**: SQLite database for WhatsApp session state
- **Thread Safety**: Uses napi-rs threadsafe functions for cross-language communication

## Key Components

- `WaBot` class: Main bot interface in `src/lib.rs`
- Event system: Handles pairing QR codes, messages, and connection status
- SQLite backend: Automatic schema management via `whatsapp-rust` crate

## Build & Development Workflow

```bash
# Install dependencies
bun install

# Build Rust native module (release)
npm run build          # napi build --release

# Build for debugging
npm run build:debug    # napi build

# Compile TypeScript (optional, Bun handles TS natively)
npm run build:ts       # tsc

# Run the bot
npm start              # bun main.ts
```

## Code Patterns

### Event Handling

Events are JSON-serialized strings passed via threadsafe callbacks:

```typescript
const bot = new WaBot(dbPath, (err, eventJson) => {
  const event = JSON.parse(eventJson);
  // Handle event.type: "PairingQrCode", "Message", "Connected", etc.
});
```

### Message Sending

```typescript
const messageId = await bot.sendMessage(jid, text);
// Returns message ID string on success
```

### JID Handling

WhatsApp identifiers are parsed as JIDs:

```rust
let jid = to_jid.parse().map_err(|e| Error::new(Status::InvalidArg, format!("Invalid JID: {}", e)))?;
```

## Dependencies

- **Rust**: `whatsapp-rust`, `waproto` (from GitHub), `napi`, `tokio`, `serde_json`
- **Node.js**: `@napi-rs/cli`, TypeScript, Bun runtime

## Database

- SQLite file: `whatsapp.db` (auto-created, ignored in git)
- WAL mode: Accompanied by `.db-shm` and `.db-wal` files
- Schema managed by `whatsapp-rust::store::SqliteStore`

## Error Handling

- Rust errors converted to napi `Status` codes
- JSON serialization errors handled gracefully with fallback error events
- Threadsafe function calls are blocking to ensure delivery

## Key Files

- `src/lib.rs`: Core Rust implementation
- `main.ts`: Example usage and event handling
- `Cargo.toml`: Rust dependencies and build config
- `package.json`: Node.js scripts and napi configuration

## Development Notes

- Always build in release mode for production (`npm run build`)
- Database files are gitignored - each developer gets fresh state
- QR code pairing required on first run
- Bot runs indefinitely until stopped (Ctrl+C)
