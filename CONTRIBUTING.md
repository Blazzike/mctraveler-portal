# Contributing to MCTraveler Portal

Welcome! This guide will help you get started with developing for the MCTraveler
Portal proxy.

## 🚀 Getting Started

### Prerequisites

- **[Bun](https://bun.sh/)** (Runtime & Package Manager)
- **Java 21+** (Automatically downloaded by the launcher if missing, but good to
  have)

### Installation

Clone the repository and install dependencies:

```bash
bun install
```

## 🛠️ Running the Project

The easiest way to run the environment is using the development launcher. This
manages the Proxy and two backend Minecraft servers (Primary & Secondary) in a
single terminal interface.

```bash
bun dev
```

### The Launcher Interface

- **Primary Server (Pane 1)**: Vanilla Minecraft server running on port `25566`.
- **Secondary Server (Pane 2)**: Vanilla Minecraft server running on port
  `25567`.
- **Proxy Server (Pane 3)**: The custom proxy running on port `25565`.

**Controls:**

- Click a pane or press `1`, `2`, or `3` to focus it.
- Press `i` to type a command into the focused server console.
- Press `q` or `Ctrl+C` to safely shut down all servers.

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

## 🏗️ Architecture Overview

This project is a custom Minecraft Proxy written in TypeScript.

- **`network/`**: Core networking logic. `proxy.ts` handles connections,
  `packet-handlers.ts` routes packets.
- **`features/`**: Game logic is isolated into "Features".
  - **Adding a new feature**: Create a file in `features/` (e.g.,
    `MyNewFeature.ts`), implement `onEnable`, and register it in
    `features/registry.ts`.
- **`modules/`**: Shared services (like `OnlinePlayersModule`) that features can
  depend on.

### Connecting

Connect your Minecraft client (Version **1.21.10**) to: `localhost:25565`

## 🎨 Code Style

We use **[Biome](https://biomejs.dev/)** for linting and formatting.

- **Format code**: `bun run format`
- **Lint code**: `bun run lint`
- **Check everything**: `bun run check`
