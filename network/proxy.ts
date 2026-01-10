import { createHash } from 'node:crypto';
import net from 'node:net';
import { kIsOnlineMode, kPrimaryPort, kProtocolVersion, kSecondaryPort } from '@/config';
import {
  chatCommandPacket,
  chatMessagePacket,
  gameStateChangePacket,
  handshakePacket,
  joinGamePacket,
  playerBlockDigPacket,
  playerBlockPlacePacket,
  playerPositionLookPacket,
  playerPositionPacket,
  playerUseItemPacket,
  respawnPacket,
  systemChatPacket,
  useEntityPacket,
} from '@/defined-packets.gen';
import { anonymousNbt, byte, double, string, varInt } from '@/encoding/data-buffer';
import { executeCommand } from '@/feature-api/command';
import { executeHook, executeHookFirst, FeatureHook, registerHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import { notifyPlayerJoin, notifyPlayerLeave } from '@/module-api/module';
import PersistenceModule from '@/modules/PersistenceModule';
import SyncModule from '@/modules/SyncModule';
import { readPacketFields, writePacket } from '@/network/defined-packet';
import { enableEncryption, generateServerKeyPair, rsaDecrypt, type ServerKeyPair } from '@/network/encryption';
import { handleProxyQuery } from '@/network/handle-proxy-query';
import { createEncryptionRequest, createLoginDisconnect, encryptionResponsePacket } from '@/network/login-packets';
import { generateServerId, generateVerifyToken, verifyMojangSession } from '@/network/mojang-session';
import { handleClientToServerPacket, handleServerToClientPacket, type ProxyPlayer, transformServerToClientPacket } from '@/network/packet-handlers';
import { createPacketQueue } from '@/network/packet-queue';
import type { StatusResponse } from '@/network/types';
import { forwardPacket, safeWrite } from '@/network/util';

function generateOfflineUUID(username: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${username}`).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x30;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function broadcastPlayerJoin(uuid: string, username: string, excludeUuid?: string) {
  const props = executeHookFirst(FeatureHook.GetProfileProperties, { uuid }) || [];
  const packet = executeHookFirst<Buffer>(FeatureHook.BuildPlayerInfoPacket, { uuid, username, props });

  const onlinePlayers = executeHookFirst<OnlinePlayer[]>(FeatureHook.GetOnlinePlayers) || [];
  onlinePlayers.forEach((player) => {
    if (excludeUuid && player.uuid === excludeUuid) return;
    const socket = playerSockets.get(player);
    if (socket && packet && (socket.readyState === 'open' || socket.readyState === 'writeOnly')) {
      try {
        socket.write(packet);
      } catch {
        // Socket closed, ignore
      }
    }
  });
}

export function broadcastPlayerLeave(uuid: string) {
  executeHook(FeatureHook.RemovePlayerFromTabList, { uuid });

  const packet = executeHookFirst<Buffer>(FeatureHook.BuildPlayerRemovePacket, { uuid });

  const onlinePlayers = executeHookFirst<OnlinePlayer[]>(FeatureHook.GetOnlinePlayers) || [];
  onlinePlayers.forEach((player) => {
    const socket = playerSockets.get(player);
    if (socket && packet && (socket.readyState === 'open' || socket.readyState === 'writeOnly')) {
      try {
        socket.write(packet);
      } catch {
        // Socket closed, ignore
      }
    }
  });
}

function sendGlobalTabList(targetPlayer: any) {
  const players = executeHookFirst<OnlinePlayer[]>(FeatureHook.GetOnlinePlayers) || [];
  if (players.length === 0) return;

  for (const player of players) {
    const props = executeHookFirst(FeatureHook.GetProfileProperties, { uuid: player.uuid }) || [];
    const packet = executeHookFirst<Buffer>(FeatureHook.BuildPlayerInfoPacket, { uuid: player.uuid, username: player.username, props });

    const socket = getPlayerSocket(targetPlayer);
    if (socket && packet && (socket.readyState === 'open' || socket.readyState === 'writeOnly')) {
      try {
        socket.write(packet);
      } catch {
        // Socket closed, ignore
      }
    }
  }
}

function sendTabListHeaderFooter(targetPlayer: any) {
  const packet = executeHookFirst<Buffer>(FeatureHook.BuildTabListHeaderFooterPacket);
  if (packet) {
    const socket = getPlayerSocket(targetPlayer);
    if (socket && (socket.readyState === 'open' || socket.readyState === 'writeOnly')) {
      try {
        socket.write(packet);
      } catch {
        // Socket closed, ignore
      }
    }
  }
}

const onlinePlayers = new Map<string, OnlinePlayer>();
const playerSockets = new WeakMap<OnlinePlayer, net.Socket>();
const serverSockets = new WeakMap<OnlinePlayer, net.Socket>();
const playerHeldSlots = new WeakMap<OnlinePlayer, number>();
const playerPositions = new WeakMap<OnlinePlayer, { x: number; y: number; z: number }>();

interface OnlinePlayer {
  uuid: string;
  username: string;
  offlineUuid: string;
  currentServerPort: number;
  currentDimension: string;
  loginTime: number;
  sendMessage: (message: any) => void;
  chat: (message: string) => void;
  switchServer: (port: number) => Promise<void>;
  get id(): string;
  get name(): string;
  get isOnline(): boolean;
}

function trackPlayerLogin(
  uuid: string,
  username: string,
  socket: net.Socket,
  serverPort: number,
  isPremium: boolean,
  offlineUuid?: string
): OnlinePlayer {
  const playerOfflineUuid = offlineUuid || generateOfflineUUID(username);

  // Create player in OnlinePlayersModule
  const player = executeHookFirst<OnlinePlayer>(FeatureHook.TrackPlayerLogin, {
    uuid,
    username,
    socket,
    serverPort,
    isPremium,
    offlineUuid: playerOfflineUuid,
  });

  if (!player) {
    // Should not happen if OnlinePlayersModule is enabled
    throw new Error('Failed to track player login');
  }

  // Store in local maps for proxy-specific lookups
  onlinePlayers.set(uuid, player);
  playerSockets.set(player, socket);

  // Notify modules
  notifyPlayerJoin(player);

  // Set up server switcher callback
  executeHook(FeatureHook.SetServerSwitcher, {
    uuid,
    switcher: async (port: number) => {
      const switcher = playerSwitcher.get(uuid);
      if (switcher) {
        await switcher(port);
      }
    },
  });

  return player;
}

function trackConnectionClose(uuid: string): void {
  const player = onlinePlayers.get(uuid);
  if (player) {
    console.log(`[- player] ${player.username}`);
    // Remove any pending join message for this player (in case they failed to fully connect)
    const pendingIndex = pendingJoinMessages.indexOf(player.username);
    if (pendingIndex !== -1) {
      pendingJoinMessages.splice(pendingIndex, 1);
    }
    onlinePlayers.delete(uuid);
    executeHook(FeatureHook.ClearServerSwitcher, { uuid });
    executeHook(FeatureHook.PlayerLeave, { player });
    executeHook(FeatureHook.TrackPlayerLogout, { uuid });
    notifyPlayerLeave(player);
    broadcastPlayerLeave(uuid);
    broadcastLeaveMessage(player.username);
  }
}

function trackServerSocket(player: OnlinePlayer, socket: net.Socket): void {
  serverSockets.set(player, socket);
}

function _trackHeldSlotChange(player: OnlinePlayer, slot: number): void {
  playerHeldSlots.set(player, slot);
}

function _clearPlayerTracking(player: OnlinePlayer): void {
  playerHeldSlots.delete(player);
}

function setPlayerDimensionByName(player: OnlinePlayer, dimension: string): void {
  player.currentDimension = dimension;
}

function parsePlayerMovement(player: OnlinePlayer, packetId: number, packetData: Buffer): void {
  if (packetId === playerPositionPacket.id || packetId === playerPositionLookPacket.id) {
    const x = double.read(packetData);
    const y = double.read(packetData.subarray(8));
    const z = double.read(packetData.subarray(16));
    const oldPos = playerPositions.get(player);
    const newPos = { x, y, z };
    if (!oldPos || oldPos.x !== x || oldPos.y !== y || oldPos.z !== z) {
      executeHook(FeatureHook.PlayerMove, { player, from: oldPos ?? newPos, to: newPos });
    }
    playerPositions.set(player, newPos);
  }
}

function parsePlayerInteraction(player: OnlinePlayer, packetId: number, packetData: Buffer): void {
  if (packetId === playerBlockDigPacket.id) {
    executeHook(FeatureHook.PlayerBlockBreak, { player, packetData });
  } else if (packetId === playerBlockPlacePacket.id) {
    executeHook(FeatureHook.PlayerBlockPlace, { player, packetData });
  } else if (packetId === playerUseItemPacket.id) {
    executeHook(FeatureHook.PlayerUseItem, { player, packetData });
  } else if (packetId === useEntityPacket.id) {
    executeHook(FeatureHook.PlayerInteract, { player, packetData });
  }
}

function parsePlayerMessage(player: OnlinePlayer, packetId: number, packetData: Buffer): boolean {
  if (packetId === chatCommandPacket.id) {
    try {
      const command = string.read(packetData);
      executeHook(FeatureHook.PlayerCommand, { player, command });
      const result = executeCommand(player, command);
      if (result) {
        // Don't try to send Promises as messages (async commands handle their own messaging)
        if (result !== true && !(result instanceof Promise)) {
          player.sendMessage(result);
        }
        return true;
      }
    } catch {}
  }

  if (packetId === chatMessagePacket.id) {
    try {
      const message = string.read(packetData);
      const results = executeHook(FeatureHook.PlayerChat, { player, message });
      const formattedMessage = results.find((r) => r);
      if (formattedMessage) {
        for (const p of onlinePlayers.values()) {
          p.sendMessage(formattedMessage);
        }
        return true;
      }
    } catch {}
  }

  return false;
}

const pendingJoinMessages: string[] = [];

function broadcastJoinMessage(player: OnlinePlayer, delayUntilPlay?: boolean): void {
  if (delayUntilPlay) {
    pendingJoinMessages.push(player.username);
    return;
  }

  const results = executeHook(FeatureHook.PlayerJoinedMessage, { username: player.username });
  const message = results.find((r) => r);
  if (message) {
    for (const p of onlinePlayers.values()) {
      p.sendMessage(message);
    }
  }
}

function flushPendingJoinMessages(): void {
  while (pendingJoinMessages.length > 0) {
    const username = pendingJoinMessages.shift()!;
    const results = executeHook(FeatureHook.PlayerJoinedMessage, { username });
    const message = results.find((r) => r);
    if (message) {
      for (const player of onlinePlayers.values()) {
        player.sendMessage(message);
      }
    }
  }
}

function broadcastLeaveMessage(username: string): void {
  const results = executeHook(FeatureHook.PlayerLeftMessage, { username });
  const message = results.find((r) => r);
  if (message) {
    for (const player of onlinePlayers.values()) {
      player.sendMessage(message);
    }
  }
}

function getPlayerLastServerName(uuid: string): 'primary' | 'secondary' | undefined {
  return PersistenceModule.api.getPlayerLastServerName(uuid);
}

function setPlayerLastServerName(uuid: string, server: 'primary' | 'secondary'): void {
  PersistenceModule.api.setPlayerLastServerName(uuid, server);
}

async function syncPlayerData(uuid: string, fromPort: number, toPort: number): Promise<void> {
  await SyncModule.api.syncPlayerData(uuid, fromPort, toPort);
}

function parseLoginStart(packetData: Buffer): { username: string; uuid: string | null } {
  const username = string.read(packetData);
  let uuid: string | null = null;
  try {
    const usernameLength = varInt.readWithBytesCount(packetData);
    const offset = usernameLength.bytesRead + usernameLength.value;
    const hasUuid = packetData[offset] === 1;
    if (hasUuid) {
      const uuidBytes = packetData.subarray(offset + 1, offset + 17);
      uuid = [
        uuidBytes.subarray(0, 4).toString('hex'),
        uuidBytes.subarray(4, 6).toString('hex'),
        uuidBytes.subarray(6, 8).toString('hex'),
        uuidBytes.subarray(8, 10).toString('hex'),
        uuidBytes.subarray(10, 16).toString('hex'),
      ].join('-');
    }
  } catch {}
  return { username, uuid };
}

function parseLoginSuccess(packetData: Buffer): { uuid: string; username: string } {
  const uuidBytes = packetData.subarray(0, 16);
  const uuid = [
    uuidBytes.subarray(0, 4).toString('hex'),
    uuidBytes.subarray(4, 6).toString('hex'),
    uuidBytes.subarray(6, 8).toString('hex'),
    uuidBytes.subarray(8, 10).toString('hex'),
    uuidBytes.subarray(10, 16).toString('hex'),
  ].join('-');
  const username = string.read(packetData.subarray(16));
  return { uuid, username };
}

function resolvePort(name?: 'primary' | 'secondary'): number {
  return name === 'secondary' ? kSecondaryPort : kPrimaryPort;
}

function formatUuidWithDashes(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function _extractUsernameFromWith(withArray: any[]): string | null {
  if (!Array.isArray(withArray) || withArray.length === 0) {
    return null;
  }

  const firstElement = withArray[0];
  if (typeof firstElement === 'object' && firstElement.text) {
    return firstElement.text;
  }

  if (typeof firstElement === 'string') {
    return firstElement;
  }

  return null;
}

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
    return null;
  }

  return null;
});

enum HandshakePacketState {
  STATUS = 1,
  LOGIN = 2,
}

// Generate RSA key pair once for the server
let serverKeyPair: ServerKeyPair | null = null;

export const playerSwitcher = new Map<string, (port: number) => Promise<void>>();

export async function switchPlayerServer(uuid: string, port: number) {
  const switcher = playerSwitcher.get(uuid);
  if (switcher) {
    await switcher(port);
  }
}

export function getOnlinePlayers(): OnlinePlayer[] {
  return Array.from(onlinePlayers.values());
}

export function getPlayerSocket(player: OnlinePlayer): net.Socket | undefined {
  // Try direct lookup first
  const socket = playerSockets.get(player);
  if (socket) return socket;

  // Fall back to UUID-based lookup (for players from OnlinePlayersModule)
  const localPlayer = onlinePlayers.get(player.uuid);
  return localPlayer ? playerSockets.get(localPlayer) : undefined;
}

export function getServerSocket(player: OnlinePlayer): net.Socket | undefined {
  return serverSockets.get(player);
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
      console.error('client socket error:', e.message);
    });

    try {
      const clientPacketQueue = createPacketQueue(clientSocket);
      const handshake = await clientPacketQueue.expect(handshakePacket);
      if (handshake.nextState === HandshakePacketState.STATUS) {
        await handleProxyQuery(clientSocket, clientPacketQueue, params.onStatusRequest);

        return;
      }

      let serverSocket: net.Socket;
      let isLoginState = handshake.nextState === HandshakePacketState.LOGIN;
      let isConfigurationState = false;
      let trackedPlayer: any = null;
      let isPlayState = false;
      let isSwitching = false;
      let currentBackendPort = params.target;
      const clientIp = clientSocket.remoteAddress?.replace('::ffff:', '');

      let pendingLogin: { username: string; verifyToken: Buffer } | null = null;
      let pendingClientLogin: { username: string; uuid: string; sharedSecret: Buffer; profile: any; isRemapped: boolean } | null = null;

      const connectToBackend = async (targetPort: number, isSwitch: boolean = false) => {
        if (isSwitch && trackedPlayer) {
          // Remove from global tab list before switching to avoid duplicates
          executeHook(FeatureHook.RemovePlayerFromTabList, { uuid: trackedPlayer.uuid });

          // Clear protection state so it can be re-evaluated after switch
          executeHook(FeatureHook.ClearPlayerProtection, { player: trackedPlayer });

          if (serverSocket) {
            serverSocket.removeAllListeners();
            serverSocket.end();
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
          await syncPlayerData(trackedPlayer.offlineUuid, currentBackendPort, targetPort);
        } else {
          if (serverSocket) {
            serverSocket.removeAllListeners();
            serverSocket.end();
          }
        }

        if (isSwitch) {
          isSwitching = true;
        }

        return new Promise<void>((resolve, reject) => {
          serverSocket = net.connect(targetPort, 'localhost');

          // Handle connection errors (e.g., server not running)
          serverSocket.once('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ECONNREFUSED') {
              console.log(`[Proxy] Backend server on port ${targetPort} not available`);
              const disconnectPacket = createLoginDisconnect(p.error`Server is starting up. Please try again in a moment.`);
              safeWrite(clientSocket, disconnectPacket);
              clientSocket.end();
              reject(err);
              return;
            }
            console.error('Connection error:', err);
            clientSocket.end();
            reject(err);
          });

          serverSocket.once('connect', () => {
            const serverPacketQueue = createPacketQueue(serverSocket);

            if (isSwitch) {
              // Handshake for switch
              const handshakeData = {
                protocolVersion: kProtocolVersion, // Use config version
                serverHost: 'localhost',
                serverPort: targetPort,
                nextState: 2, // LOGIN
              };
              safeWrite(serverSocket, writePacket(handshakePacket, handshakeData));

              // Login Start for switch
              if (trackedPlayer) {
                const loginStartPacketId = varInt(0x00);
                const loginStartUsername = string(trackedPlayer.username);
                const loginStartUuid = Buffer.from(trackedPlayer.uuid.replace(/-/g, ''), 'hex');
                const loginStartContent = Buffer.concat([loginStartPacketId, loginStartUsername, loginStartUuid]);
                const backendLoginStart = Buffer.concat([varInt(loginStartContent.length), loginStartContent]);
                safeWrite(serverSocket, backendLoginStart);
              }
            } else {
              // Initial handshake
              safeWrite(serverSocket, writePacket(handshakePacket, handshake));
            }

            serverPacketQueue.onPacket((packet) => {
              // Handle Switch Logic
              if (isSwitching) {
                // We are waiting for Login Success (0x02) from backend
                if (packet.packetId === 0x02) {
                  const loginData = parseLoginSuccess(packet.packetData);
                  if (loginData && trackedPlayer) {
                    // Update tracking - use existing UUID to avoid duplicates from offline-mode backends
                    const existingUuid = trackedPlayer.uuid;
                    const existingUsername = trackedPlayer.username;
                    const oldPlayer = trackedPlayer;

                    // Clean up old player references before creating new one
                    playerSockets.delete(oldPlayer);
                    serverSockets.delete(oldPlayer);

                    trackedPlayer = trackPlayerLogin(existingUuid, existingUsername, clientSocket, targetPort, true);
                    trackServerSocket(trackedPlayer, serverSocket);

                    setPlayerLastServerName(trackedPlayer.uuid, targetPort === kSecondaryPort ? 'secondary' : 'primary');

                    // Transfer cache
                    trackedPlayer.cachedClientSettings = oldPlayer.cachedClientSettings;
                    trackedPlayer.cachedKnownPacks = oldPlayer.cachedKnownPacks;

                    // Re-register switcher with correct UUID
                    playerSwitcher.set(existingUuid, (port) => connectToBackend(port, true));

                    // Send Login Acknowledged (0x03) to backend to enter Config state
                    const loginAckId = varInt(0x03);
                    const loginAckPacket = Buffer.concat([varInt(loginAckId.length), loginAckId]);
                    safeWrite(serverSocket, loginAckPacket);

                    // Replay cached config packets
                    if (trackedPlayer) {
                      if (trackedPlayer.cachedClientSettings) {
                        const pid = varInt(0x00);
                        const pcontent = Buffer.concat([pid, trackedPlayer.cachedClientSettings]);
                        safeWrite(serverSocket, Buffer.concat([varInt(pcontent.length), pcontent]));
                      }
                      if (trackedPlayer.cachedKnownPacks) {
                        const pid = varInt(0x07);
                        const pcontent = Buffer.concat([pid, trackedPlayer.cachedKnownPacks]);
                        safeWrite(serverSocket, Buffer.concat([varInt(pcontent.length), pcontent]));
                      }
                    }
                  }
                  return;
                }

                // Handle Disconnect (0x00 in Login, 0x02 in Config?)
                // In Login state, 0x00 is Disconnect.
                // In Config state, 0x02 is Disconnect.
                // Since we handle transition implicitly, we might see either.

                if (packet.packetId === 0x00) {
                  console.log('Switch: Received Disconnect (0x00)');
                  // Log the reason if possible?
                  return;
                }

                // We are now in Config state (or Play if older, but 1.21 is Config)
                // We need to handle Config packets (Registry Data, etc.)
                // And Finish Config (0x03 Clientbound)

                if (packet.packetId === 0x03) {
                  // Finish Configuration (Clientbound)
                  // Reply with Finish Configuration (Serverbound 0x03)
                  const finishConfigId = varInt(0x03); // 0x03 in Config state
                  const _finishConfigContent = Buffer.alloc(0); // Empty
                  const finishConfigPacket = Buffer.concat([varInt(finishConfigId.length), finishConfigId]);

                  safeWrite(serverSocket, finishConfigPacket);

                  // Now we transition to Play state, but keep isSwitching true
                  // to intercept the Join Game packet and apply dimension switch trick
                  // isSwitching will be set to false after handling Join Game

                  // Update current port in tracker
                  currentBackendPort = targetPort;
                  if (trackedPlayer) {
                    trackedPlayer.currentServerPort = currentBackendPort;
                  }
                  return;
                }

                // If we receive Keep Alive (0x04) in Config, we should reply.
                if (packet.packetId === 0x04) {
                  // Reply with same ID
                  const keepAliveId = packet.packetData; // Raw data
                  const packetId = varInt(0x04); // Serverbound Keep Alive is 0x04
                  const packetContent = Buffer.concat([packetId, keepAliveId]);
                  const fullPacket = Buffer.concat([varInt(packetContent.length), packetContent]);
                  safeWrite(serverSocket, fullPacket);
                  return;
                }

                // Handle Join Game packet - apply dimension switch trick
                if (packet.packetId === joinGamePacket.id) {
                  try {
                    // Manually parse Join Game packet to extract worldState (SpawnInfo)
                    // Structure: entityId (i32) + isHardcore (bool) + worldNames (varint array) +
                    //            maxPlayers (varint) + viewDistance (varint) + simulationDistance (varint) +
                    //            reducedDebugInfo (bool) + enableRespawnScreen (bool) + doLimitedCrafting (bool) +
                    //            worldState (SpawnInfo) + enforcesSecureChat (bool)

                    let offset = 0;
                    const data = packet.packetData;

                    // Skip entityId (4 bytes)
                    offset += 4;

                    // Skip isHardcore (1 byte)
                    offset += 1;

                    // Skip worldNames array (varint count + strings)
                    let arrayCount = 0;
                    let shift = 0;
                    let b = 0;
                    do {
                      b = data[offset++] ?? 0;
                      arrayCount |= (b & 0x7f) << shift;
                      shift += 7;
                    } while ((b & 0x80) !== 0);

                    // Skip each string in the array
                    for (let i = 0; i < arrayCount; i++) {
                      let strLen = 0;
                      shift = 0;
                      do {
                        b = data[offset++] ?? 0;
                        strLen |= (b & 0x7f) << shift;
                        shift += 7;
                      } while ((b & 0x80) !== 0);
                      offset += strLen;
                    }

                    // Skip maxPlayers, viewDistance, simulationDistance (3 varints)
                    for (let i = 0; i < 3; i++) {
                      do {
                        b = data[offset++] ?? 0;
                      } while ((b & 0x80) !== 0);
                    }

                    // Skip reducedDebugInfo, enableRespawnScreen, doLimitedCrafting (3 bools)
                    offset += 3;

                    // Now we're at worldState (SpawnInfo)
                    const worldStateStart = offset;

                    // Read the dimension ID (first varint of SpawnInfo)
                    let dimensionId = 0;
                    shift = 0;
                    const dimStart = offset;
                    do {
                      b = data[offset++] ?? 0;
                      dimensionId |= (b & 0x7f) << shift;
                      shift += 7;
                    } while ((b & 0x80) !== 0);
                    const dimEnd = offset;

                    // Extract the rest of worldState (we need to find where it ends)
                    // For simplicity, we'll extract everything from worldStateStart to the end minus 1 byte (enforcesSecureChat)
                    const worldStateBuffer = data.subarray(worldStateStart, data.length - 1);

                    // Create alternate dimension: if overworld (0), use nether (1), else use overworld (0)
                    // Note: dimension is a VarInt index into the dimension registry.
                    // -1 is invalid. We assume standard registry has at least 2 entries.
                    const alternateDimensionId = dimensionId === 0 ? 1 : 0;

                    // Create a modified worldState with alternate dimension
                    const alternateDimensionVarInt = varInt(alternateDimensionId);
                    const restOfWorldState = worldStateBuffer.subarray(dimEnd - dimStart);
                    const alternateWorldState = Buffer.concat([alternateDimensionVarInt, restOfWorldState]);

                    // Strategy: Join Game (Alternate) -> Respawn (Correct)
                    // This forces the client to initialize in a different dimension (clearing chunks)
                    // and then immediately switch to the correct one.

                    // 1. Construct Join Game with Alternate Dimension
                    const preSpawnInfo = data.subarray(0, worldStateStart);
                    const postSpawnInfo = data.subarray(data.length - 1); // enforcesSecureChat
                    const newJoinGameData = Buffer.concat([preSpawnInfo, alternateWorldState, postSpawnInfo]);

                    // Prepend the packet ID and length
                    const joinGameId = varInt(joinGamePacket.id);
                    const joinGameFullPacket = Buffer.concat([varInt(joinGameId.length + newJoinGameData.length), joinGameId, newJoinGameData]);

                    // 2. Construct Respawn with Correct Dimension (Original)
                    // We use the original worldStateBuffer which has the correct dimension
                    const respawnPacketData = writePacket(respawnPacket, {
                      worldState: worldStateBuffer,
                      copyMetadata: byte(0x00), // Don't copy metadata
                    });

                    console.log(`[Switch] Applied dimension trick (v2): Join(Alt ${alternateDimensionId}) -> Respawn(Original ${dimensionId})`);

                    // Send Join Game (Alt)
                    safeWrite(clientSocket, joinGameFullPacket);

                    // Send Respawn (Correct)
                    safeWrite(clientSocket, respawnPacketData);

                    // Track dimension - read dimension name from worldState
                    if (trackedPlayer) {
                      let dimNameOffset = dimEnd - worldStateStart;
                      let dimNameLen = 0;
                      let dimShift = 0;
                      let dimB = 0;
                      do {
                        dimB = worldStateBuffer[dimNameOffset++] ?? 0;
                        dimNameLen |= (dimB & 0x7f) << dimShift;
                        dimShift += 7;
                      } while ((dimB & 0x80) !== 0);
                      const dimensionName = worldStateBuffer.subarray(dimNameOffset, dimNameOffset + dimNameLen).toString('utf8');
                      setPlayerDimensionByName(trackedPlayer, dimensionName);

                      // Also track gamemode from SpawnInfo: hashedSeed (8 bytes) + gamemode (1 byte)
                      const gameModeOffset = dimNameOffset + dimNameLen + 8;
                      if (gameModeOffset < worldStateBuffer.length) {
                        const gameMode = worldStateBuffer.readInt8(gameModeOffset);
                        executeHook(FeatureHook.PlayerGameModeChange, { player: trackedPlayer, gameMode });
                      }
                    }

                    // Switch complete - refresh tablist for switching player and broadcast to others
                    if (trackedPlayer) {
                      // Send the player their own info first (so they see themselves)
                      const selfProps = executeHookFirst(FeatureHook.GetProfileProperties, { uuid: trackedPlayer.uuid }) || [];
                      const selfPacket = executeHookFirst<Buffer>(FeatureHook.BuildPlayerInfoPacket, {
                        uuid: trackedPlayer.uuid,
                        username: trackedPlayer.username,
                        props: selfProps,
                      });
                      if (selfPacket) {
                        safeWrite(clientSocket, selfPacket);
                      }

                      sendGlobalTabList(trackedPlayer);
                      sendTabListHeaderFooter(trackedPlayer);
                      // Broadcast this player to all OTHER players (they may have stale data)
                      broadcastPlayerJoin(trackedPlayer.uuid, trackedPlayer.username, trackedPlayer.uuid);
                    }
                    isSwitching = false;
                  } catch (error) {
                    console.error('[Switch] Failed to apply dimension trick:', error);
                    // Fallback: just forward the packet
                    forwardPacket(clientSocket, packet);
                    isSwitching = false;
                  }
                  return;
                }

                return;
              }

              // Filter Backend Join/Leave Messages
              if (packet.packetId === systemChatPacket.id && isPlayState) {
                try {
                  const nbtData = packet.packetData.subarray(0, -1); // Remove overlay byte at end
                  const decoded = anonymousNbt.read(nbtData);
                  if (decoded.translate === 'multiplayer.player.joined' || decoded.translate === 'multiplayer.player.left') {
                    console.log(`[Chat] Suppressing backend join/leave message: ${decoded.translate}`);
                    return; // Suppress backend join/leave messages
                  }
                } catch (e) {
                  // Debug: see what's failing
                  console.log(`[Chat] Failed to parse system chat: ${e}`);
                }
              }

              // Normal packet handling
              if (isLoginState) {
                const loginData = parseLoginSuccess(packet.packetData);
                if (loginData) {
                  if (kIsOnlineMode && pendingClientLogin) {
                    const props = pendingClientLogin.profile.properties || [];
                    console.log(`[Skin] Storing ${props.length} properties for UUID ${pendingClientLogin.uuid}`);
                    executeHook(FeatureHook.SetProfileProperties, { uuid: pendingClientLogin.uuid, props });

                    trackedPlayer = trackPlayerLogin(pendingClientLogin.uuid, pendingClientLogin.username, clientSocket, currentBackendPort, true);
                    trackServerSocket(trackedPlayer, serverSocket);

                    setPlayerLastServerName(trackedPlayer.uuid, currentBackendPort === kSecondaryPort ? 'secondary' : 'primary');

                    // Register switcher
                    playerSwitcher.set(pendingClientLogin.uuid, (port) => connectToBackend(port, true));

                    const packetId = varInt(0x02);
                    const uuidBytes = Buffer.from(pendingClientLogin.uuid.replace(/-/g, ''), 'hex');
                    const usernameBytes = string(pendingClientLogin.username);

                    const properties = pendingClientLogin.profile.properties || [];
                    const propertiesCount = varInt(properties.length);
                    const propertiesBuffers = properties.map((prop: any) => {
                      const nameBuffer = string(prop.name);
                      const valueBuffer = string(prop.value);
                      if (prop.signature) {
                        const hasSignature = Buffer.from([0x01]);
                        const signatureBuffer = string(prop.signature);
                        return Buffer.concat([nameBuffer, valueBuffer, hasSignature, signatureBuffer]);
                      } else {
                        const hasSignature = Buffer.from([0x00]);
                        return Buffer.concat([nameBuffer, valueBuffer, hasSignature]);
                      }
                    });
                    const propertiesData = propertiesBuffers.length > 0 ? Buffer.concat(propertiesBuffers) : Buffer.alloc(0);

                    const packetContent = Buffer.concat([packetId, uuidBytes, usernameBytes, propertiesCount, propertiesData]);

                    const loginSuccess = Buffer.concat([varInt(packetContent.length), packetContent]);

                    safeWrite(clientSocket, loginSuccess);

                    // Enter configuration state - forward all packets until play state
                    isLoginState = false;
                    isConfigurationState = true;
                    pendingClientLogin = null;

                    broadcastJoinMessage(trackedPlayer, true);

                    // Don't forward backend Login Success to client
                    return;
                  } else {
                    // Offline mode - backend Login Success goes to client
                    trackedPlayer = trackPlayerLogin(loginData.uuid, loginData.username, clientSocket, currentBackendPort, false);
                    trackServerSocket(trackedPlayer, serverSocket);

                    setPlayerLastServerName(trackedPlayer.uuid, currentBackendPort === kSecondaryPort ? 'secondary' : 'primary');

                    // Register switcher
                    playerSwitcher.set(loginData.uuid, (port) => connectToBackend(port, true));

                    isLoginState = false;
                    isConfigurationState = true;
                    // Forward the backend Login Success to client
                    forwardPacket(clientSocket, packet);
                    broadcastJoinMessage(trackedPlayer, true);
                    return;
                  }
                }
              }

              // Handle configuration state packets
              if (isConfigurationState) {
                // Finish Configuration packet (0x03) - transition to play state
                if (packet.packetId === 0x03) {
                  isConfigurationState = false;
                  isPlayState = true;
                  forwardPacket(clientSocket, packet);
                  return;
                }
              }

              // Handle server→client packet handlers and transforms
              if (isPlayState && trackedPlayer) {
                const proxyPlayer: ProxyPlayer = {
                  uuid: trackedPlayer.uuid,
                  username: trackedPlayer.username,
                  clientSocket,
                  serverSocket: serverSocket!,
                  serverPort: currentBackendPort,
                  isPremium: trackedPlayer.isOnlineMode,
                  offlineUuid: trackedPlayer.offlineUuid,
                };

                // Run handlers first (may intercept and block)
                if (handleServerToClientPacket(proxyPlayer, packet.packetId, packet.packetData)) {
                  return;
                }

                // Run transforms (may modify packet data)
                const transformedData = transformServerToClientPacket(proxyPlayer, packet.packetId, packet.packetData);
                if (transformedData === null) {
                  return; // Transform says to drop packet
                }
                if (transformedData !== packet.packetData) {
                  // Packet was transformed, send the new version
                  const packetIdBuf = varInt(packet.packetId);
                  const packetContent = Buffer.concat([packetIdBuf, transformedData]);
                  const fullPacket = Buffer.concat([varInt(packetContent.length), packetContent]);
                  safeWrite(clientSocket, fullPacket);
                  return;
                }
              }

              if (packet.packetId === systemChatPacket.id && isPlayState) {
                const nbtData = packet.packetData.subarray(0, -1);
                const isActionBar = packet.packetData[packet.packetData.length - 1];

                const hookResults = executeHook(FeatureHook.SystemChat, { nbt: nbtData, isActionBar });
                const paintResult = hookResults.find((r) => r != null && r !== true);

                if (paintResult === false) {
                  return;
                }

                if (paintResult && typeof paintResult === 'object' && 'toNbtObject' in paintResult) {
                  const nbtObject = paintResult.toNbtObject();
                  const formattedNBT = anonymousNbt(nbtObject);
                  const packetId = varInt(systemChatPacket.id);
                  const actionBarByte = Buffer.from([isActionBar ?? 0]);
                  const packetContent = Buffer.concat([packetId, formattedNBT, actionBarByte]);
                  const fullPacket = Buffer.concat([varInt(packetContent.length), packetContent]);
                  safeWrite(clientSocket, fullPacket);
                  return;
                }
              }

              // After Join Game packet, send tab list for players on other servers
              if (packet.packetId === joinGamePacket.id && trackedPlayer) {
                // Forward the Join Game packet first
                forwardPacket(clientSocket, packet);

                // Now send tab list info for all online players (including self)
                // The backend only knows about players on its server, so we need to send info for ALL players
                const selfProps = executeHookFirst(FeatureHook.GetProfileProperties, { uuid: trackedPlayer.uuid }) || [];
                const selfPacket = executeHookFirst<Buffer>(FeatureHook.BuildPlayerInfoPacket, {
                  uuid: trackedPlayer.uuid,
                  username: trackedPlayer.username,
                  props: selfProps,
                });
                if (selfPacket) {
                  safeWrite(clientSocket, selfPacket);
                }

                sendGlobalTabList(trackedPlayer);
                sendTabListHeaderFooter(trackedPlayer);

                // Broadcast this player's join to all OTHER players
                broadcastPlayerJoin(trackedPlayer.uuid, trackedPlayer.username, trackedPlayer.uuid);

                // Flush any pending join messages
                flushPendingJoinMessages();
                return;
              }

              // Track dimension changes from Respawn packets
              if (packet.packetId === respawnPacket.id && trackedPlayer) {
                try {
                  const data = packet.packetData;
                  let offset = 0;

                  // Skip dimension type (varint)
                  let b = 0;
                  do {
                    b = data[offset++] ?? 0;
                  } while ((b & 0x80) !== 0);

                  // Read dimension name string
                  let nameLen = 0;
                  let shift = 0;
                  do {
                    b = data[offset++] ?? 0;
                    nameLen |= (b & 0x7f) << shift;
                    shift += 7;
                  } while ((b & 0x80) !== 0);

                  const dimensionName = data.subarray(offset, offset + nameLen).toString('utf8');
                  setPlayerDimensionByName(trackedPlayer, dimensionName);
                  offset += nameLen;

                  // SpawnInfo: hashedSeed (i64 = 8 bytes) + gamemode (i8)
                  offset += 8; // Skip hashedSeed
                  const gameMode = data.readInt8(offset);
                  executeHook(FeatureHook.PlayerGameModeChange, { player: trackedPlayer, gameMode });
                } catch (e) {
                  console.error('[Dimension] Failed to parse dimension:', e);
                }
              }

              // Track gamemode changes from server
              if (packet.packetId === gameStateChangePacket.id && trackedPlayer) {
                try {
                  const data = packet.packetData;
                  const reason = data[0]; // u8
                  if (reason === 3) {
                    // change_game_mode - gameMode is f32 at offset 1
                    const gameMode = data.readFloatBE(1);
                    executeHook(FeatureHook.PlayerGameModeChange, { player: trackedPlayer, gameMode: Math.floor(gameMode) });
                  }
                } catch (_e) {
                  // Ignore parse errors
                }
              }

              forwardPacket(clientSocket, packet);
            });

            serverSocket.on('error', (e) => {
              console.error('server socket error', e);
              if (!isSwitching) {
                clientSocket.end();
              }
            });

            serverSocket.on('close', () => {
              if (!isSwitching) {
                clientSocket.end();
              }
            });

            resolve();
          });
        });
      };

      // await connectToBackend(params.target);

      clientPacketQueue.onPacket(async (packet) => {
        if (isSwitching) {
          return;
        }

        if (isLoginState) {
          const loginData = parseLoginStart(packet.packetData);
          if (loginData && !pendingLogin) {
            // Validate session with Mojang if online mode is enabled
            if (kIsOnlineMode && serverKeyPair) {
              // Generate verify token and send Encryption Request
              const verifyToken = generateVerifyToken();
              pendingLogin = { username: loginData.username, verifyToken };

              const encryptionRequest = createEncryptionRequest(serverKeyPair.publicKey, verifyToken);
              safeWrite(clientSocket, encryptionRequest);
              // Don't forward Login Start yet - wait for Encryption Response
              return;
            } else {
              // Offline Mode - Connect to backend now
              const offlineUuid = generateOfflineUUID(loginData.username);
              const savedPort = resolvePort(getPlayerLastServerName(offlineUuid));
              const initialPort = savedPort || params.target;
              currentBackendPort = initialPort;

              try {
                await connectToBackend(initialPort);
                // connectToBackend sends Handshake.
                // We must forward this Login Start packet.
                if (serverSocket) {
                  forwardPacket(serverSocket, packet);
                }
              } catch {
                // Connection error already handled in connectToBackend
              }
              return;
            }
          }

          // Handle Encryption Response (packet ID 0x01 in login state)
          if (pendingLogin && packet.packetId === 0x01 && serverKeyPair) {
            try {
              const encResponse = readPacketFields(encryptionResponsePacket.fields, packet.packetData);

              // Buffer type handler already extracted the data (no length prefix)
              const sharedSecret = rsaDecrypt(serverKeyPair.privateKey, encResponse.sharedSecret);
              const decryptedToken = rsaDecrypt(serverKeyPair.privateKey, encResponse.verifyToken);

              // Verify token matches
              if (!decryptedToken.equals(pendingLogin.verifyToken)) {
                const disconnectPacket = createLoginDisconnect(p.error`Encryption error!`);
                safeWrite(clientSocket, disconnectPacket);
                clientSocket.end();
                return;
              }

              // Generate server ID and verify with Mojang
              const serverId = generateServerId(sharedSecret, serverKeyPair.publicKey);

              // Don't pass IP for local connections - Mojang would reject them
              const isLocalIp = clientIp === '127.0.0.1' || clientIp === '::1' || clientIp?.startsWith('192.168.') || clientIp?.startsWith('10.');
              const profile = await verifyMojangSession(pendingLogin.username, serverId, isLocalIp ? undefined : clientIp);

              if (!profile) {
                const disconnectPacket = createLoginDisconnect(
                  p.error`Failed to verify username!\n\n${p.gray`Your Minecraft session could not be verified.\nPlease restart your client and try again.`}`
                );
                safeWrite(clientSocket, disconnectPacket);
                clientSocket.end();
                return;
              }

              // Enable encryption on client socket
              enableEncryption(clientSocket, sharedSecret);

              // Format Mojang UUID with dashes (Mojang returns without dashes)
              const formattedUuid = formatUuidWithDashes(profile.id);

              // Check for profile remapping (travel patch)
              const remap = executeHookFirst<{ newUsername: string; newUuid: string }>(FeatureHook.GetRemappedProfile, {
                username: pendingLogin.username,
              });
              const backendUsername = remap?.newUsername ?? pendingLogin.username;
              const backendUuid = remap?.newUuid ?? formattedUuid;

              // Store client login info - we'll send Login Success AFTER backend responds
              // Use remapped values so the player is tracked with the correct identity
              pendingClientLogin = {
                username: backendUsername,
                uuid: backendUuid,
                sharedSecret,
                profile,
                isRemapped: remap !== null,
              };

              if (remap) {
                console.log(`[TravelPatch] Remapping ${pendingLogin.username} -> ${backendUsername}`);
              }

              // Online Mode - Connect to backend now (use Mojang UUID)
              const savedPort = resolvePort(getPlayerLastServerName(backendUuid));
              const initialPort = savedPort || params.target;
              currentBackendPort = initialPort;

              await connectToBackend(initialPort);

              // Send Login Start to backend server (offline mode, no encryption)
              const loginStartPacketId = varInt(0x00);
              const loginStartUsername = string(backendUsername);
              const loginStartUuid = Buffer.from(backendUuid.replace(/-/g, ''), 'hex');

              const loginStartContent = Buffer.concat([loginStartPacketId, loginStartUsername, loginStartUuid]);

              const backendLoginStart = Buffer.concat([varInt(loginStartContent.length), loginStartContent]);

              safeWrite(serverSocket, backendLoginStart);

              pendingLogin = null;
              // Stay in login state to receive backend's Login Success
              return;
            } catch (error) {
              console.error('[Auth] Encryption handshake error:', error);
              const disconnectPacket = createLoginDisconnect(p.error`Authentication failed`);
              safeWrite(clientSocket, disconnectPacket);
              clientSocket.end();
              return;
            }
          }
        }

        // Configuration state - forward all packets (settings contains view distance)
        if (isConfigurationState) {
          if (packet.packetId === 0x00 && trackedPlayer) trackedPlayer.cachedClientSettings = packet.packetData;
          if (packet.packetId === 0x07 && trackedPlayer) trackedPlayer.cachedKnownPacks = packet.packetData;
        }

        if (isPlayState && trackedPlayer && kIsOnlineMode) {
          if (packet.packetId === 0x09) {
            return;
          }
        }

        if (isPlayState && trackedPlayer) {
          // Build ProxyPlayer for handlers
          const proxyPlayer: ProxyPlayer = {
            uuid: trackedPlayer.uuid,
            username: trackedPlayer.username,
            clientSocket,
            serverSocket: serverSocket!,
            serverPort: currentBackendPort,
            isPremium: trackedPlayer.isOnlineMode,
            offlineUuid: trackedPlayer.offlineUuid,
          };

          // Handle client→server packets through handler system
          if (handleClientToServerPacket(proxyPlayer, packet.packetId, packet.packetData)) {
            return;
          }

          // Edit Book (0x17)
          if (packet.packetId === 0x17) {
            const results = executeHook(FeatureHook.EditBook, { player: trackedPlayer, packetData: packet.packetData });
            if (results.some((r) => r === true)) {
              return;
            }
          }

          // Inventory Click (0x11)
          if (packet.packetId === 0x11) {
            executeHook(FeatureHook.InventoryClick, { player: trackedPlayer, packetData: packet.packetData });
          }

          const isHandled = parsePlayerMessage(trackedPlayer, packet.packetId, packet.packetData);
          if (isHandled) {
            return;
          }

          parsePlayerMovement(trackedPlayer, packet.packetId, packet.packetData);

          parsePlayerInteraction(trackedPlayer, packet.packetId, packet.packetData);
        }

        if (serverSocket) {
          forwardPacket(serverSocket, packet);
        }
      });

      clientSocket.on('close', () => {
        if (trackedPlayer) {
          trackConnectionClose(trackedPlayer.uuid);
          playerSwitcher.delete(trackedPlayer.uuid);
        }
        if (serverSocket) {
          serverSocket.end();
        }
      });

      // Additional error handling for cleanup (main handler is at connection start)
      clientSocket.on('error', () => {
        if (serverSocket) {
          serverSocket.end();
        }
      });
    } catch (e) {
      console.error('error in client connction handler', e);
      clientSocket.end();
    }
  });

  server.listen(params.port);

  return server;
}
