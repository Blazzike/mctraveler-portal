import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { uuid as uuidHandler, varInt as varIntHandler } from '@/encoding/data-buffer';
import { enableModule } from '@/module-api/module';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import TabListModule, { profilePropertiesMap } from '@/modules/TabListModule';
import * as proxy from '@/network/proxy';
import { broadcastPlayerJoin, broadcastPlayerLeave } from '@/network/proxy';

const { removePlayerFromTabList, handlePlayerRemovePacket } = TabListModule.api;
const { clearOnlinePlayersForTesting, trackPlayerLogin: _trackPlayerLogin } = OnlinePlayersModule.api;

function trackPlayerLogin(uuid: string, username: string, socket?: any) {
  return _trackPlayerLogin(uuid, username, socket, 25566, true, undefined, true);
}

describe('tab-list', () => {
  beforeEach(() => {
    enableModule(TabListModule);
  });

  afterEach(() => {
    clearOnlinePlayersForTesting();
    profilePropertiesMap.clear();
    TabListModule.api.clearForTesting();
  });

  describe('removePlayerFromTabList', () => {
    test('removes player without error', () => {
      expect(() => removePlayerFromTabList('test-uuid')).not.toThrow();
    });
  });

  describe('handlePlayerRemovePacket', () => {
    test('parses and removes players from packet', () => {
      const uuid = '00000000-0000-0000-0000-000000000001';

      const parts: Buffer[] = [];
      parts.push(varIntHandler(1));
      parts.push(uuidHandler(uuid));

      const packetData = Buffer.concat(parts);

      expect(() => handlePlayerRemovePacket(packetData)).not.toThrow();
    });

    test('handles multiple players', () => {
      const uuid1 = '00000000-0000-0000-0000-000000000002';
      const uuid2 = '00000000-0000-0000-0000-000000000003';

      const parts: Buffer[] = [];
      parts.push(varIntHandler(2));
      parts.push(uuidHandler(uuid1));
      parts.push(uuidHandler(uuid2));

      const packetData = Buffer.concat(parts);

      expect(() => handlePlayerRemovePacket(packetData)).not.toThrow();
    });

    test('handles empty packet gracefully', () => {
      const parts: Buffer[] = [];
      parts.push(varIntHandler(0));

      const packetData = Buffer.concat(parts);

      expect(() => handlePlayerRemovePacket(packetData)).not.toThrow();
    });
  });

  describe('broadcastPlayerJoin', () => {
    test('broadcasts to all online players', async () => {
      const mockSocket1 = { write: () => {}, readyState: 'open' };
      const mockSocket2 = { write: () => {}, readyState: 'open' };

      const _player1 = trackPlayerLogin('uuid-1', 'Player1', mockSocket1 as any);
      const _player2 = trackPlayerLogin('uuid-2', 'Player2', mockSocket2 as any);

      const getSocketSpy = spyOn(proxy, 'getPlayerSocket').mockImplementation((p) => {
        if (p.uuid === 'uuid-1') return mockSocket1 as any;
        if (p.uuid === 'uuid-2') return mockSocket2 as any;
        return undefined;
      });

      let writeCount = 0;
      mockSocket1.write = () => {
        writeCount++;
      };
      mockSocket2.write = () => {
        writeCount++;
      };

      broadcastPlayerJoin('new-uuid', 'NewPlayer');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(writeCount).toBeGreaterThan(0);

      getSocketSpy.mockRestore();
    });

    test('excludes specific player from broadcast', async () => {
      const mockSocket = { write: () => {}, readyState: 'open' };

      const _player = trackPlayerLogin('uuid-exclude', 'ExcludePlayer', mockSocket as any);

      const getSocketSpy = spyOn(proxy, 'getPlayerSocket').mockReturnValue(mockSocket as any);

      let writeCount = 0;
      mockSocket.write = () => {
        writeCount++;
      };

      broadcastPlayerJoin('new-uuid', 'NewPlayer', 'uuid-exclude');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(writeCount).toBe(0);

      getSocketSpy.mockRestore();
    });
  });

  describe('broadcastPlayerLeave', () => {
    test('broadcasts player removal to all online players', async () => {
      const mockSocket = { write: () => {}, readyState: 'open' };

      trackPlayerLogin('uuid-leave-1', 'LeavePlayer1', mockSocket as any);
      trackPlayerLogin('uuid-leave-2', 'LeavePlayer2', mockSocket as any);

      const getSocketSpy = spyOn(proxy, 'getPlayerSocket').mockReturnValue(mockSocket as any);

      let writeCount = 0;
      mockSocket.write = () => {
        writeCount++;
      };

      broadcastPlayerLeave('some-uuid');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(writeCount).toBeGreaterThan(0);

      getSocketSpy.mockRestore();
    });

    test('cleans up profile properties', () => {
      const uuid = 'props-uuid';
      profilePropertiesMap.set(uuid, [{ name: 'textures', value: 'data' }]);

      expect(profilePropertiesMap.has(uuid)).toBe(true);

      broadcastPlayerLeave(uuid);

      expect(profilePropertiesMap.has(uuid)).toBe(false);
    });
  });

  describe('profilePropertiesMap', () => {
    test('stores and retrieves profile properties', () => {
      const uuid = 'test-props-uuid';
      const props = [{ name: 'textures', value: 'base64data', signature: 'sig123' }];

      profilePropertiesMap.set(uuid, props);

      expect(profilePropertiesMap.get(uuid)).toEqual(props);
    });
  });

  describe('player join/leave tablist flow', () => {
    test('joining player is added to tablist and leaving player is removed', async () => {
      let leavePacketSent = false;

      const mockSocket: any = {
        write: (data: Buffer) => {
          if (data.length > 0) {
            leavePacketSent = true;
          }
        },
        readyState: 'open',
      };

      trackPlayerLogin('flow-uuid', 'FlowPlayer', mockSocket as any);

      const getSocketSpy = spyOn(proxy, 'getPlayerSocket').mockReturnValue(mockSocket as any);

      broadcastPlayerJoin('flow-uuid', 'FlowPlayer');
      await new Promise((resolve) => setTimeout(resolve, 50));

      broadcastPlayerLeave('flow-uuid');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(leavePacketSent).toBe(true);

      getSocketSpy.mockRestore();
    });
  });
});
