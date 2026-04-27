import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chatMessagePacket } from '@/defined-packets.gen';
import { string } from '@/encoding/data-buffer';
import { enableModule, resetModules } from '@/module-api/module';
import ChatModule from '@/modules/ChatModule';
import OnlinePlayersModule, { type OnlinePlayer } from '@/modules/OnlinePlayersModule';

function createMockPlayer(id: string): OnlinePlayer {
  return {
    uuid: id,
    username: `Player${id}`,
    loginTime: Date.now(),
    get id() {
      return id;
    },
    get name() {
      return `Player${id}`;
    },
    get isOnline() {
      return true;
    },
    get offlineUuid() {
      return id;
    },
    sendMessage: () => {},
    chat: () => {},
    currentServerPort: 25566,
    currentDimension: 'overworld',
    switchServer: async () => {},
  };
}

describe('ChatModule', () => {
  beforeAll(() => {
    resetModules();
    enableModule(ChatModule);
  });

  afterAll(() => {
    resetModules();
  });

  describe('parseChatMessage', () => {
    test('parses a valid chat message', () => {
      const messageStr = 'Hello world';
      const packetData = string(messageStr);
      const result = ChatModule.api.parseChatMessage(chatMessagePacket.id, packetData);
      expect(result).toBe(messageStr);
    });

    test('returns null for non-chat packets', () => {
      const result = ChatModule.api.parseChatMessage(0xff, Buffer.alloc(10));
      expect(result).toBeNull();
    });

    test('returns null for messages starting with /', () => {
      const packetData = string('/help');
      const result = ChatModule.api.parseChatMessage(chatMessagePacket.id, packetData);
      expect(result).toBeNull();
    });

    test('returns null for empty buffer', () => {
      const result = ChatModule.api.parseChatMessage(chatMessagePacket.id, Buffer.alloc(0));
      expect(result).toBeNull();
    });

    test('parses messages with emoji characters', () => {
      const messageStr = 'Hello 😀🎉';
      const packetData = string(messageStr);
      const result = ChatModule.api.parseChatMessage(chatMessagePacket.id, packetData);
      expect(result).toBe(messageStr);
    });

    test('parses messages with unicode characters', () => {
      const messageStr = '\u00e9\u00e8\u00ea \u00c0';
      const packetData = string(messageStr);
      const result = ChatModule.api.parseChatMessage(chatMessagePacket.id, packetData);
      expect(result).toBe(messageStr);
    });
  });

  describe('handleChatPacket', () => {
    test('returns false for non-chat packets', () => {
      const player = createMockPlayer('chat-1');
      const result = ChatModule.api.handleChatPacket(player, 0xff, Buffer.alloc(10));
      expect(result).toBe(false);
    });

    test('returns false for command messages', () => {
      const player = createMockPlayer('chat-2');
      const packetData = string('/help');
      const result = ChatModule.api.handleChatPacket(player, chatMessagePacket.id, packetData);
      expect(result).toBe(false);
    });

    test('returns false when no handlers intercept', () => {
      const player = createMockPlayer('chat-3');
      const packetData = string('Hello world');
      const result = ChatModule.api.handleChatPacket(player, chatMessagePacket.id, packetData);
      expect(result).toBe(false);
    });

    test('calls registered chat handlers', () => {
      let handledMessage = '';
      ChatModule.api.onChat((player, message) => {
        handledMessage = message;
        return true;
      });

      const player = createMockPlayer('chat-4');
      const packetData = string('Test message');
      const result = ChatModule.api.handleChatPacket(player, chatMessagePacket.id, packetData);

      expect(result).toBe(true);
      expect(handledMessage).toBe('Test message');
    });
  });
});
