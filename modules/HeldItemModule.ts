import { setSlotPacket, windowItemsPacket } from '@/defined-packets.gen';
import { varInt } from '@/encoding/data-buffer';
import { executeHook, FeatureHook } from '@/feature-api/manager';
import { defineModule } from '@/module-api/module';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';
import { onClientToServerPacket, onServerToClientPacket } from '@/network/packet-handlers';

const playerHeldSlots = new WeakMap<OnlinePlayer, number>();
const playerHotbarItems = new WeakMap<OnlinePlayer, Map<number, boolean>>();

function clearPlayerTracking(player: OnlinePlayer): void {
  playerHeldSlots.delete(player);
  playerHotbarItems.delete(player);
}

function trackHeldSlotChange(player: OnlinePlayer, slot: number): void {
  playerHeldSlots.set(player, slot);
}

function trackHotbarItem(player: OnlinePlayer, slot: number, hasItem: boolean): void {
  let hotbar = playerHotbarItems.get(player);
  if (!hotbar) {
    hotbar = new Map();
    playerHotbarItems.set(player, hotbar);
  }
  hotbar.set(slot, hasItem);
}

function isHoldingItem(player: OnlinePlayer): boolean {
  const slot = playerHeldSlots.get(player) ?? 0;
  const hotbar = playerHotbarItems.get(player);
  if (!hotbar) return false;
  return hotbar.get(slot) ?? false;
}

export default defineModule({
  name: 'HeldItem',
  api: {
    trackHeldSlotChange,
    trackHotbarItem,
    isHoldingItem,

    getHeldSlot(player: OnlinePlayer): number {
      return playerHeldSlots.get(player) ?? 0;
    },

    clearPlayerTracking,
  },
  onEnable: () => {
    onClientToServerPacket((player, packetId, packetData) => {
      if (packetId === 0x34) {
        const slot = packetData.readInt16BE(0);
        trackHeldSlotChange(player as unknown as OnlinePlayer, slot);
        executeHook(FeatureHook.HeldItemChange, { player, packetData });
      }
      return false;
    });

    onServerToClientPacket((player, packetId, packetData) => {
      if (packetId === setSlotPacket.id) {
        try {
          const windowIdInfo = varInt.readWithBytesCount(packetData);
          if (windowIdInfo.value === 0) {
            const stateIdInfo = varInt.readWithBytesCount(packetData.subarray(windowIdInfo.bytesRead));
            const slotInfo = packetData.readInt16BE(windowIdInfo.bytesRead + stateIdInfo.bytesRead);
            if (slotInfo >= 36 && slotInfo <= 44) {
              const hotbarSlot = slotInfo - 36;
              const itemDataStart = windowIdInfo.bytesRead + stateIdInfo.bytesRead + 2;
              const itemCount = varInt.read(packetData.subarray(itemDataStart));
              trackHotbarItem(player as unknown as OnlinePlayer, hotbarSlot, itemCount > 0);
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
      if (packetId === windowItemsPacket.id) {
        try {
          const windowIdInfo = varInt.readWithBytesCount(packetData);
          if (windowIdInfo.value === 0) {
            const stateIdInfo = varInt.readWithBytesCount(packetData.subarray(windowIdInfo.bytesRead));
            const countInfo = varInt.readWithBytesCount(packetData.subarray(windowIdInfo.bytesRead + stateIdInfo.bytesRead));
            const slotCount = countInfo.value;
            let offset = windowIdInfo.bytesRead + stateIdInfo.bytesRead + countInfo.bytesRead;
            for (let i = 0; i < slotCount && offset < packetData.length; i++) {
              const itemCount = varInt.readWithBytesCount(packetData.subarray(offset));
              if (i >= 36 && i <= 44) {
                const hotbarSlot = i - 36;
                trackHotbarItem(player as unknown as OnlinePlayer, hotbarSlot, itemCount.value > 0);
              }
              offset += itemCount.bytesRead;
              if (itemCount.value > 0) {
                offset += 2;
                const nbtIdInfo = varInt.readWithBytesCount(packetData.subarray(offset));
                offset += nbtIdInfo.bytesRead;
                const componentsInfo = varInt.readWithBytesCount(packetData.subarray(offset));
                offset += componentsInfo.bytesRead;
                const removeInfo = varInt.readWithBytesCount(packetData.subarray(offset));
                offset += removeInfo.bytesRead;
              }
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
      return false;
    });
  },
  onPlayerLeave: (player) => {
    clearPlayerTracking(player);
  },
});
