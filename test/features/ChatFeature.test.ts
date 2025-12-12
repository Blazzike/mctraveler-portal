import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import net from 'node:net';
import { executeCommand, getUniqueCommandNames } from '@/feature-api/command';
import { enableFeatureForTesting, reset } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import ChatFeature from '@/features/ChatFeature';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';

const { clearOnlinePlayersForTesting, trackPlayerLogin: _trackPlayerLogin } = OnlinePlayersModule.api;

function trackPlayerLogin(uuid: string, username: string, socket: net.Socket) {
  return _trackPlayerLogin(uuid, username, socket, 25566, true, undefined, true);
}

describe('ChatFeature', () => {
  beforeAll(() => {
    reset();
    enableFeatureForTesting(ChatFeature);
  });

  afterEach(() => {
    clearOnlinePlayersForTesting();
  });

  afterAll(() => {
    reset();
  });

  describe('Command Registration', () => {
    test('registers shrug command', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('shrug');
    });

    test('registers tableflip command', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('tableflip');
    });

    test('registers msg command', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('msg');
    });

    test('registers reply command', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('reply');
    });

    test('registers r command (alias for reply)', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('r');
    });
  });

  describe('Command Execution', () => {
    test('shrug command executes', () => {
      const mockSocket = new net.Socket();
      const player = trackPlayerLogin('uuid-1', 'Player1', mockSocket);
      mockSocket.write = (() => true) as any;

      const result = executeCommand(player, 'shrug');
      expect(result).toBe(true);
    });

    test('tableflip command executes', () => {
      const mockSocket = new net.Socket();
      const player = trackPlayerLogin('uuid-2', 'Player2', mockSocket);
      mockSocket.write = (() => true) as any;

      const result = executeCommand(player, 'tableflip');
      expect(result).toBe(true);
    });

    test('msg command returns formatted message', () => {
      const senderSocket = new net.Socket();
      const targetSocket = new net.Socket();

      const sender = trackPlayerLogin('uuid-sender', 'Sender', senderSocket);
      trackPlayerLogin('uuid-target', 'Target', targetSocket);

      const result = executeCommand(sender, 'msg Target Hello there!');

      const expected = p`${p.green('Sender')} ${p.gray('→')} ${p.green('Target')}: Hello there!`;

      expect(result).toBeDefined();
      expect(result.toLegacyString()).toBe(expected.toLegacyString());
    });

    test('msg command returns error when messaging self', () => {
      const mockSocket = new net.Socket();
      const player = trackPlayerLogin('uuid-self', 'SelfMessager', mockSocket);

      const result = executeCommand(player, 'msg SelfMessager test');

      const expected = p.error`You can't send a message to yourself`;
      expect(result).toBeDefined();
      expect(result.toLegacyString()).toBe(expected.toLegacyString());
    });

    test('reply command returns formatted message', () => {
      const player1Socket = new net.Socket();
      const player2Socket = new net.Socket();

      const player1 = trackPlayerLogin('uuid-p1', 'Player1', player1Socket);
      const player2 = trackPlayerLogin('uuid-p2', 'Player2', player2Socket);

      // First, Player1 messages Player2
      executeCommand(player1, 'msg Player2 Hi');

      // Now Player2 can reply
      const result = executeCommand(player2, 'reply Hey back!');

      const expected = p`${p.green('Player2')} ${p.gray('→')} ${p.green('Player1')}: Hey back!`;
      expect(result).toBeDefined();
      expect(result.toLegacyString()).toBe(expected.toLegacyString());
    });

    test('reply with "r" alias works', () => {
      const p1Socket = new net.Socket();
      const p2Socket = new net.Socket();

      const p1 = trackPlayerLogin('uuid-r1', 'PlayerA', p1Socket);
      const p2 = trackPlayerLogin('uuid-r2', 'PlayerB', p2Socket);

      // PlayerA messages PlayerB
      executeCommand(p1, 'msg PlayerB test');

      // PlayerB replies using "r"
      const result = executeCommand(p2, 'r reply test');

      const expected = p`${p.green('PlayerB')} ${p.gray('→')} ${p.green('PlayerA')}: reply test`;
      expect(result).toBeDefined();
      expect(result.toLegacyString()).toBe(expected.toLegacyString());
    });

    test('reply command returns error when no one to reply to', () => {
      const mockSocket = new net.Socket();
      const player = trackPlayerLogin('uuid-lonely', 'LonelyPlayer', mockSocket);

      const result = executeCommand(player, 'reply test');

      const expected = p.error`You have no-one to reply to`;
      expect(result).toBeDefined();
      expect(result.toLegacyString()).toBe(expected.toLegacyString());
    });
  });
});
