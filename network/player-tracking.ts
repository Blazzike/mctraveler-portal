import { createHash } from 'node:crypto';
import net from 'node:net';
import { executeHook, executeHookFirst, FeatureHook } from '@/feature-api/manager';
import { log } from '@/logging';
import { notifyPlayerJoin, notifyPlayerLeave } from '@/module-api/module';

export interface OnlinePlayer {
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
  /** Cached client settings packet from configuration phase */
  cachedClientSettings?: Buffer;
  /** Cached known packs packet from configuration phase */
  cachedKnownPacks?: Buffer;
  /** Timestamp of last entity interact (for rate limiting) */
  _lastInteractTime?: number;
}

const onlinePlayers = new Map<string, OnlinePlayer>();
const playerSockets = new WeakMap<OnlinePlayer, net.Socket>();
const serverSockets = new WeakMap<OnlinePlayer, net.Socket>();

const pendingJoinMessages: string[] = [];

// Internal socket lookup — uses playerSockets by default, overridable for testing
let _socketLookup: ((player: OnlinePlayer) => net.Socket | undefined) = (player) => {
  const socket = playerSockets.get(player);
  if (socket) return socket;
  const localPlayer = onlinePlayers.get(player.uuid);
  return localPlayer ? playerSockets.get(localPlayer) : undefined;
};

/** @internal Override socket lookup for testing */
export function _setSocketLookup(fn: (player: OnlinePlayer) => net.Socket | undefined) {
  _socketLookup = fn;
}

/** @internal Reset socket lookup to default */
export function _resetSocketLookup() {
  _socketLookup = (player) => {
    const socket = playerSockets.get(player);
    if (socket) return socket;
    const localPlayer = onlinePlayers.get(player.uuid);
    return localPlayer ? playerSockets.get(localPlayer) : undefined;
  };
}

export function trackPlayerLogin(
  uuid: string,
  username: string,
  socket: net.Socket,
  serverPort: number,
  isPremium: boolean,
  offlineUuid?: string,
  playerSwitcher?: Map<string, (port: number) => Promise<void>>
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
  if (playerSwitcher) {
    executeHook(FeatureHook.SetServerSwitcher, {
      uuid,
      switcher: async (port: number) => {
        const switcher = playerSwitcher.get(uuid);
        if (switcher) {
          await switcher(port);
        }
      },
    });
  }

  return player;
}

export function trackConnectionClose(uuid: string): void {
  const player = onlinePlayers.get(uuid);
  if (player) {
    log.for('Players').info('- player %s', player.username);
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

export function trackServerSocket(player: OnlinePlayer, socket: net.Socket): void {
  serverSockets.set(player, socket);
}

export function setPlayerDimensionByName(player: OnlinePlayer, dimension: string): void {
  player.currentDimension = dimension;
}

export function broadcastPlayerJoin(uuid: string, username: string, excludeUuid?: string) {
  const props = executeHookFirst(FeatureHook.GetProfileProperties, { uuid }) || [];
  const packet = executeHookFirst<Buffer>(FeatureHook.BuildPlayerInfoPacket, { uuid, username, props });

  const players = executeHookFirst<OnlinePlayer[]>(FeatureHook.GetOnlinePlayers) || [];
  players.forEach((player) => {
    if (excludeUuid && player.uuid === excludeUuid) return;
    const socket = _socketLookup(player);
    if (socket && packet && (socket.readyState === 'open' || socket.readyState === 'writeOnly')) {
      try {
        socket.write(packet);
      } catch {
        // Socket closed between readyState check and write
      }
    }
  });
}

export function broadcastPlayerLeave(uuid: string) {
  executeHook(FeatureHook.RemovePlayerFromTabList, { uuid });

  const packet = executeHookFirst<Buffer>(FeatureHook.BuildPlayerRemovePacket, { uuid });

  const players = executeHookFirst<OnlinePlayer[]>(FeatureHook.GetOnlinePlayers) || [];
  players.forEach((player) => {
    const socket = _socketLookup(player);
    if (socket && packet && (socket.readyState === 'open' || socket.readyState === 'writeOnly')) {
      try {
        socket.write(packet);
      } catch {
        // Socket closed between readyState check and write
      }
    }
  });
}

export function sendGlobalTabList(targetPlayer: OnlinePlayer) {
  const players = executeHookFirst<OnlinePlayer[]>(FeatureHook.GetOnlinePlayers) || [];
  if (players.length === 0) return;

  const socket = _socketLookup(targetPlayer);
  if (!socket) return;

  for (const player of players) {
    const props = executeHookFirst(FeatureHook.GetProfileProperties, { uuid: player.uuid }) || [];
    const packet = executeHookFirst<Buffer>(FeatureHook.BuildPlayerInfoPacket, { uuid: player.uuid, username: player.username, props });

    if (packet && (socket.readyState === 'open' || socket.readyState === 'writeOnly')) {
      try {
        socket.write(packet);
      } catch {
        // Socket closed between readyState check and write
      }
    }
  }
}

export function sendTabListHeaderFooter(targetPlayer: OnlinePlayer) {
  const packet = executeHookFirst<Buffer>(FeatureHook.BuildTabListHeaderFooterPacket);
  if (packet) {
    const socket = _socketLookup(targetPlayer);
    if (socket && (socket.readyState === 'open' || socket.readyState === 'writeOnly')) {
      try {
        socket.write(packet);
      } catch {
        // Socket closed between readyState check and write
      }
    }
  }
}

export function broadcastJoinMessage(player: OnlinePlayer, delayUntilPlay?: boolean): void {
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

export function flushPendingJoinMessages(): void {
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

export function getOnlinePlayers(): OnlinePlayer[] {
  return Array.from(onlinePlayers.values());
}

export function getPlayerSocket(player: OnlinePlayer): net.Socket | undefined {
  return _socketLookup(player);
}

export function getServerSocket(player: OnlinePlayer): net.Socket | undefined {
  return serverSockets.get(player);
}

export function generateOfflineUUID(username: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${username}`).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x30;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function deletePlayerSocket(player: OnlinePlayer): void {
  playerSockets.delete(player);
}

export function deleteServerSocket(player: OnlinePlayer): void {
  serverSockets.delete(player);
}
