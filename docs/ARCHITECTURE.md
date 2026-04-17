# Architecture Reference

This document provides a deeper look into the internal architecture of the
MCTraveler Portal proxy.

## Connection Lifecycle

Each client connection is managed by a `ConnectionHandler` instance that
progresses through a state machine defined by the `ConnectionState` enum:

```
┌───────┐     Login Success     ┌──────────────┐  Finish Config  ┌──────┐
│ Login │ ────────────────────► │ Configuration │ ──────────────► │ Play │
└───────┘                       └──────────────┘                 └──────┘
```

### Login Phase

1. Client sends Handshake + Login Start.
2. If `ONLINE_MODE=true`, the proxy sends an Encryption Request and waits for
   the client's Encryption Response.
3. The proxy verifies the shared secret and authenticates with Mojang's session
   server.
4. The proxy connects to the backend server (in offline mode) and forwards the
   Login Start.
5. Upon receiving Login Success from the backend, the proxy sends Set
   Compression + Login Success to the client.
6. State transitions to `Configuration`.

### Configuration Phase

- Client and server exchange configuration packets (client settings, plugin
  messages, known packs).
- The proxy caches `ClientInformation` and `KnownPacks` for replay during
  server switches.
- On `Finish Configuration` from the server, state transitions to `Play`.

### Play Phase

- Full bidirectional packet forwarding with hook interception.
- Server→client packets pass through handlers (may block) then transforms (may
  modify).
- Client→server packets pass through handlers (may block).
- Special handling for: Join Game (tab list init), Respawn (dimension tracking),
  Game State Change (gamemode), System Chat (paint formatting).

## Server Switching

When a player switches servers (e.g., via `/switch`):

1. The current backend connection is closed.
2. Player data is synced between servers (inventory, health, etc.).
3. A new connection is established to the target backend.
4. The proxy enters "switching" mode, re-doing the Login→Configuration→Play
   cycle.
5. A **dimension-switch trick** is applied: the Join Game packet is modified to
   report an alternate dimension, then a Respawn packet sends the correct one.
   This forces the client to unload all chunks and reload fresh ones, preventing
   chunk corruption.

## Hook System

The hook system is the primary extension mechanism. It lives in
`feature-api/manager.ts`.

### Registration

```typescript
registerHook(FeatureHook.PlayerChat, ({ player, message }) => {
  // return value depends on the hook's HookMap entry
});
```

### Execution

- **`executeHook(hook, data)`**: Calls all registered callbacks, returns an
  array of results.
- **`executeHookFirst(hook, data)`**: Calls callbacks until one returns a
  non-null/undefined value.

Both are type-safe via `HookMap` overloads — the data parameter and return type
are inferred from the hook name.

### HookMap

The `HookMap` interface maps each `FeatureHook` to its expected data and return
types. When adding a new hook, you must add a corresponding entry to `HookMap`.

### Available Hooks

| Hook | Data | Return | Purpose |
|------|------|--------|---------|
| `MotdRequest` | `void` | `[Paint, Paint]` | Server list MOTD |
| `PlayerJoin` | `PlayerEvent` | `void` | Player connected |
| `PlayerLeave` | `PlayerEvent` | `void` | Player disconnected |
| `PlayerChat` | `PlayerEvent & { message }` | `Paint \| void` | Chat message |
| `PlayerCommand` | `PlayerEvent & { command }` | `void` | Command sent |
| `PlayerMove` | `PlayerMoveEvent` | `void` | Position change |
| `SystemChat` | `{ nbt, isActionBar }` | `Paint \| false \| null` | System message |
| `EditBook` | `PlayerEvent & { packetData }` | `boolean \| void` | Book editing |
| `HeldItemChange` | `PlayerEvent & { packetData }` | `void` | Held slot change |
| `InventoryClick` | `PlayerEvent & { packetData }` | `void` | Inventory click |
| `CheckBlockDigProtection` | `PlayerEvent & { position, world }` | `boolean \| void` | Block break protection |
| `CheckBlockPlaceProtection` | `PlayerEvent & { position, world }` | `boolean \| void` | Block place protection |
| `CheckContainerClickProtection` | `PlayerEvent` | `boolean \| void` | Container click protection |
| `CheckSignEditProtection` | `PlayerEvent & { position, world }` | `boolean \| void` | Sign edit protection |
| `CheckItemUseProtection` | `PlayerEvent` | `boolean \| void` | Item use protection |
| `CheckEntityInteractProtection` | `PlayerEvent & { action }` | `boolean \| void` | Entity interact protection |
| `ContainerOpen` | `PlayerEvent` | `void` | Container opened |
| `ContainerClose` | `PlayerEvent` | `void` | Container closed |
| `PlayerGameModeChange` | `PlayerEvent & { gameMode }` | `void` | Gamemode change |
| `ClearPlayerProtection` | `PlayerEvent` | `void` | Clear protection state |
| `GetRemappedProfile` | `{ username }` | `{ newUsername, newUuid } \| null` | Profile remapping |
| `BuildPlayerInfoPacket` | `{ uuid, username, props }` | `Buffer \| undefined` | Build player info packet |
| `BuildPlayerRemovePacket` | `{ uuid }` | `Buffer \| undefined` | Build player remove packet |
| `BuildTabListHeaderFooterPacket` | `void` | `Buffer \| null` | Tab list header/footer |
| `RemovePlayerFromTabList` | `{ uuid }` | `void` | Remove from tab list |
| `SetProfileProperties` | `{ uuid, props }` | `void` | Store profile properties |
| `GetProfileProperties` | `{ uuid }` | `any[] \| undefined` | Retrieve profile properties |
| `TrackPlayerLogin` | `{ uuid, username, socket, serverPort, isPremium, offlineUuid }` | `OnlinePlayer \| undefined` | Track player login |
| `TrackPlayerLogout` | `{ uuid }` | `void` | Track player logout |
| `SetServerSwitcher` | `{ uuid, switcher }` | `void` | Register switcher function |
| `ClearServerSwitcher` | `{ uuid }` | `void` | Clear switcher function |

## Packet Handler System

Beyond hooks, the proxy has a lower-level packet handler system for
intercepting and transforming raw packets:

- **`onServerToClientPacket(handler)`**: Register a handler for server→client
  packets. Return `true` to block the packet.
- **`onServerToClientTransform(packetId, transformer)`**: Register a transform
  for a specific packet. Return modified data or `null` to drop.
- **`onClientToServerPacket(handler)`**: Register a handler for client→server
  packets. Return `true` to block the packet.

These are used by modules (e.g., `CommandsInjectionModule`,
`PlayerInfoBitflagsModule`, `ProtectionHooksModule`) for packet-level
operations that don't fit the hook model.

## Module System

Modules are shared services that expose typed APIs. They are defined with
`defineModule()` and enabled with `enableModule()`.

### Lifecycle

- `onEnable()`: Called when the module is first enabled. Set up hooks and
  packet handlers here.
- `onPlayerJoin?(player)`: Called when a player joins.
- `onPlayerLeave?(player)`: Called when a player leaves.

### Module API Pattern

Each module exposes its functionality through a typed `api` object:

```typescript
export default defineModule({
  name: 'MyModule',
  api: {
    getSomething(uuid: string): Data | undefined { ... },
    doAction(uuid: string, value: string): void { ... },
  },
  onEnable: () => { ... },
});
```

Consumers access the API directly: `MyModule.api.getSomething(uuid)`.

## Feature System

Features are the top-level organizational unit. They register hooks, enable
modules, and coordinate behavior.

### Feature with Module Dependencies

```typescript
import { defineFeature, registerHook, FeatureHook } from '@/feature-api/manager';
import { enableModule, type ModuleDefinition } from '@/module-api/module';
import MyModule from '@/modules/MyModule';

export default defineFeature({
  name: 'MyFeature',
  modules: { myModule: MyModule as ModuleDefinition<{ doSomething: () => void }> },
  onEnable: ({ myModule }) => {
    enableModule(MyModule);
    myModule.doSomething();
    registerHook(FeatureHook.PlayerChat, ({ player, message }) => { ... });
  },
});
```

## Structured Logging

All logging should use the structured logging system from `@/logging`:

```typescript
import { log } from '@/logging';

const logger = log.for('ComponentName');
logger.info('Message with %s and %d', stringArg, numberArg);
logger.warn('Warning: %s', reason);
logger.error('Error: %s', error);
logger.debug('Debug: %d', value);
```

- **Development**: All levels shown with colored component tags.
- **Production**: Only `warn` and `error` are shown.
- Never use raw `console.log` / `console.error` — always use `log.for()`.

## Encryption & Authentication Flow

```
Client                          Proxy                         Mojang    Backend
  │                               │                              │         │
  │── Login Start ──────────────►│                              │         │
  │                               │                              │         │
  │◄── Encryption Request ───────│                              │         │
  │── Encryption Response ──────►│                              │         │
  │                               │── Session Verify ──────────►│         │
  │                               │◄── Profile ─────────────────│         │
  │                               │                              │         │
  │                               │── Handshake + Login Start ──────────►│
  │                               │◄── Login Success ────────────────────│
  │                               │                              │         │
  │◄── Set Compression ──────────│                              │         │
  │◄── Login Success ────────────│                              │         │
  │                               │                              │         │
  │── Configuration packets ────────────────────────────────────────────►│
  │◄── Configuration packets ──────────────────────────────────────────│
  │                               │                              │         │
  │◄── Finish Configuration ───────────────────────────────────────────│
  │── Finish Configuration ────────────────────────────────────────────►│
  │                               │                              │         │
  │◄── Join Game ──────────────────────────────────────────────────────│
  │         ... Play phase ...    │                              │         │
```
