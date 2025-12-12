import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import net from 'node:net';
import { executeCommand, getUniqueCommandNames } from '@/feature-api/command';
import { enableFeatureForTesting, reset } from '@/feature-api/manager';
import AdminFeature from '@/features/AdminFeature';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import PersistenceModule from '@/modules/PersistenceModule';

const { clearOnlinePlayersForTesting, trackPlayerLogin: _trackPlayerLogin } = OnlinePlayersModule.api;

function trackPlayerLogin(uuid: string, username: string, socket?: net.Socket) {
  return _trackPlayerLogin(uuid, username, socket, 25566, true, undefined, true);
}

describe('AdminFeature', () => {
  beforeAll(() => {
    reset();
    enableFeatureForTesting(AdminFeature);
  });

  afterEach(() => {
    clearOnlinePlayersForTesting();
  });

  afterAll(() => {
    reset();
  });

  describe('Command Registration', () => {
    test('registers op command', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('op');
    });

    test('registers deop command', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('deop');
    });
  });

  describe('op command', () => {
    test('non-admin cannot op a player', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const sender = trackPlayerLogin('sender-uuid', 'RegularPlayer', mockSocket);
      trackPlayerLogin('target-uuid', 'TargetPlayer', mockSocket);

      const isAdminSpy = spyOn(PersistenceModule.api, 'isPlayerAdmin').mockReturnValue(false);

      const result = executeCommand(sender, 'op TargetPlayer');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('admin');

      isAdminSpy.mockRestore();
    });

    test('admin can op a player', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const sender = trackPlayerLogin('admin-uuid', 'AdminPlayer', mockSocket);
      const _target = trackPlayerLogin('target-uuid-2', 'TargetPlayer2', mockSocket);

      const isAdminSpy = spyOn(PersistenceModule.api, 'isPlayerAdmin').mockReturnValue(true);
      const setAdminSpy = spyOn(PersistenceModule.api, 'setPlayerAdmin').mockImplementation(() => {});
      const cacheSpy = spyOn(PersistenceModule.api, 'cachePlayerUuid').mockImplementation(() => {});

      const result = executeCommand(sender, 'op TargetPlayer2');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('operator');
      expect(setAdminSpy).toHaveBeenCalledWith('target-uuid-2', true);

      isAdminSpy.mockRestore();
      setAdminSpy.mockRestore();
      cacheSpy.mockRestore();
    });

    test('iElmo can always op players', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const sender = trackPlayerLogin('elmo-uuid', 'iElmo', mockSocket);
      trackPlayerLogin('target-uuid-3', 'TargetPlayer3', mockSocket);

      const isAdminSpy = spyOn(PersistenceModule.api, 'isPlayerAdmin').mockReturnValue(false);
      const setAdminSpy = spyOn(PersistenceModule.api, 'setPlayerAdmin').mockImplementation(() => {});
      const cacheSpy = spyOn(PersistenceModule.api, 'cachePlayerUuid').mockImplementation(() => {});

      const result = executeCommand(sender, 'op TargetPlayer3');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('operator');

      isAdminSpy.mockRestore();
      setAdminSpy.mockRestore();
      cacheSpy.mockRestore();
    });
  });

  describe('deop command', () => {
    test('non-admin cannot deop a player', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const sender = trackPlayerLogin('sender-uuid-deop', 'RegularPlayer2', mockSocket);
      trackPlayerLogin('target-uuid-deop', 'TargetPlayer4', mockSocket);

      const isAdminSpy = spyOn(PersistenceModule.api, 'isPlayerAdmin').mockReturnValue(false);

      const result = executeCommand(sender, 'deop TargetPlayer4');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('admin');

      isAdminSpy.mockRestore();
    });

    test('admin can deop a player', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const sender = trackPlayerLogin('admin-uuid-deop', 'AdminPlayer2', mockSocket);
      trackPlayerLogin('target-uuid-deop-2', 'TargetPlayer5', mockSocket);

      const isAdminSpy = spyOn(PersistenceModule.api, 'isPlayerAdmin').mockReturnValue(true);
      const setAdminSpy = spyOn(PersistenceModule.api, 'setPlayerAdmin').mockImplementation(() => {});

      const result = executeCommand(sender, 'deop TargetPlayer5');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('Removed');
      expect(setAdminSpy).toHaveBeenCalledWith('target-uuid-deop-2', false);

      isAdminSpy.mockRestore();
      setAdminSpy.mockRestore();
    });
  });
});
