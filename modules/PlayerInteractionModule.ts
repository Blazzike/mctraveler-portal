import { defineModule } from '@/module-api/module';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';

type InteractionHandler = (player: OnlinePlayer, packetData: Buffer) => boolean | undefined;

const blockBreakHandlers: InteractionHandler[] = [];
const blockPlaceHandlers: InteractionHandler[] = [];
const useItemHandlers: InteractionHandler[] = [];
const interactHandlers: InteractionHandler[] = [];

export default defineModule({
  name: 'PlayerInteraction',
  api: {
    onBlockBreak(handler: InteractionHandler): void {
      blockBreakHandlers.push(handler);
    },

    onBlockPlace(handler: InteractionHandler): void {
      blockPlaceHandlers.push(handler);
    },

    onUseItem(handler: InteractionHandler): void {
      useItemHandlers.push(handler);
    },

    onInteract(handler: InteractionHandler): void {
      interactHandlers.push(handler);
    },

    handleBlockBreak(player: OnlinePlayer, packetData: Buffer): boolean {
      for (const handler of blockBreakHandlers) {
        if (handler(player, packetData) === true) return true;
      }
      return false;
    },

    handleBlockPlace(player: OnlinePlayer, packetData: Buffer): boolean {
      for (const handler of blockPlaceHandlers) {
        if (handler(player, packetData) === true) return true;
      }
      return false;
    },

    handleUseItem(player: OnlinePlayer, packetData: Buffer): boolean {
      for (const handler of useItemHandlers) {
        if (handler(player, packetData) === true) return true;
      }
      return false;
    },

    handleInteract(player: OnlinePlayer, packetData: Buffer): boolean {
      for (const handler of interactHandlers) {
        if (handler(player, packetData) === true) return true;
      }
      return false;
    },
  },
  onEnable: () => {},
});
