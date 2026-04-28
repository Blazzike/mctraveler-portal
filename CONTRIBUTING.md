# Contributing to MCTraveler Portal

Welcome! This guide will help you get started with developing for the MCTraveler
Portal proxy.

## 🚀 Getting Started

### Prerequisites

- **[Bun](https://bun.sh/)** (Runtime & Package Manager)
- **[Go](https://go.dev/)** (Bubble Tea launcher)
- **Java 21+** (Automatically downloaded by the backend server script if missing)

### Installation

Clone the repository and install dependencies:

```bash
bun install
cp .env.example .env  # Optional — defaults work out of the box
```

## 🛠️ Running the Project

The easiest way to run the environment is using the Bubble Tea development
launcher. This manages the Proxy and two backend Minecraft servers (Primary &
Secondary) in a single terminal interface.

```bash
bun dev
```

### The Launcher Interface

- **Primary Server (Pane 1)**: Vanilla Minecraft server running on port `25566`.
- **Secondary Server (Pane 2)**: Vanilla Minecraft server running on port
  `25567`.
- **Proxy Server (Pane 3)**: The custom proxy running on port `25565`.

**Controls:**

- Press `1`, `2`, or `3` to focus a pane.
- Press `i` or `Enter` to type a command into the focused server console.
- Press `↑`/`↓`, `PgUp`/`PgDn`, `Home`/`End` to navigate logs.
- Press `e` to export all logs to `.mctraveler-runner.log`.
- Press `c` to copy focused logs through OSC52 when the terminal supports it.
- Press `q` or `Ctrl+C` to safely shut down all servers.

The runner also writes `.mctraveler-runner-live.log` while it runs so logs are
easy to copy into bug reports or LLM chats.

**Note:** The proxy runs in **watch mode**. Changes to `*.ts` files will
automatically restart the proxy process without restarting the backend Minecraft
servers.

### Manual Commands

If you prefer running services individually:

- **Proxy (Watch Mode)**: `bun run proxy:watch`
- **Primary Server**: `bun run minecraft:primary`
- **Secondary Server**: `bun run minecraft:secondary`

## 🧪 Testing

We use Bun's built-in test runner.

- **Run all tests**:
  ```bash
  bun test
  ```
- **Run tests in watch mode**:
  ```bash
  bun test --watch
  ```
- **Type check**:
  ```bash
  bun run typecheck
  ```

## 🏗️ Architecture Overview

This project is a custom Minecraft Proxy written in TypeScript. See
[README.md](README.md) for the full architecture breakdown.

### Connecting

Connect your Minecraft client (Version **1.21.10**) to:
`localhost:25565`

### Connection Lifecycle

Each client connection is managed by a `ConnectionHandler` instance
(`network/connection-handler.ts`) that progresses through states defined in the
`ConnectionState` enum:

```
Login → Configuration → Play
```

- **Login**: Handles handshake, encryption, Mojang authentication, and
  `Login Success`.
- **Configuration**: Forwards configuration packets (client settings, known
  packs). Transitions to Play on `Finish Configuration`.
- **Play**: Full packet handling with hooks, transforms, and server switching.

Server switching re-enters the Login→Configuration→Play cycle on a new backend
port, using a dimension-switch trick to avoid chunk corruption.

## 📝 How-Tos

### Adding a New Feature

1. Create a file in `features/` (e.g., `MyFeature.ts`):

```typescript
import {
  defineFeature,
  FeatureHook,
  registerHook,
} from "@/feature-api/manager";

export default defineFeature({
  name: "MyFeature",
  onEnable: () => {
    registerHook(FeatureHook.PlayerChat, ({ player, message }) => {
      // Handle chat
    });
  },
});
```

2. Register it in `features/registry.ts` by importing and adding to the array.

### Adding a New Module

1. Create a file in `modules/` (e.g., `MyModule.ts`):

```typescript
import { defineModule } from "@/module-api/module";

export default defineModule({
  name: "MyModule",
  api: {
    doSomething() {/* ... */},
  },
  onEnable: () => {
    // Set up hooks, packet handlers, etc.
  },
});
```

2. Enable it from a feature's `onEnable`:

```typescript
import MyModule from "@/modules/MyModule";

defineFeature({
  name: "MyFeature",
  onEnable: () => {
    enableModule(MyModule);
    MyModule.api.doSomething();
  },
});
```

### Adding a New Hook

1. Add an entry to the `FeatureHook` enum in `feature-api/manager.ts`.
2. Add a corresponding entry to the `HookMap` interface with `data` and `return`
   types.
3. Call `registerHook(FeatureHook.YourHook, callback)` to register listeners.
4. Call `executeHook(FeatureHook.YourHook, data)` or
   `executeHookFirst(FeatureHook.YourHook, data)` to invoke them — these are
   type-safe via `HookMap` overloads.

### Adding a New Packet

1. Add the packet definition to `defined-packets.json`.
2. Run `bun generate-packets` to regenerate `defined-packets.gen.ts`.
3. See `docs/protocol.json` for packet name references.

### Using Structured Logging

```typescript
import { log } from "@/logging";

const logger = log.for("MyComponent");
logger.info("Player %s joined on port %d", username, port);
logger.warn("Something unexpected: %s", reason);
logger.error("Failed: %s", error);
logger.debug("Verbose detail: %d items", count);
```

- **Production**: Only `warn` and `error` are shown.
- **Development**: All levels are shown.

## 🎨 Code Style

We use **[Biome](https://biomejs.dev/)** for linting and formatting.

- **Format code**: `bun run format`
- **Lint code**: `bun run lint`
- **Check everything**: `bun run check`
