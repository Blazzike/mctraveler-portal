import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { executeCommand, getUniqueCommandNames } from '@/feature-api/command';
import { enableFeatureForTesting, reset } from '@/feature-api/manager';
import NotepadFeature from '@/features/NotepadFeature';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import PersistenceModule from '@/modules/PersistenceModule';
import * as proxy from '@/network/proxy';

const { clearOnlinePlayersForTesting, trackPlayerLogin: _trackPlayerLogin } = OnlinePlayersModule.api;

function trackPlayerLogin(uuid: string, username: string, socket?: any) {
  return _trackPlayerLogin(uuid, username, socket, 25566, true, undefined, true);
}

describe('NotepadFeature', () => {
  beforeAll(() => {
    reset();
    enableFeatureForTesting(NotepadFeature);
  });

  afterEach(() => {
    clearOnlinePlayersForTesting();
  });

  afterAll(() => {
    reset();
  });

  describe('Command Registration', () => {
    test('registers notepad command', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('notepad');
    });
  });

  describe('notepad command', () => {
    test('sends book to player', () => {
      let packetSent = false;
      const mockSocket: any = {
        write: () => {
          packetSent = true;
          return true;
        },
        readyState: 'open',
      };

      const player = trackPlayerLogin('notepad-uuid-1', 'NotepadPlayer1', mockSocket);

      const socketSpy = spyOn(proxy, 'getPlayerSocket').mockReturnValue(mockSocket);
      const readSpy = spyOn(PersistenceModule.api, 'readNotepadData').mockReturnValue(['Page 1', 'Page 2']);

      executeCommand(player, 'notepad');

      expect(packetSent).toBe(true);

      readSpy.mockRestore();
      socketSpy.mockRestore();
    });

    test('prevents opening notepad when already open', () => {
      const mockSocket: any = {
        write: () => true,
        readyState: 'open',
      };

      const player = trackPlayerLogin('notepad-uuid-2', 'NotepadPlayer2', mockSocket);

      const socketSpy = spyOn(proxy, 'getPlayerSocket').mockReturnValue(mockSocket);
      const readSpy = spyOn(PersistenceModule.api, 'readNotepadData').mockReturnValue(['Page 1']);

      executeCommand(player, 'notepad');
      const result = executeCommand(player, 'notepad');

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toContain('already editing');

      readSpy.mockRestore();
      socketSpy.mockRestore();
    });
  });
});
