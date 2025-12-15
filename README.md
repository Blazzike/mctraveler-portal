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
- **Development Launcher**: Integrated terminal dashboard (TUI) to manage the
  proxy and backend servers simultaneously.
- **Hot Reloading**: The proxy supports watch mode for rapid development.

## 📋 Prerequisites

- **[Bun](https://bun.sh/)**: Required for the runtime and package management.
- **Java 21+**: Required to run the backend Minecraft servers. (Should be
  automatically downloaded and installed)

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

## 🎮 Usage

### The Developer Launcher (Recommended)

The easiest way to run the environment is with the built-in launcher. This
starts the proxy and two vanilla Minecraft servers (Primary & Secondary) in a
single terminal window.

```bash
bun dev
```

- **Primary Server**: Port `25566`
- **Secondary Server**: Port `25567`
- **Proxy**: Port `25565` (Connect here!)

**Controls:**

- `1`, `2`, `3`: Switch focus between Primary, Secondary, and Proxy logs.
- `i`: Open input bar to send commands to the focused server.
- `q`: Gracefully shutdown all servers.

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

The codebase is organized into three main layers:

1. **Network (`/network`)**: Handles TCP connections, packet framing,
   encryption, and the core proxying logic.
2. **Features (`/features`)**: Implements game logic. Features register "hooks"
   (e.g., `PlayerChat`, `PlayerMove`) to intercept or modify behavior.
   - Example: `MotdFeature` intercepts the server list ping to show a custom
     MOTD.
3. **Modules (`/modules`)**: Provides shared APIs and state that Features can
   consume.
   - Example: `OnlinePlayersModule` tracks who is connected across the network.

## 🧪 Testing

Run the test suite using Bun's test runner:

```bash
bun test
```

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed development guidelines, code
style, and setup instructions.

## 📄 License

To be added ASAP
