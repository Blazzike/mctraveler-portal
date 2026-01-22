import type net from 'node:net';
import { systemChatPacket } from '@/defined-packets.gen';
import { FeatureHook, registerHook } from '@/feature-api/manager';
import { defineModule } from '@/module-api/module';
import { writePacket } from '@/network/defined-packet';
import { safeWrite } from '@/network/util';
import { generateOfflineUUID } from '@/util/uuid';

export interface OnlinePlayer {
  readonly uuid: string;
  readonly username: string;
  readonly loginTime: number;
  readonly id: string;
  readonly name: string;
  readonly isOnline: boolean;
  readonly offlineUuid: string;
  currentServerPort: number;
  currentDimension: string;
  sendMessage: (message: any) => void;
  chat: (message: string) => void;
  switchServer: (port: number) => Promise<void>;
}

const onlinePlayers = new Map<string, OnlinePlayer>();
const offlineUuidToOnlineUuid = new Map<string, string>();
const playerSockets = new WeakMap<OnlinePlayer, net.Socket>();
// const _serverSockets = new WeakMap<OnlinePlayer, net.Socket>(); // Unused - commented out
const serverSwitchers = new Map<string, (port: number) => Promise<void>>();

function sendMessageToPlayer(player: OnlinePlayer, message: any): void {
  const sock = playerSockets.get(player);
  if (!sock) return;

  // Check if socket is actually connected (pending means not connected yet)
  if ((sock as any).pending || sock.destroyed) {
    return;
  }

  try {
    const nbt = typeof message === 'string' ? { text: message } : message.toNbtObject ? message.toNbtObject() : message;
    const packet = writePacket(systemChatPacket, { content: nbt, isActionBar: false });
    safeWrite(sock, packet);
  } catch {
    // Socket closed, ignore
  }
}

function trackPlayerLoginInternal(
  uuid: string,
  username: string,
  socket: net.Socket | undefined,
  serverPort: number,
  isPremium: boolean,
  offlineUuid?: string
): OnlinePlayer {
  const playerOfflineUuid = offlineUuid || generateOfflineUUID(username);

  const player: OnlinePlayer = {
    uuid,
    username,
    loginTime: Date.now(),
    get id() {
      return uuid;
    },
    get name() {
      return username;
    },
    get isOnline() {
      return onlinePlayers.has(uuid);
    },
    get offlineUuid() {
      return playerOfflineUuid;
    },
    currentServerPort: serverPort,
    currentDimension: 'overworld',
    sendMessage: (message) => {
      sendMessageToPlayer(player, message);
    },
    chat: (_message) => {
      // Chat broadcast is handled by ChatFeature hooks
    },
    switchServer: async (port) => {
      const switcher = serverSwitchers.get(uuid);
      if (switcher) {
        await switcher(port);
      }
    },
  };

  onlinePlayers.set(uuid, player);
  offlineUuidToOnlineUuid.set(playerOfflineUuid, uuid);

  if (socket) {
    playerSockets.set(player, socket);
  }

  console.log(`[+ player] ${username}${isPremium ? '' : ' (offline)'}`);

  return player;
}

function trackPlayerLogoutInternal(uuid: string): void {
  const player = onlinePlayers.get(uuid);
  if (player) {
    console.log(`[- player] ${player.username}`);
    offlineUuidToOnlineUuid.delete(player.offlineUuid);
    onlinePlayers.delete(uuid);
  }
}

function getOnlinePlayersInternal(): OnlinePlayer[] {
  return Array.from(onlinePlayers.values());
}

function setServerSwitcherInternal(uuid: string, switcher: (port: number) => Promise<void>): void {
  serverSwitchers.set(uuid, switcher);
}

function clearServerSwitcherInternal(uuid: string): void {
  serverSwitchers.delete(uuid);
}

export default defineModule({
  name: 'OnlinePlayers',
  api: {
    generateOfflineUUID,

    trackPlayerLogin(
      uuid: string,
      username: string,
      socket: net.Socket | undefined,
      serverPort: number,
      isPremium: boolean,
      offlineUuid?: string,
      _skipPersistence?: boolean
    ): OnlinePlayer {
      return trackPlayerLoginInternal(uuid, username, socket, serverPort, isPremium, offlineUuid);
    },

    trackPlayerLogout(uuid: string): void {
      trackPlayerLogoutInternal(uuid);
    },

    getOnlinePlayer(uuid: string): OnlinePlayer | undefined {
      return onlinePlayers.get(uuid);
    },

    getPlayerByUsername(username: string): OnlinePlayer | undefined {
      const lowerUsername = username.toLowerCase();
      for (const player of onlinePlayers.values()) {
        if (player.username.toLowerCase() === lowerUsername) {
          return player;
        }
      }
      return undefined;
    },

    getPlayerByOfflineUuid(offlineUuid: string): OnlinePlayer | undefined {
      const onlineUuid = offlineUuidToOnlineUuid.get(offlineUuid);
      if (onlineUuid) {
        return onlinePlayers.get(onlineUuid);
      }
      return undefined;
    },

    getOnlinePlayers(): OnlinePlayer[] {
      return getOnlinePlayersInternal();
    },

    getOnlineCount(): number {
      return onlinePlayers.size;
    },

    isPlayerOnline(uuid: string): boolean {
      return onlinePlayers.has(uuid);
    },

    setPlayerDimension(player: OnlinePlayer, dimension: string): void {
      player.currentDimension = dimension;
    },

    clearOnlinePlayersForTesting(): void {
      onlinePlayers.clear();
      offlineUuidToOnlineUuid.clear();
      // Note: We intentionally don't clear callbacks as they're configured once by proxy.ts
    },

    getPlayerSocket(player: OnlinePlayer): net.Socket | undefined {
      return playerSockets.get(player);
    },

    setPlayerSocket(player: OnlinePlayer, socket: net.Socket): void {
      playerSockets.set(player, socket);
    },

    setServerSwitcher(uuid: string, switcher: (port: number) => Promise<void>): void {
      setServerSwitcherInternal(uuid, switcher);
    },

    clearServerSwitcher(uuid: string): void {
      clearServerSwitcherInternal(uuid);
    },
  },
  onEnable: () => {
    registerHook(FeatureHook.GetOnlinePlayers, () => {
      return getOnlinePlayersInternal();
    });

    registerHook(
      FeatureHook.TrackPlayerLogin,
      (data: { uuid: string; username: string; socket: net.Socket; serverPort: number; isPremium: boolean; offlineUuid?: string }) => {
        return trackPlayerLoginInternal(data.uuid, data.username, data.socket, data.serverPort, data.isPremium, data.offlineUuid);
      }
    );

    registerHook(FeatureHook.TrackPlayerLogout, ({ uuid }: { uuid: string }) => {
      trackPlayerLogoutInternal(uuid);
    });

    registerHook(FeatureHook.SetServerSwitcher, ({ uuid, switcher }: { uuid: string; switcher: (port: number) => Promise<void> }) => {
      setServerSwitcherInternal(uuid, switcher);
    });

    registerHook(FeatureHook.ClearServerSwitcher, ({ uuid }: { uuid: string }) => {
      clearServerSwitcherInternal(uuid);
    });
  },
});
