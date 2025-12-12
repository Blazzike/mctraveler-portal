import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { string as stringHandler, uuid as uuidHandler, varInt as varIntHandler } from '@/encoding/data-buffer';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import PlayerInfoBitflagsModule from '@/modules/PlayerInfoBitflagsModule';
import TabListModule from '@/modules/TabListModule';

const { rebuildPlayerInfoBitflags } = PlayerInfoBitflagsModule.api;

const { clearOnlinePlayersForTesting } = OnlinePlayersModule.api;

describe('player-info-bitflags', () => {
  afterEach(() => {
    clearOnlinePlayersForTesting();
    TabListModule.api.clearForTesting();
  });

  describe('rebuildPlayerInfoBitflags', () => {
    test('returns null for empty packet data', () => {
      const result = rebuildPlayerInfoBitflags(Buffer.alloc(0));
      expect(result).toBeNull();
    });

    test('returns null for malformed data', () => {
      const result = rebuildPlayerInfoBitflags(Buffer.from([0x01]));
      expect(result).toBeNull();
    });

    test('handles ADD_PLAYER flag with no properties', () => {
      const offlineUuid = '00000000-0000-0000-0000-000000000001';

      const getPlayerSpy = spyOn(OnlinePlayersModule.api, 'getPlayerByOfflineUuid').mockReturnValue(undefined);

      const flags = 0x01;
      const numPlayers = 1;
      const username = 'TestPlayer';

      const packetParts: Buffer[] = [];
      packetParts.push(Buffer.from([flags]));
      packetParts.push(varIntHandler(numPlayers));
      packetParts.push(uuidHandler(offlineUuid));
      packetParts.push(stringHandler(username));
      packetParts.push(varIntHandler(0));

      const packetData = Buffer.concat(packetParts);

      const result = rebuildPlayerInfoBitflags(packetData);
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThan(0);

      getPlayerSpy.mockRestore();
    });

    test('handles UPDATE_GAME_MODE flag', () => {
      const offlineUuid = '00000000-0000-0000-0000-000000000002';

      const getPlayerSpy = spyOn(OnlinePlayersModule.api, 'getPlayerByOfflineUuid').mockReturnValue(undefined);

      const flags = 0x04;
      const numPlayers = 1;

      const packetParts: Buffer[] = [];
      packetParts.push(Buffer.from([flags]));
      packetParts.push(varIntHandler(numPlayers));
      packetParts.push(uuidHandler(offlineUuid));
      packetParts.push(varIntHandler(1));

      const packetData = Buffer.concat(packetParts);

      const result = rebuildPlayerInfoBitflags(packetData);
      expect(result).not.toBeNull();

      getPlayerSpy.mockRestore();
    });

    test('handles UPDATE_LISTED flag', () => {
      const offlineUuid = '00000000-0000-0000-0000-000000000003';

      const getPlayerSpy = spyOn(OnlinePlayersModule.api, 'getPlayerByOfflineUuid').mockReturnValue(undefined);

      const flags = 0x08;
      const numPlayers = 1;

      const packetParts: Buffer[] = [];
      packetParts.push(Buffer.from([flags]));
      packetParts.push(varIntHandler(numPlayers));
      packetParts.push(uuidHandler(offlineUuid));
      packetParts.push(Buffer.from([0x01]));

      const packetData = Buffer.concat(packetParts);

      const result = rebuildPlayerInfoBitflags(packetData);
      expect(result).not.toBeNull();

      getPlayerSpy.mockRestore();
    });

    test('handles UPDATE_LATENCY flag', () => {
      const offlineUuid = '00000000-0000-0000-0000-000000000004';

      const getPlayerSpy = spyOn(OnlinePlayersModule.api, 'getPlayerByOfflineUuid').mockReturnValue(undefined);

      const flags = 0x10;
      const numPlayers = 1;

      const packetParts: Buffer[] = [];
      packetParts.push(Buffer.from([flags]));
      packetParts.push(varIntHandler(numPlayers));
      packetParts.push(uuidHandler(offlineUuid));
      packetParts.push(varIntHandler(50));

      const packetData = Buffer.concat(packetParts);

      const result = rebuildPlayerInfoBitflags(packetData);
      expect(result).not.toBeNull();

      getPlayerSpy.mockRestore();
    });

    test('handles UPDATE_DISPLAY_NAME flag with no name', () => {
      const offlineUuid = '00000000-0000-0000-0000-000000000005';

      const getPlayerSpy = spyOn(OnlinePlayersModule.api, 'getPlayerByOfflineUuid').mockReturnValue(undefined);

      const flags = 0x20;
      const numPlayers = 1;

      const packetParts: Buffer[] = [];
      packetParts.push(Buffer.from([flags]));
      packetParts.push(varIntHandler(numPlayers));
      packetParts.push(uuidHandler(offlineUuid));
      packetParts.push(Buffer.from([0x00]));

      const packetData = Buffer.concat(packetParts);

      const result = rebuildPlayerInfoBitflags(packetData);
      expect(result).not.toBeNull();

      getPlayerSpy.mockRestore();
    });

    test('replaces offline UUID with online UUID when available', () => {
      const offlineUuid = '00000000-0000-0000-0000-000000000006';
      const onlineUuid = '11111111-1111-1111-1111-111111111111';

      const mockPlayer = {
        uuid: onlineUuid,
        username: 'TestPlayer',
      } as any;

      const getPlayerSpy = spyOn(OnlinePlayersModule.api, 'getPlayerByOfflineUuid').mockReturnValue(mockPlayer);

      const flags = 0x04;
      const numPlayers = 1;

      const packetParts: Buffer[] = [];
      packetParts.push(Buffer.from([flags]));
      packetParts.push(varIntHandler(numPlayers));
      packetParts.push(uuidHandler(offlineUuid));
      packetParts.push(varIntHandler(0));

      const packetData = Buffer.concat(packetParts);

      const result = rebuildPlayerInfoBitflags(packetData);
      expect(result).not.toBeNull();

      getPlayerSpy.mockRestore();
    });

    test('injects Mojang properties when available', () => {
      const offlineUuid = '00000000-0000-0000-0000-000000000007';
      const onlineUuid = '22222222-2222-2222-2222-222222222222';

      const mockPlayer = {
        uuid: onlineUuid,
        username: 'TestPlayer',
      } as any;

      const getPlayerSpy = spyOn(OnlinePlayersModule.api, 'getPlayerByOfflineUuid').mockReturnValue(mockPlayer);

      const flags = 0x01;
      const numPlayers = 1;
      const username = 'TestPlayer';

      const packetParts: Buffer[] = [];
      packetParts.push(Buffer.from([flags]));
      packetParts.push(varIntHandler(numPlayers));
      packetParts.push(uuidHandler(offlineUuid));
      packetParts.push(stringHandler(username));
      packetParts.push(varIntHandler(0));

      const packetData = Buffer.concat(packetParts);

      TabListModule.api.setProfileProperties(onlineUuid, [{ name: 'textures', value: 'base64data', signature: 'signature123' }]);

      const result = rebuildPlayerInfoBitflags(packetData);
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThan(packetData.length);

      getPlayerSpy.mockRestore();
    });

    test('handles multiple players', () => {
      const uuid1 = '00000000-0000-0000-0000-000000000008';
      const uuid2 = '00000000-0000-0000-0000-000000000009';

      const getPlayerSpy = spyOn(OnlinePlayersModule.api, 'getPlayerByOfflineUuid').mockReturnValue(undefined);

      const flags = 0x10;
      const numPlayers = 2;

      const packetParts: Buffer[] = [];
      packetParts.push(Buffer.from([flags]));
      packetParts.push(varIntHandler(numPlayers));
      packetParts.push(uuidHandler(uuid1));
      packetParts.push(varIntHandler(50));
      packetParts.push(uuidHandler(uuid2));
      packetParts.push(varIntHandler(100));

      const packetData = Buffer.concat(packetParts);

      const result = rebuildPlayerInfoBitflags(packetData);
      expect(result).not.toBeNull();

      getPlayerSpy.mockRestore();
    });

    test('strips INITIALIZE_CHAT flag for offline mode data', () => {
      const offlineUuid = '00000000-0000-0000-0000-000000000010';

      const getPlayerSpy = spyOn(OnlinePlayersModule.api, 'getPlayerByOfflineUuid').mockReturnValue(undefined);

      const flags = 0x02 | 0x04;
      const numPlayers = 1;

      const packetParts: Buffer[] = [];
      packetParts.push(Buffer.from([flags]));
      packetParts.push(varIntHandler(numPlayers));
      packetParts.push(uuidHandler(offlineUuid));
      packetParts.push(varIntHandler(0));

      const packetData = Buffer.concat(packetParts);

      const result = rebuildPlayerInfoBitflags(packetData);
      expect(result).not.toBeNull();

      const resultFlags = result![0];
      expect(resultFlags! & 0x02).toBe(0);

      getPlayerSpy.mockRestore();
    });
  });
});
