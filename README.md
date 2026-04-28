# MCTraveler Portal

A custom, high-performance Minecraft proxy server written in TypeScript and
powered by Bun.

This project serves as a gateway between Minecraft clients and multiple backend
servers, featuring a robust plugin-like architecture for custom game mechanics,
packet interception, and seamless server switching.

## 🚀 Features

- **Custom Proxy Implementation**: Built from scratch to handle Minecraft
  protocol version 1.21.10.
- **Feature System**: Modular architecture where functionality (chat, MOTD, tab
  list, etc.) is isolated into "Features" that hook into network events.
- **Module System**: Shared services and state management (e.g.,
  `OnlinePlayersModule`).
- **Type-Safe Hooks**: The `FeatureHook` enum and `HookMap` interface provide
  compile-time type safety for hook data and return values.
- **Structured Logging**: Scoped loggers (`log.for('Component')`) with
  printf-style formatting and level control.
- **Development Launcher**: Integrated terminal dashboard (TUI) to manage the
  proxy and backend servers simultaneously.
- **Hot Reloading**: The proxy supports watch mode for rapid development.

## 📋 Prerequisites

- **[Bun](https://bun.sh/)**: Required for the runtime and package management.
- **[Go](https://go.dev/)**: Required for the Bubble Tea development launcher.
- **Java 21+**: Required to run the backend Minecraft servers. Automatically
  downloaded and installed by the backend server script.

## 🛠️ Installation

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/yourusername/mctraveler-portal.git
   cd mctraveler-portal
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Copy the environment config (optional — defaults work out of the box):
   ```bash
   cp .env.example .env
   ```

## ⚙️ Configuration

Environment variables can be set in `.env` (see `.env.example` for details):

| Variable                  | Default   | Description                                             |
| ------------------------- | --------- | ------------------------------------------------------- |
| `PORT`                    | `25565`   | Proxy listen port                                       |
| `PRIMARY_PORT`            | `25566`   | Primary backend server port                             |
| `SECONDARY_PORT`          | `25567`   | Secondary backend server port                           |
| `PROTOCOL_VERSION`        | `773`     | Minecraft protocol version number                       |
| `PROTOCOL_VERSION_STRING` | `1.21.10` | Minecraft version string (for downloads)                |
| `ONLINE_MODE`             | `true`    | Set to `false` to disable Mojang authentication         |
| `PRODUCTION`              | —         | Set to `1` or `NODE_ENV=production` for production mode |

## 🎮 Usage

### The Developer Launcher (Recommended)

The easiest way to run the environment is with the built-in Bubble Tea launcher.
This starts the proxy and two vanilla Minecraft servers (Primary & Secondary) in
a single terminal window.

```bash
bun dev
```

- **Primary Server**: Port `25566`
- **Secondary Server**: Port `25567`
- **Proxy**: Port `25565` (Connect here!)

**Controls:**

- `1`, `2`, `3`: Switch focus between Primary, Secondary, and Proxy logs.
- `i` or `Enter`: Open input bar to send commands to the focused server.
- `↑`/`↓`, `PgUp`/`PgDn`, `Home`/`End`: Navigate focused logs (`End` resumes auto-follow).
- `e`: Export all pane logs to `.mctraveler-runner.log`.
- `c`: Copy the focused pane through OSC52 clipboard support when the terminal supports it.
- `q` or `Ctrl+C`: Gracefully shutdown all servers.

The runner also writes a plain, continually updated `.mctraveler-runner-live.log`
file for easy copy/paste into LLMs and bug reports.

### Manual Usage

If you prefer to run components individually:

- **Start Proxy (Watch Mode)**:
  ```bash
  bun run proxy:watch
  ```
- **Start Primary Backend**:
  ```bash
  bun run minecraft:primary
  ```
- **Start Secondary Backend**:
  ```bash
  bun run minecraft:secondary
  ```

## 🏗️ Architecture

The codebase is organized into four main layers:

### Network (`/network`)

Handles TCP connections, packet framing, encryption, and the core proxying
logic.

- **`proxy.ts`**: Entry point — creates the TCP server and delegates each
  connection to a `ConnectionHandler`.
- **`connection-handler.ts`**: Manages a single client connection through its
  lifecycle phases (`Login` → `Configuration` → `Play`) using a
  `ConnectionState` enum. Handles packet routing, server switching, and the
  dimension-switch trick.
- **`connection-state.ts`**: Defines the `ConnectionState` enum.
- **`packet-handlers.ts`**: Registers and dispatches server→client and
  client→server packet handlers and transforms.
- **`player-tracking.ts`**: Tracks online players, their sockets, and
  dimensions.
- **`packet-routing.ts`**: Parses chat commands, player movement, and
  interactions from client packets.

### Features (`/features`)

Implements game logic. Each feature registers hooks to intercept or modify
behavior. Features are registered in `features/registry.ts`.

| Feature              | Description                              |
| -------------------- | ---------------------------------------- |
| `CoreFeature`        | Registers modules and sets up base hooks |
| `MotdFeature`        | Custom server list MOTD                  |
| `ChatFeature`        | Chat formatting and relay                |
| `AwayFeature`        | AFK detection and status                 |
| `SwitchFeature`      | `/switch` command for server switching   |
| `TabListFeature`     | Custom tab list header/footer            |
| `NotepadFeature`     | In-game notepad via books                |
| `RegionFeature`      | Region-based protection and scoreboard   |
| `TravelPatchFeature` | Profile remapping for migrated players   |
| `AdminFeature`       | Admin-only commands                      |

### Modules (`/modules`)

Provides shared APIs and state that features can consume. Modules are enabled by
features and expose typed `.api` objects.

| Module                     | Description                             |
| -------------------------- | --------------------------------------- |
| `OnlinePlayersModule`      | Tracks connected players, UUID mapping  |
| `TabListModule`            | Global tab list, profile properties     |
| `PersistenceModule`        | Player data persistence to disk         |
| `SyncModule`               | Syncs player data between servers       |
| `ProtectionHooksModule`    | Block/container/sign/interact protection|
| `CommandsInjectionModule`  | Merges custom commands into server tree |
| `HeldItemModule`           | Tracks held item slot                   |
| `PlayerInfoBitflagsModule` | Rewrites player info with Mojang skins  |
| `MessageModule`            | Join/leave message formatting           |
| `ChatModule`               | Chat message handling                   |
| `CommandModule`            | Command registration                    |
| `PlayerInteractionModule`  | Entity interaction tracking             |
| `PlayerPositionModule`     | Position tracking                       |

### Feature API (`/feature-api`)

The hook and command system that connects features/modules to network events.

- **`manager.ts`**: `FeatureHook` enum, `HookMap` type, `registerHook`,
  `executeHook`, `executeHookFirst`. Hooks are type-safe — the `HookMap`
  interface maps each hook to its data and return types.
- **`command.ts`**: `registerCommand`, `syntax` for custom slash commands.
- **`paint.ts`**: Rich text formatting for chat messages.

For detailed architecture docs, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 🧪 Testing

Run the test suite using Bun's test runner:

```bash
bun test
```

## 🔧 Troubleshooting (Local Development)

If you encounter issues while running locally, try the following steps (but **do
not commit these changes**):

### "Disconnected" Error on Proxy Connection

If you keep getting disconnected from the proxy or see socket errors:

1. Set `ONLINE_MODE=false` in your `.env` file.
   - This disables Mojang authentication, which is often required for local
     testing with offline clients or bots.

### Minecraft Version Mismatch / Download Issues

If the server downloads the wrong version or you need to force a specific
version:

1. Set `PROTOCOL_VERSION_STRING` in your `.env` to the desired version (e.g.,
   `1.21.10`).

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed development guidelines, code
style, and setup instructions.

## 📄 License

See [LICENSE](LICENSE) for details.
