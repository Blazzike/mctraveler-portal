# AGENTS.md — AI Coding Agent Reference

Quick-reference for AI agents working on this codebase.

## Project Overview

Minecraft proxy server (TypeScript/Bun) that sits between clients and multiple
backend servers. Handles packet forwarding, encryption, Mojang auth, server
switching, and custom game mechanics via a hook/module/feature system.

**Minecraft version**: 26.1.2 (protocol 775, 1.21.4)

## Commands

| Command | Purpose |
|---------|---------|
| `bun install` | Install dependencies |
| `bun dev` | Start dev launcher (proxy + 2 backend servers) |
| `bun test` | Run test suite |
| `bun run typecheck` | TypeScript type check (`tsc --noEmit`) |
| `bun run check` | Biome lint + format |
| `bun run format` | Biome format only |
| `bun run lint` | Biome lint only |
| `bun run precommit` | typecheck + check (runs on pre-commit hook) |
| `bun run generate-packets` | Regenerate `defined-packets.gen.ts` from `defined-packets.json` |
| `bun run proxy:watch` | Proxy only, with hot reload |
| `bun run minecraft:primary` | Start primary backend |
| `bun run minecraft:secondary` | Start secondary backend |

**Always run `bun run typecheck && bun test` after making changes.**

## Code Style

- **Formatter**: Biome (2-space indent, single quotes, semicolons, 150 char line width)
- **Path aliases**: `@/` maps to project root (e.g., `import { log } from '@/logging'`)
- **Module system**: ESM (`"type": "module"` in package.json)
- **TypeScript**: Strict mode, `noUncheckedIndexedAccess`, `noImplicitOverride`
- **No raw `console.*`**: Always use `log.for('Component')` from `@/logging`
- **Comments**: Do not add or delete comments unless explicitly asked
- **Exports**: Use `export default` for modules/features, named exports for utilities

## Architecture

```
main.ts              → Entry point, starts proxy
launcher.ts          → Dev TUI (manages proxy + backend servers)
config.ts            → Env-based configuration constants
logging.ts           → Structured logging (log.for('Component'))

network/
  proxy.ts           → TCP server, creates ConnectionHandler per connection
  connection-handler.ts → Per-connection state machine (Login→Config→Play)
  connection-state.ts  → ConnectionState enum
  packet-handlers.ts   → Register/dispatch server↔client packet handlers
  packet-routing.ts    → Parse chat, movement, interactions from client packets
  player-tracking.ts   → Online player map, sockets, dimensions
  packet-ids.ts        → Raw packet ID constants
  compression.ts       → Zlib compression for packets
  encryption.ts        → AES/CFB8 encryption, RSA key generation
  login-packets.ts     → Login/encryption packet construction
  mojang-session.ts    → Mojang session server verification
  defined-packet.ts    → Typed packet write utility
  packet-queue.ts      → Async packet reader queue
  util.ts              → safeWrite, forwardPacket

feature-api/
  manager.ts          → FeatureHook enum, HookMap, registerHook/executeHook/executeHookFirst
  command.ts          → registerCommand, syntax for slash commands
  paint.ts            → Rich text (Paint) formatting for chat

features/
  registry.ts         → Feature registration array (order matters)
  *.ts                → Individual features (see below)

modules/
  index.ts            → Module barrel export
  *.ts                → Individual modules (see below)

module-api/
  module.ts           → defineModule, enableModule, lifecycle hooks

encoding/
  data-buffer.ts      → VarInt, string, UUID, NBT encode/decode

defined-packets.json  → Packet definitions (input to generator)
defined-packets.gen.ts → Auto-generated typed packet writers
manual-packets.ts     → Hand-written packet helpers (player info update)
```

## Key Patterns

### Hook System (`feature-api/manager.ts`)

The primary extension mechanism. Type-safe via `HookMap` overloads.

```typescript
// Register a hook listener
registerHook(FeatureHook.PlayerChat, ({ player, message }) => {
  return paintResult; // return type inferred from HookMap
});

// Execute all hooks, get all results
const results = executeHook(FeatureHook.CheckBlockPlaceProtection, { player, position, world });

// Execute hooks, return first non-null result
const profile = executeHookFirst(FeatureHook.GetRemappedProfile, { username });
```

**Adding a new hook**: Add to `FeatureHook` enum AND `HookMap` interface in
`feature-api/manager.ts`. The `HookMap` entry defines `data` and `return` types.

### Feature Pattern (`features/`)

```typescript
export default defineFeature({
  name: 'MyFeature',
  onEnable: () => {
    enableModule(SomeModule);
    registerHook(FeatureHook.PlayerJoin, ({ player }) => { ... });
  },
});
```

Register in `features/registry.ts` — order determines initialization order.

### Module Pattern (`modules/`)

```typescript
export default defineModule({
  name: 'MyModule',
  api: {
    doThing(uuid: string): void { ... },
  },
  onEnable: () => {
    onServerToClientTransform(somePacketId, (player, packetId, data) => {
      return modifiedData; // or null to drop
    });
  },
});
```

Enable from a feature: `enableModule(MyModule)`. Access API:
`MyModule.api.doThing(uuid)`.

### Packet Handler Pattern

Lower-level than hooks. Used for packet interception/transformation.

```typescript
// Block a server→client packet
onServerToClientPacket((player, packetId, data) => {
  if (packetId === targetId) return true; // true = block
  return false;
});

// Transform a server→client packet
onServerToClientTransform(packetId, (player, packetId, data) => {
  return modifiedBuffer; // return data to forward, null to drop
});

// Block a client→server packet
onClientToServerPacket((player, packetId, data) => {
  if (shouldBlock) return true;
  return false;
});
```

### Adding a New Packet

1. Add packet definition to `defined-packets.json` (see `docs/protocol.json`
   for packet names).
2. Run `bun generate-packets` to regenerate `defined-packets.gen.ts`.
3. Import and use: `import { myPacket } from '@/defined-packets.gen'`.

### Structured Logging

```typescript
import { log } from '@/logging';
const logger = log.for('MyComponent');
logger.info('Player %s joined port %d', name, port);
logger.warn('Unexpected: %s', reason);
logger.error('Failed: %s', error);
logger.debug('Detail: %d', count);
```

**Never use `console.log`/`console.error`/`console.warn`/`console.debug`** —
always use `log.for()`. The only exception is `logging.ts` itself.

### Connection Lifecycle

`ConnectionHandler` manages each client through states:

```
Login → Configuration → Play
```

- **Login**: Handshake, encryption, Mojang auth, Login Success
- **Configuration**: Forward config packets, cache ClientSettings/KnownPacks
- **Play**: Full bidirectional packet handling with hooks/transforms

Server switching re-enters Login→Config→Play on a new backend, using a
dimension-switch trick (Join Game with alt dimension → Respawn with correct
dimension) to force chunk reloading.

## Configuration

Environment variables (set in `.env`, defaults in `config.ts`):

| Variable | Default | Config constant |
|----------|---------|----------------|
| `PORT` | 25565 | `kPort` |
| `PRIMARY_PORT` | 25566 | `kPrimaryPort` |
| `SECONDARY_PORT` | 25567 | `kSecondaryPort` |
| `PROTOCOL_VERSION` | 775 | `kProtocolVersion` |
| `PROTOCOL_VERSION_STRING` | 26.1.2 | `kProtocolVersionString` |
| `ONLINE_MODE` | true | `kIsOnlineMode` |
| `PRODUCTION` | — | `kIsProduction` |

## Testing

Tests use Bun's built-in test runner (`Bun.test`).

- Test files live in `test/` mirroring source structure.
- Modules must be enabled in tests via `enableModule()` before their APIs work.
- The `player-tracking.ts` socket lookup is overridable for testing via
  `_setSocketLookupForTesting`.
- Tab list tests use `OnlinePlayersModule` to register player sockets.

## Common Pitfalls

- **`isOnlineMode` vs `isOnline`**: The `OnlinePlayer` interface uses `isOnline`
  (getter), but `ProxyPlayer` uses `isPremium`. Don't confuse them.
- **`trackedPlayer` typing**: In `connection-handler.ts`, `trackedPlayer` is
  typed as `OnlinePlayer | null`. Properties like `cachedClientSettings`,
  `cachedKnownPacks`, and `_lastInteractTime` are optional on `OnlinePlayer`.
- **Packet ID constants**: Some packet IDs are in `packet-ids.ts` as raw
  numbers, others come from `defined-packets.gen.ts` as `.id` properties on
  the packet object. Prefer the generated packet objects when available.
- **VarInt reading**: Many manual packet parsers read VarInts with
  `do { b = data[offset++]; } while ((b & 0x80) !== 0)`. This is a common
  pattern for parsing Minecraft's variable-length integers.
- **Compression**: Must be enabled on both client and server sockets at the
  right time (after Set Compression / before Login Success).
- **Server switching**: The `isSwitching` flag must be carefully managed — it
  suppresses normal packet forwarding during the switch cycle.
