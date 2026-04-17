import net from 'node:net';
import { kIsOnlineMode } from '@/config';
import { handshakePacket } from '@/defined-packets.gen';
import { anonymousNbt } from '@/encoding/data-buffer';
import { executeHookFirst, FeatureHook, registerHook } from '@/feature-api/manager';
import { generateServerKeyPair, type ServerKeyPair } from '@/network/encryption';
import { ConnectionHandler } from '@/network/connection-handler';
import { createPacketQueue } from '@/network/packet-queue';
import {
  broadcastPlayerJoin,
  broadcastPlayerLeave,
  getOnlinePlayers,
  getPlayerSocket,
  getServerSocket,
  type OnlinePlayer,
} from '@/network/player-tracking';
import type { StatusResponse } from '@/network/types';
import { log } from '@/logging';

// Re-export for backward compatibility — consumers import these from @/network/proxy
export { broadcastPlayerJoin, broadcastPlayerLeave, getOnlinePlayers, getPlayerSocket, getServerSocket, type OnlinePlayer } from '@/network/player-tracking';

registerHook(FeatureHook.SystemChat, (data: { nbt: Buffer; isActionBar: boolean }) => {
  if (data.isActionBar) {
    return null;
  }

  try {
    const decoded = anonymousNbt.read(data.nbt);

    if (decoded.translate === 'multiplayer.player.joined') {
      return false;
    }

    if (decoded.translate === 'multiplayer.player.left') {
      return false;
    }
  } catch {
    // NBT decode failed - not a translatable message
    return null;
  }

  return null;
});

// Generate RSA key pair once for the server
let serverKeyPair: ServerKeyPair | null = null;

export const playerSwitcher = new Map<string, (port: number) => Promise<void>>();

export async function switchPlayerServer(uuid: string, port: number) {
  const switcher = playerSwitcher.get(uuid);
  if (switcher) {
    await switcher(port);
  }
}

export function createProxy(params: { target: number; port: number; onStatusRequest: () => StatusResponse }) {
  // Generate key pair if not already generated and online mode is enabled
  if (kIsOnlineMode && !serverKeyPair) {
    serverKeyPair = generateServerKeyPair();
  }

  const server = net.createServer(async (clientSocket) => {
    // Set up error handlers immediately to prevent unhandled error events
    clientSocket.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ETIMEDOUT' || e.code === 'ECONNRESET' || e.code === 'EPIPE') {
        // Common network errors, no need to log
        return;
      }
      log.for('Proxy').error('client socket error: %s', e.message);
    });

    try {
      const clientPacketQueue = createPacketQueue(clientSocket);
      const handshake = await clientPacketQueue.expect(handshakePacket);

      const handler = new ConnectionHandler(
        clientSocket,
        clientPacketQueue,
        serverKeyPair,
        params.target,
        params.onStatusRequest,
        playerSwitcher,
      );

      await handler.run(handshake);
    } catch (e) {
      log.for('Proxy').error('Error in client connection handler: %s', e);
      clientSocket.end();
    }
  });

  server.listen(params.port);

  return server;
}
