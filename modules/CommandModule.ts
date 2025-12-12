import { chatCommandPacket } from '@/defined-packets.gen';
import { string } from '@/encoding/data-buffer';
import { defineModule } from '@/module-api/module';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';

type CommandHandler = (player: OnlinePlayer, command: string) => boolean | undefined;
const commandHandlers: CommandHandler[] = [];

function parseChatCommand(packetId: number, packetData: Buffer): string | null {
  if (packetId !== chatCommandPacket.id) {
    return null;
  }

  try {
    return string.read(packetData);
  } catch {
    return null;
  }
}

export default defineModule({
  name: 'Command',
  api: {
    onCommand(handler: CommandHandler): void {
      commandHandlers.push(handler);
    },

    parseChatCommand,

    handleCommandPacket(player: OnlinePlayer, packetId: number, packetData: Buffer): boolean {
      const command = parseChatCommand(packetId, packetData);
      if (command === null) return false;

      for (const handler of commandHandlers) {
        const result = handler(player, command);
        if (result === true) {
          return true;
        }
      }

      return false;
    },
  },
  onEnable: () => {},
});
