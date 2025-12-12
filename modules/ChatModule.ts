import { chatMessagePacket } from '@/defined-packets.gen';
import { string } from '@/encoding/data-buffer';
import { defineModule } from '@/module-api/module';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';

type ChatHandler = (player: OnlinePlayer, message: string) => boolean | undefined;
const chatHandlers: ChatHandler[] = [];

function parseChatMessage(packetId: number, packetData: Buffer): string | null {
  if (packetId !== chatMessagePacket.id) {
    return null;
  }

  try {
    const message = string.read(packetData);
    if (message.startsWith('/')) {
      return null;
    }
    return message;
  } catch {
    return null;
  }
}

export default defineModule({
  name: 'Chat',
  api: {
    onChat(handler: ChatHandler): void {
      chatHandlers.push(handler);
    },

    parseChatMessage,

    handleChatPacket(player: OnlinePlayer, packetId: number, packetData: Buffer): boolean {
      const message = parseChatMessage(packetId, packetData);
      if (message === null) return false;

      for (const handler of chatHandlers) {
        const result = handler(player, message);
        if (result === true) {
          return true;
        }
      }

      return false;
    },
  },
  onEnable: () => {},
});
