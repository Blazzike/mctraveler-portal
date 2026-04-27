import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import net from 'node:net';
import { enableModule, resetModules } from '@/module-api/module';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';

const {
  trackPlayerLogin,
  trackPlayerLogout,
  getOnlinePlayer,
  getPlayerByUsername,
  getOnlinePlayers,
  getOnlineCount,
  isPlayerOnline,
  generateOfflineUUID,
  clearOnlinePlayersForTesting,
  setPlayerDimension,
  getPlayerByOfflineUuid,
} = OnlinePlayersModule.api;

describe('OnlinePlayersModule', () => {
  beforeAll(() => {
    resetModules();
    enableModule(OnlinePlayersModule);
  });

  afterEach(() => {
    clearOnlinePlayersForTesting();
  });

  describe('trackPlayerLogin', () => {
    test('creates an online player', () => {
      const socket = new net.Socket();
      const player = trackPlayerLogin('uuid-1', 'Steve', socket, 25566, true, undefined, true);

      expect(player.uuid).toBe('uuid-1');
      expect(player.username).toBe('Steve');
      expect(player.id).toBe('uuid-1');
      expect(player.name).toBe('Steve');
      expect(player.isOnline).toBe(true);
      expect(player.currentServerPort).toBe(25566);
      expect(player.currentDimension).toBe('overworld');
    });

    test('generates offline UUID when not provided', () => {
      const socket = new net.Socket();
      const player = trackPlayerLogin('uuid-2', 'Alex', socket, 25566, true, undefined, true);

      expect(player.offlineUuid).toBeDefined();
      expect(player.offlineUuid.length).toBeGreaterThan(0);
    });

    test('uses provided offline UUID', () => {
      const socket = new net.Socket();
      const customOfflineUuid = '11111111-2222-3333-4444-555555555555';
      const player = trackPlayerLogin('uuid-3', 'Player3', socket, 25566, true, customOfflineUuid, true);

      expect(player.offlineUuid).toBe(customOfflineUuid);
    });

    test('player loginTime is set', () => {
      const socket = new net.Socket();
      const before = Date.now();
      const player = trackPlayerLogin('uuid-4', 'Player4', socket, 25566, true, undefined, true);
      const after = Date.now();

      expect(player.loginTime).toBeGreaterThanOrEqual(before);
      expect(player.loginTime).toBeLessThanOrEqual(after);
    });
  });

  describe('trackPlayerLogout', () => {
    test('removes player from online list', () => {
      const socket = new net.Socket();
      trackPlayerLogin('uuid-logout', 'LogoutPlayer', socket, 25566, true, undefined, true);

      expect(isPlayerOnline('uuid-logout')).toBe(true);

      trackPlayerLogout('uuid-logout');

      expect(isPlayerOnline('uuid-logout')).toBe(false);
    });

    test('player.isOnline returns false after logout', () => {
      const socket = new net.Socket();
      const player = trackPlayerLogin('uuid-online-check', 'OnlineCheck', socket, 25566, true, undefined, true);

      expect(player.isOnline).toBe(true);

      trackPlayerLogout('uuid-online-check');

      expect(player.isOnline).toBe(false);
    });

    test('handles logout for non-existent player', () => {
      expect(() => trackPlayerLogout('non-existent-uuid')).not.toThrow();
    });
  });

  describe('getOnlinePlayer', () => {
    test('returns player by UUID', () => {
      const socket = new net.Socket();
      trackPlayerLogin('uuid-get', 'GetPlayer', socket, 25566, true, undefined, true);

      const player = getOnlinePlayer('uuid-get');
      expect(player).toBeDefined();
      expect(player!.username).toBe('GetPlayer');
    });

    test('returns undefined for non-existent player', () => {
      const player = getOnlinePlayer('non-existent');
      expect(player).toBeUndefined();
    });
  });

  describe('getPlayerByUsername', () => {
    test('returns player by exact username', () => {
      const socket = new net.Socket();
      trackPlayerLogin('uuid-name', 'TestPlayer', socket, 25566, true, undefined, true);

      const player = getPlayerByUsername('TestPlayer');
      expect(player).toBeDefined();
      expect(player!.uuid).toBe('uuid-name');
    });

    test('is case-insensitive', () => {
      const socket = new net.Socket();
      trackPlayerLogin('uuid-case', 'CaseTest', socket, 25566, true, undefined, true);

      expect(getPlayerByUsername('casetest')).toBeDefined();
      expect(getPlayerByUsername('CASETEST')).toBeDefined();
      expect(getPlayerByUsername('CaseTest')).toBeDefined();
    });

    test('returns undefined for non-existent username', () => {
      const player = getPlayerByUsername('NonExistent');
      expect(player).toBeUndefined();
    });
  });

  describe('getPlayerByOfflineUuid', () => {
    test('returns player by offline UUID', () => {
      const socket = new net.Socket();
      const offlineUuid = '11111111-2222-3333-4444-555555555555';
      trackPlayerLogin('uuid-offline', 'OfflinePlayer', socket, 25566, false, offlineUuid, true);

      const player = getPlayerByOfflineUuid(offlineUuid);
      expect(player).toBeDefined();
      expect(player!.uuid).toBe('uuid-offline');
    });

    test('returns undefined for non-existent offline UUID', () => {
      const player = getPlayerByOfflineUuid('non-existent-offline-uuid');
      expect(player).toBeUndefined();
    });
  });

  describe('getOnlinePlayers', () => {
    test('returns all online players', () => {
      const socket1 = new net.Socket();
      const socket2 = new net.Socket();
      trackPlayerLogin('uuid-all-1', 'Player1', socket1, 25566, true, undefined, true);
      trackPlayerLogin('uuid-all-2', 'Player2', socket2, 25566, true, undefined, true);

      const players = getOnlinePlayers();
      expect(players.length).toBe(2);
    });

    test('returns empty array when no players online', () => {
      const players = getOnlinePlayers();
      expect(players.length).toBe(0);
    });
  });

  describe('getOnlineCount', () => {
    test('returns correct count', () => {
      expect(getOnlineCount()).toBe(0);

      const socket = new net.Socket();
      trackPlayerLogin('uuid-count', 'CountPlayer', socket, 25566, true, undefined, true);

      expect(getOnlineCount()).toBe(1);
    });
  });

  describe('isPlayerOnline', () => {
    test('returns true for online player', () => {
      const socket = new net.Socket();
      trackPlayerLogin('uuid-is-online', 'IsOnline', socket, 25566, true, undefined, true);

      expect(isPlayerOnline('uuid-is-online')).toBe(true);
    });

    test('returns false for offline player', () => {
      expect(isPlayerOnline('not-online')).toBe(false);
    });
  });

  describe('setPlayerDimension', () => {
    test('updates player dimension', () => {
      const socket = new net.Socket();
      const player = trackPlayerLogin('uuid-dim', 'DimPlayer', socket, 25566, true, undefined, true);

      expect(player.currentDimension).toBe('overworld');

      setPlayerDimension(player, 'the_nether');

      expect(player.currentDimension).toBe('the_nether');
    });
  });

  describe('generateOfflineUUID', () => {
    test('generates consistent UUIDs for the same username', () => {
      const uuid1 = generateOfflineUUID('TestUser');
      const uuid2 = generateOfflineUUID('TestUser');
      expect(uuid1).toBe(uuid2);
    });

    test('generates different UUIDs for different usernames', () => {
      const uuid1 = generateOfflineUUID('User1');
      const uuid2 = generateOfflineUUID('User2');
      expect(uuid1).not.toBe(uuid2);
    });

    test('generates valid UUID format', () => {
      const uuid = generateOfflineUUID('FormatTest');
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('generates version 3 UUID', () => {
      const uuid = generateOfflineUUID('VersionTest');
      const parts = uuid.split('-');
      const versionChar = parts[2]![0];
      expect(versionChar).toBe('3');
    });
  });
});
