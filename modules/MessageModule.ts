import type net from 'node:net';
import { systemChatPacket } from '@/defined-packets.gen';
import type { Paint } from '@/feature-api/paint';
import { log } from '@/logging';
import { defineModule } from '@/module-api/module';
import OnlinePlayersModule, { type OnlinePlayer } from '@/modules/OnlinePlayersModule';
import { writePacket } from '@/network/defined-packet';
import { safeWrite } from '@/network/util';

function sendSystemMessage(socket: net.Socket, nbtMessage: any, isActionBar = false): void {
  const packet = writePacket(systemChatPacket, {
    message: nbtMessage,
    isActionBar,
  });
  safeWrite(socket, packet);
}

function sendMessageToPlayer(player: OnlinePlayer, message: Paint | string): void {
  try {
    player.sendMessage(message);
  } catch (e) {
    log.for('Message').debug('Failed to send message to %s: %s', player.username, e);
  }
}

export default defineModule({
  name: 'Message',
  api: {
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
});
