import { afterEach, describe, expect, test } from 'bun:test';
import HeldItemModule from '@/modules/HeldItemModule';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';

const { trackHeldSlotChange, trackHotbarItem, isHoldingItem, getHeldSlot, clearPlayerTracking } = HeldItemModule.api;

function createMockPlayer(id: string): OnlinePlayer {
  return {
    uuid: id,
    username: `Player${id}`,
    loginTime: Date.now(),
    get id() {
      return id;
    },
    get name() {
      return `Player${id}`;
    },
    get isOnline() {
      return true;
    },
    get offlineUuid() {
      return id;
    },
    sendMessage: () => {},
    chat: () => {},
    currentServerPort: 25566,
    currentDimension: 'overworld',
    switchServer: async () => {},
  };
}

describe('HeldItemModule', () => {
  afterEach(() => {
    // Clean up is handled per-player
  });

  describe('trackHeldSlotChange', () => {
    test('tracks held slot', () => {
      const player = createMockPlayer('held-1');
      trackHeldSlotChange(player, 5);
      expect(getHeldSlot(player)).toBe(5);
      clearPlayerTracking(player);
    });

    test('updates held slot', () => {
      const player = createMockPlayer('held-2');
      trackHeldSlotChange(player, 3);
      trackHeldSlotChange(player, 7);
      expect(getHeldSlot(player)).toBe(7);
      clearPlayerTracking(player);
    });
  });

  describe('trackHotbarItem', () => {
    test('tracks item in hotbar', () => {
      const player = createMockPlayer('hotbar-1');
      trackHotbarItem(player, 0, true);
      trackHeldSlotChange(player, 0);
      expect(isHoldingItem(player)).toBe(true);
      clearPlayerTracking(player);
    });

    test('tracks empty slot', () => {
      const player = createMockPlayer('hotbar-2');
      trackHotbarItem(player, 0, false);
      trackHeldSlotChange(player, 0);
      expect(isHoldingItem(player)).toBe(false);
      clearPlayerTracking(player);
    });
  });

  describe('isHoldingItem', () => {
    test('returns false when no data', () => {
      const player = createMockPlayer('holding-1');
      expect(isHoldingItem(player)).toBe(false);
    });

    test('returns true when holding item in current slot', () => {
      const player = createMockPlayer('holding-2');
      trackHeldSlotChange(player, 2);
      trackHotbarItem(player, 2, true);
      expect(isHoldingItem(player)).toBe(true);
      clearPlayerTracking(player);
    });

    test('returns false when slot is empty', () => {
      const player = createMockPlayer('holding-3');
      trackHeldSlotChange(player, 3);
      trackHotbarItem(player, 3, false);
      expect(isHoldingItem(player)).toBe(false);
      clearPlayerTracking(player);
    });
  });

  describe('clearPlayerTracking', () => {
    test('clears all tracking data', () => {
      const player = createMockPlayer('clear-1');
      trackHeldSlotChange(player, 5);
      trackHotbarItem(player, 5, true);

      clearPlayerTracking(player);

      expect(getHeldSlot(player)).toBe(0);
      expect(isHoldingItem(player)).toBe(false);
    });
  });
});
