import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { playerBlockDigPacket } from '@/defined-packets.gen';
import { varInt } from '@/encoding/data-buffer';
import { enableFeatureForTesting, reset } from '@/feature-api/manager';
import RegionFeature from '@/features/RegionFeature';
import OnlinePlayersModule, { type OnlinePlayer } from '@/modules/OnlinePlayersModule';
import ProtectionHooksModule from '@/modules/ProtectionHooksModule';

const { checkProtection, trackContainerClose, trackContainerOpen } = ProtectionHooksModule.api;

const { clearOnlinePlayersForTesting, trackPlayerLogin } = OnlinePlayersModule.api;

function createMockPlayer(uuid: string, username: string): OnlinePlayer {
  return trackPlayerLogin(uuid, username, undefined, 25566, true, undefined, true);
}

function encodeBlockPosition(x: number, y: number, z: number): Buffer {
  const buf = Buffer.alloc(8);
  const val = BigInt(((x & 0x3ffffff) << 38) | ((z & 0x3ffffff) << 12) | (y & 0xfff));
  buf.writeBigInt64BE(val);
  return buf;
}

describe('protection-hooks', () => {
  beforeAll(() => {
    reset();
    enableFeatureForTesting(RegionFeature);
  });

  afterEach(() => {
    clearOnlinePlayersForTesting();
  });

  afterAll(() => {
    reset();
  });

  describe('trackContainerOpen / trackContainerClose', () => {
    test('tracks container open state for player', () => {
      const player = createMockPlayer('uuid-container-1', 'ContainerPlayer1');

      expect(() => trackContainerOpen(player)).not.toThrow();
      expect(() => trackContainerClose(player)).not.toThrow();
    });

    test('can be called multiple times without error', () => {
      const player = createMockPlayer('uuid-container-2', 'ContainerPlayer2');

      trackContainerOpen(player);
      trackContainerOpen(player);
      trackContainerClose(player);
      trackContainerClose(player);
    });
  });

  describe('checkProtection', () => {
    test('returns false for non-protected packets', () => {
      const player = createMockPlayer('uuid-protect-1', 'ProtectPlayer1');
      const mockSocket = { write: () => {}, readyState: 'open' };

      const packet = {
        packetId: 0x99,
        packetData: Buffer.alloc(0),
      };

      const result = checkProtection(packet, player, mockSocket);
      expect(result).toBe(false);
    });

    test('returns false for block dig when no region exists', () => {
      const player = createMockPlayer('uuid-protect-2', 'ProtectPlayer2');
      const mockSocket = { write: () => {}, readyState: 'open' };

      const posBuffer = encodeBlockPosition(100, 64, 200);
      const packetData = Buffer.concat([varInt(0), posBuffer, varInt(0), varInt(1)]);

      const packet = {
        packetId: playerBlockDigPacket.id,
        packetData,
      };

      const result = checkProtection(packet, player, mockSocket);
      expect(result).toBe(false);
    });
  });
});
