import type net from 'node:net';
import { systemChatPacket } from '@/defined-packets.gen';
import type { Paint } from '@/feature-api/paint';
import { defineModule } from '@/module-api/module';
import OnlinePlayersModule, { type OnlinePlayer } from '@/modules/OnlinePlayersModule';
import { writePacket } from '@/network/defined-packet';
import { safeWrite } from '@/network/util';

const playerSockets = new WeakMap<OnlinePlayer, net.Socket>();
const serverSockets = new WeakMap<OnlinePlayer, net.Socket>();

function getPlayerSocket(player: OnlinePlayer): net.Socket | undefined {
  return playerSockets.get(player);
}

function sendSystemMessage(socket: net.Socket, nbtMessage: any, isActionBar = false): void {
  const packet = writePacket(systemChatPacket, {
    message: nbtMessage,
    isActionBar,
  });
  safeWrite(socket, packet);
}

function sendMessageToPlayer(player: OnlinePlayer, message: Paint | string): void {
  const socket = getPlayerSocket(player);
  if (!socket) return;

  const nbtMessage = typeof message === 'string' ? { text: message } : message.toNbtObject();

  sendSystemMessage(socket, nbtMessage);
}

export default defineModule({
  name: 'Message',
  api: {
    trackPlayerSocket(player: OnlinePlayer, socket: net.Socket): void {
      playerSockets.set(player, socket);
    },

    getPlayerSocket,

    trackServerSocket(player: OnlinePlayer, socket: net.Socket): void {
      serverSockets.set(player, socket);
    },

    getServerSocket(player: OnlinePlayer): net.Socket | undefined {
      return serverSockets.get(player);
    },

    sendSystemMessage,
    sendMessageToPlayer,

    broadcast(message: Paint | string, excludePlayer?: OnlinePlayer): void {
      for (const player of OnlinePlayersModule.api.getOnlinePlayers()) {
        if (excludePlayer && player.uuid === excludePlayer.uuid) continue;
        sendMessageToPlayer(player, message);
      }
    },
  },
  onEnable: () => {},
  onPlayerLeave: (player) => {
    playerSockets.delete(player);
    serverSockets.delete(player);
  },
});
