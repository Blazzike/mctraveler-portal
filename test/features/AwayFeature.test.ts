import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import net from 'node:net';
import { executeCommand, getUniqueCommandNames } from '@/feature-api/command';
import { enableFeatureForTesting, executeHook, FeatureHook, reset } from '@/feature-api/manager';
import p, { type Paint } from '@/feature-api/paint';
import AwayFeature from '@/features/AwayFeature';
import MessageModule from '@/modules/MessageModule';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';

const { clearOnlinePlayersForTesting, trackPlayerLogin: _trackPlayerLogin } = OnlinePlayersModule.api;

function trackPlayerLogin(uuid: string, username: string, socket?: net.Socket) {
  return _trackPlayerLogin(uuid, username, socket, 25566, true, undefined, true);
}

describe('AwayFeature', () => {
  beforeAll(() => {
    reset();
    enableFeatureForTesting(AwayFeature);
  });

  afterEach(() => {
    clearOnlinePlayersForTesting();
  });

  afterAll(() => {
    reset();
  });

  // Helper to spy on broadcast and verify away/back messages
  function captureAwayMessages() {
    const spy = spyOn(MessageModule.api, 'broadcast');
    const toLegacy = (msg: any) => (typeof msg === 'string' ? msg : (msg?.toLegacyString?.() ?? ''));
    return {
      spy,
      getAwayMessage: () => spy.mock.calls.find((call) => toLegacy(call[0]).includes('is now away'))?.[0],
      getBackMessage: () => spy.mock.calls.find((call) => toLegacy(call[0]).includes('no longer away'))?.[0],
      restore: () => spy.mockRestore(),
    };
  }

  describe('Command Registration', () => {
    test('registers away command', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('away');
    });
  });

  describe('Command Execution', () => {
    test('/away works and broadcasts correct message', () => {
      const messages = captureAwayMessages();

      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;
      const player = trackPlayerLogin('uuid-away-1', 'AwayPlayer1', mockSocket);

      const result = executeCommand(player, 'away');

      expect(result).toBe(true);

      const awayMsg = messages.getAwayMessage();
      const expected = p.gray`${p.green('AwayPlayer1')} is now away`;
      expect(awayMsg).toBeDefined();
      expect((awayMsg as Paint).toLegacyString()).toBe(expected.toLegacyString());

      messages.restore();
    });

    test('/away in quick succession triggers cooldown', async () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;
      const player = trackPlayerLogin('uuid-cooldown', 'CooldownPlayer', mockSocket);

      // First usage
      const result1 = executeCommand(player, 'away');
      expect(result1).toBe(true);

      // Wait 100ms (within 3 second cooldown)
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Second usage - should error
      const result2 = executeCommand(player, 'away');
      expect(result2).toBeDefined();

      // Check it's an error with the right format
      expect(result2.toLegacyString()).toContain('§c§lERROR§r');
      expect(result2.toLegacyString()).toContain('cannot use /away again');
      expect(result2.toLegacyString()).toContain('seconds');
    });

    test('/away then moving forward brings user back', () => {
      const messages = captureAwayMessages();

      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;
      const player = trackPlayerLogin('uuid-move', 'MovePlayer', mockSocket);

      // Go away
      executeCommand(player, 'away');
      expect(messages.getAwayMessage()).toBeDefined();

      // Simulate move
      executeHook(FeatureHook.PlayerMove, {
        player,
        from: { x: 0, y: 0, z: 0 },
        to: { x: 1, y: 0, z: 0 },
      });

      const backMsg = messages.getBackMessage();
      const expected = p.gray`${p.green('MovePlayer')} is no longer away`;
      expect(backMsg).toBeDefined();
      expect((backMsg as Paint).toLegacyString()).toBe(expected.toLegacyString());

      messages.restore();
    });

    test('/away then chatting brings user back', () => {
      const messages = captureAwayMessages();

      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;
      const player = trackPlayerLogin('uuid-chat', 'ChatPlayer', mockSocket);

      // Go away
      executeCommand(player, 'away');
      expect(messages.getAwayMessage()).toBeDefined();

      // Simulate chat
      executeHook(FeatureHook.PlayerChat, { player, message: 'Hello!' });

      const backMsg = messages.getBackMessage();
      const expected = p.gray`${p.green('ChatPlayer')} is no longer away`;
      expect(backMsg).toBeDefined();
      expect((backMsg as Paint).toLegacyString()).toBe(expected.toLegacyString());

      messages.restore();
    });

    test('/away then using a command brings user back', () => {
      const messages = captureAwayMessages();

      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;
      const player = trackPlayerLogin('uuid-command', 'CommandPlayer', mockSocket);

      // Go away
      executeCommand(player, 'away');
      expect(messages.getAwayMessage()).toBeDefined();

      // Simulate command
      executeHook(FeatureHook.PlayerCommand, { player, command: 'shrug' });

      const backMsg = messages.getBackMessage();
      const expected = p.gray`${p.green('CommandPlayer')} is no longer away`;
      expect(backMsg).toBeDefined();
      expect((backMsg as Paint).toLegacyString()).toBe(expected.toLegacyString());

      messages.restore();
    });

    test('/away then using an item brings user back', () => {
      const messages = captureAwayMessages();

      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;
      const player = trackPlayerLogin('uuid-item', 'ItemPlayer', mockSocket);

      // Go away
      executeCommand(player, 'away');
      expect(messages.getAwayMessage()).toBeDefined();

      // Simulate use item
      executeHook(FeatureHook.PlayerUseItem, { player });

      const backMsg = messages.getBackMessage();
      const expected = p.gray`${p.green('ItemPlayer')} is no longer away`;
      expect(backMsg).toBeDefined();
      expect((backMsg as Paint).toLegacyString()).toBe(expected.toLegacyString());

      messages.restore();
    });

    test('/away then placing a block brings user back', () => {
      const messages = captureAwayMessages();

      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;
      const player = trackPlayerLogin('uuid-place', 'PlacePlayer', mockSocket);

      // Go away
      executeCommand(player, 'away');
      expect(messages.getAwayMessage()).toBeDefined();

      // Simulate block place
      executeHook(FeatureHook.PlayerBlockPlace, { player });

      const backMsg = messages.getBackMessage();
      const expected = p.gray`${p.green('PlacePlayer')} is no longer away`;
      expect(backMsg).toBeDefined();
      expect((backMsg as Paint).toLegacyString()).toBe(expected.toLegacyString());

      messages.restore();
    });

    test('/away then breaking a block brings user back', () => {
      const messages = captureAwayMessages();

      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;
      const player = trackPlayerLogin('uuid-break', 'BreakPlayer', mockSocket);

      // Go away
      executeCommand(player, 'away');
      expect(messages.getAwayMessage()).toBeDefined();

      // Simulate block break
      executeHook(FeatureHook.PlayerBlockBreak, { player });

      const backMsg = messages.getBackMessage();
      const expected = p.gray`${p.green('BreakPlayer')} is no longer away`;
      expect(backMsg).toBeDefined();
      expect((backMsg as Paint).toLegacyString()).toBe(expected.toLegacyString());

      messages.restore();
    });
  });
});
