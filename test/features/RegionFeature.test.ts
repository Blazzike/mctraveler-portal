import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import net from 'node:net';
import { executeCommand, getUniqueCommandNames } from '@/feature-api/command';
import { enableFeatureForTesting, reset } from '@/feature-api/manager';
import RegionFeature from '@/features/RegionFeature';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import PersistenceModule from '@/modules/PersistenceModule';

const { clearOnlinePlayersForTesting, trackPlayerLogin: _trackPlayerLogin } = OnlinePlayersModule.api;

function trackPlayerLogin(uuid: string, username: string, socket?: net.Socket) {
  return _trackPlayerLogin(uuid, username, socket, 25566, true, undefined, true);
}

describe('RegionFeature', () => {
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

  describe('Command Registration', () => {
    test('registers region command', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('region');
    });

    test('registers rg command alias', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('rg');
    });
  });

  describe('region command', () => {
    test('region help returns help message', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('region-uuid-1', 'RegionPlayer1', mockSocket);

      const result = executeCommand(player, 'region');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('Region Commands');
    });

    test('rg help returns help message', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('region-uuid-2', 'RegionPlayer2', mockSocket);

      const result = executeCommand(player, 'rg');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('Region Commands');
    });

    test('region rename fails when not in a region', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('region-uuid-3', 'RegionPlayer3', mockSocket);

      const result = executeCommand(player, 'region rename New Name');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('must stand in');
    });

    test('region add fails when not in a region', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('region-uuid-4', 'RegionPlayer4', mockSocket);
      trackPlayerLogin('target-uuid', 'TargetPlayer', mockSocket);

      const result = executeCommand(player, 'region add TargetPlayer');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('must stand in');
    });

    test('region remove fails when not in a region', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('region-uuid-5', 'RegionPlayer5', mockSocket);

      const result = executeCommand(player, 'region remove SomePlayer');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('must stand in');
    });

    test('region delete fails when not in a region', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('region-uuid-6', 'RegionPlayer6', mockSocket);

      const result = executeCommand(player, 'region delete');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('must stand in');
    });

    test('region start requires position to be tracked first', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('region-uuid-7', 'RegionPlayer7', mockSocket);

      const result = executeCommand(player, 'region start');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('Position not available');
    });

    test('region end fails without start', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('region-uuid-8', 'RegionPlayer8', mockSocket);

      const result = executeCommand(player, 'region end');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('start first');
    });

    test('region flag requires admin', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('region-uuid-9', 'RegionPlayer9', mockSocket);

      const isAdminSpy = spyOn(PersistenceModule.api, 'isPlayerAdmin').mockReturnValue(false);

      const result = executeCommand(player, 'region flag');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('admin');

      isAdminSpy.mockRestore();
    });

    test('region bounds requires admin', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('region-uuid-10', 'RegionPlayer10', mockSocket);

      const isAdminSpy = spyOn(PersistenceModule.api, 'isPlayerAdmin').mockReturnValue(false);

      const result = executeCommand(player, 'region bounds');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('admin');

      isAdminSpy.mockRestore();
    });

    test('region locate requires admin', () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('region-uuid-11', 'RegionPlayer11', mockSocket);

      const isAdminSpy = spyOn(PersistenceModule.api, 'isPlayerAdmin').mockReturnValue(false);

      const result = executeCommand(player, 'region locate test');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('admin');

      isAdminSpy.mockRestore();
    });
  });
});
