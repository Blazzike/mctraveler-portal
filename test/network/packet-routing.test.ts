import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import net from 'node:net';
import { chatCommandPacket, chatMessagePacket } from '@/defined-packets.gen';
import { byte, long, string, varInt } from '@/encoding/data-buffer';
import { enableFeatureForTesting, reset } from '@/feature-api/manager';
import ChatFeature from '@/features/ChatFeature';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import { parsePlayerMessage } from '@/network/packet-routing';

const { clearOnlinePlayersForTesting, trackPlayerLogin: _trackPlayerLogin } = OnlinePlayersModule.api;

function trackPlayerLogin(uuid: string, username: string, socket: net.Socket) {
  return _trackPlayerLogin(uuid, username, socket, 25566, true, undefined, true);
}

function createMockSocket(): net.Socket & { writtenData: Buffer[] } {
  const socket = new net.Socket() as net.Socket & { writtenData: Buffer[] };
  socket.writtenData = [];
  socket.write = ((data: Buffer) => {
    socket.writtenData.push(Buffer.from(data));
    return true;
  }) as any;
  Object.defineProperty(socket, 'readyState', { get: () => 'open' });
  return socket;
}

function buildChatPacketData(message: string): Buffer {
  const messageBuf = string(message);
  const timestampBuf = long(BigInt(Date.now()));
  const saltBuf = long(0n);
  const noSignature = Buffer.from([0x00]);
  const offset = varInt(0);
  const acknowledged = Buffer.concat([varInt(0)]);
  const checksum = byte(0);

  return Buffer.concat([messageBuf, timestampBuf, saltBuf, noSignature, offset, acknowledged, checksum]);
}

function buildCommandPacketData(command: string): Buffer {
  return string(command);
}

describe('parsePlayerMessage', () => {
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

  describe('chat messages', () => {
    test('intercepts chat messages', () => {
      const socket = createMockSocket();
      const player = trackPlayerLogin('uuid-1', 'TestPlayer', socket);

      const packetData = buildChatPacketData('Hello world');
      const result = parsePlayerMessage(player, chatMessagePacket.id, packetData);

      expect(result).toBe(true);
    });

    test('always intercepts chat messages even with empty message', () => {
      const socket = createMockSocket();
      const player = trackPlayerLogin('uuid-2', 'Player2', socket);

      const packetData = buildChatPacketData('');
      const result = parsePlayerMessage(player, chatMessagePacket.id, packetData);

      expect(result).toBe(true);
    });

    test('handles emoji messages without crashing', () => {
      const socket = createMockSocket();
      const player = trackPlayerLogin('uuid-emoji', 'EmojiPlayer', socket);

      const packetData = buildChatPacketData('Hello 😀🎉🔥');
      const result = parsePlayerMessage(player, chatMessagePacket.id, packetData);

      expect(result).toBe(true);
    });

    test('handles messages with special characters', () => {
      const socket = createMockSocket();
      const player = trackPlayerLogin('uuid-special', 'SpecialPlayer', socket);

      const packetData = buildChatPacketData('Test §color &formatting <html> "quotes"');
      const result = parsePlayerMessage(player, chatMessagePacket.id, packetData);

      expect(result).toBe(true);
    });

    test('handles messages with unicode characters', () => {
      const socket = createMockSocket();
      const player = trackPlayerLogin('uuid-unicode', 'UnicodePlayer', socket);

      const packetData = buildChatPacketData('Accents: Aiguebelle, \u00e9\u00e8\u00ea, \u00c0');
      const result = parsePlayerMessage(player, chatMessagePacket.id, packetData);

      expect(result).toBe(true);
    });

    test('intercepts chat messages with multiple online players', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();

      const player1 = trackPlayerLogin('uuid-b1', 'Player1', socket1);
      trackPlayerLogin('uuid-b2', 'Player2', socket2);

      const packetData = buildChatPacketData('Hello everyone');
      const result = parsePlayerMessage(player1, chatMessagePacket.id, packetData);

      expect(result).toBe(true);
    });

    test('always returns true for chat message packets even with malformed data', () => {
      const socket = createMockSocket();
      const player = trackPlayerLogin('uuid-malformed', 'MalformedPlayer', socket);

      const result = parsePlayerMessage(player, chatMessagePacket.id, Buffer.alloc(0));

      expect(result).toBe(true);
    });
  });

  describe('chat commands', () => {
    test('intercepts known commands', () => {
      const socket = createMockSocket();
      const player = trackPlayerLogin('uuid-cmd', 'CmdPlayer', socket);

      const packetData = buildCommandPacketData('shrug');
      const result = parsePlayerMessage(player, chatCommandPacket.id, packetData);

      expect(result).toBe(true);
    });

    test('does not intercept unknown commands', () => {
      const socket = createMockSocket();
      const player = trackPlayerLogin('uuid-unknown', 'UnknownCmdPlayer', socket);

      const packetData = buildCommandPacketData('unknowncommand arg1 arg2');
      const result = parsePlayerMessage(player, chatCommandPacket.id, packetData);

      expect(result).toBe(false);
    });
  });

  describe('non-chat packets', () => {
    test('does not intercept non-chat packets', () => {
      const socket = createMockSocket();
      const player = trackPlayerLogin('uuid-other', 'OtherPlayer', socket);

      const result = parsePlayerMessage(player, 0xff, Buffer.alloc(10));

      expect(result).toBe(false);
    });
  });
});
