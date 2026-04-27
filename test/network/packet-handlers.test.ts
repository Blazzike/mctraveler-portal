import { afterEach, describe, expect, test } from 'bun:test';
import net from 'node:net';
import {
  handleClientToServerPacket,
  handleServerToClientPacket,
  onClientToServerPacket,
  onPlayerJoin,
  onPlayerLeave,
  onServerToClientPacket,
  type ProxyPlayer,
  resetHandlers,
  triggerPlayerJoin,
  triggerPlayerLeave,
} from '@/network/packet-handlers';

function createMockPlayer(): ProxyPlayer {
  return {
    uuid: 'test-uuid',
    username: 'TestPlayer',
    clientSocket: new net.Socket(),
    serverSocket: new net.Socket(),
    serverPort: 25566,
    isPremium: true,
    offlineUuid: 'test-offline-uuid',
  };
}

describe('packet-handlers', () => {
  afterEach(() => {
    resetHandlers();
  });

  describe('onClientToServerPacket', () => {
    test('registered handler is called', () => {
      let called = false;
      onClientToServerPacket(() => {
        called = true;
        return false;
      });

      const player = createMockPlayer();
      handleClientToServerPacket(player, 0x01, Buffer.alloc(5));

      expect(called).toBe(true);
    });

    test('handler can block packets', () => {
      onClientToServerPacket(() => true);

      const player = createMockPlayer();
      const result = handleClientToServerPacket(player, 0x01, Buffer.alloc(5));

      expect(result).toBe(true);
    });

    test('returns false when no handler blocks', () => {
      onClientToServerPacket(() => false);

      const player = createMockPlayer();
      const result = handleClientToServerPacket(player, 0x01, Buffer.alloc(5));

      expect(result).toBe(false);
    });

    test('stops at first blocking handler', () => {
      let secondCalled = false;
      onClientToServerPacket(() => true);
      onClientToServerPacket(() => {
        secondCalled = true;
        return false;
      });

      const player = createMockPlayer();
      handleClientToServerPacket(player, 0x01, Buffer.alloc(5));

      expect(secondCalled).toBe(false);
    });

    test('passes correct arguments to handler', () => {
      let receivedPacketId = -1;
      let receivedDataLength = -1;
      onClientToServerPacket((_player, packetId, data) => {
        receivedPacketId = packetId;
        receivedDataLength = data.length;
        return false;
      });

      const player = createMockPlayer();
      handleClientToServerPacket(player, 0x42, Buffer.alloc(10));

      expect(receivedPacketId).toBe(0x42);
      expect(receivedDataLength).toBe(10);
    });
  });

  describe('onServerToClientPacket', () => {
    test('registered handler is called', () => {
      let called = false;
      onServerToClientPacket(() => {
        called = true;
        return false;
      });

      const player = createMockPlayer();
      handleServerToClientPacket(player, 0x01, Buffer.alloc(5));

      expect(called).toBe(true);
    });

    test('handler can block packets', () => {
      onServerToClientPacket(() => true);

      const player = createMockPlayer();
      const result = handleServerToClientPacket(player, 0x01, Buffer.alloc(5));

      expect(result).toBe(true);
    });

    test('returns false when no handler blocks', () => {
      const player = createMockPlayer();
      const result = handleServerToClientPacket(player, 0x01, Buffer.alloc(5));

      expect(result).toBe(false);
    });
  });

  describe('player lifecycle events', () => {
    test('onPlayerJoin handler is triggered', () => {
      let joinedUsername = '';
      onPlayerJoin((player) => {
        joinedUsername = player.username;
      });

      const player = createMockPlayer();
      triggerPlayerJoin(player);

      expect(joinedUsername).toBe('TestPlayer');
    });

    test('onPlayerLeave handler is triggered', () => {
      let leftUsername = '';
      onPlayerLeave((player) => {
        leftUsername = player.username;
      });

      const player = createMockPlayer();
      triggerPlayerLeave(player);

      expect(leftUsername).toBe('TestPlayer');
    });

    test('multiple join handlers are all called', () => {
      let count = 0;
      onPlayerJoin(() => {
        count++;
      });
      onPlayerJoin(() => {
        count++;
      });
      onPlayerJoin(() => {
        count++;
      });

      triggerPlayerJoin(createMockPlayer());

      expect(count).toBe(3);
    });
  });

  describe('resetHandlers', () => {
    test('clears all registered handlers', () => {
      let called = false;
      onClientToServerPacket(() => {
        called = true;
        return true;
      });

      resetHandlers();

      const player = createMockPlayer();
      handleClientToServerPacket(player, 0x01, Buffer.alloc(5));

      expect(called).toBe(false);
    });
  });
});
