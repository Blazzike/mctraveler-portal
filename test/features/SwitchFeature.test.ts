import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import net from 'node:net';
import { kPrimaryPort, kSecondaryPort } from '@/config';
import { executeCommand, getUniqueCommandNames } from '@/feature-api/command';
import { enableFeatureForTesting, reset } from '@/feature-api/manager';
import SwitchFeature from '@/features/SwitchFeature';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';

const { clearOnlinePlayersForTesting, trackPlayerLogin } = OnlinePlayersModule.api;

describe('SwitchFeature', () => {
  beforeAll(() => {
    reset();
    enableFeatureForTesting(SwitchFeature);
  });

  afterEach(() => {
    clearOnlinePlayersForTesting();
  });

  afterAll(() => {
    reset();
  });

  describe('Command Registration', () => {
    test('registers switch command', () => {
      const commandNames = getUniqueCommandNames();
      expect(commandNames).toContain('switch');
    });
  });

  describe('switch command execution', () => {
    test('executes switch command and sends message', async () => {
      const mockSocket = new net.Socket();
      let messageReceived = false;

      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('switch-uuid', 'SwitchPlayer', mockSocket, kPrimaryPort, false, undefined, true);
      player.sendMessage = () => {
        messageReceived = true;
      };
      player.switchServer = async () => {};

      executeCommand(player, 'switch');

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(messageReceived).toBe(true);
    });

    test('switches to secondary when on primary', async () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('switch-uuid-2', 'SwitchPlayer2', mockSocket, kPrimaryPort, false, undefined, true);

      let switchedToPort = 0;
      player.switchServer = async (port: number) => {
        switchedToPort = port;
      };

      executeCommand(player, 'switch');

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(switchedToPort).toBe(kSecondaryPort);
    });

    test('switches to primary when on secondary', async () => {
      const mockSocket = new net.Socket();
      mockSocket.write = (() => true) as any;

      const player = trackPlayerLogin('switch-uuid-3', 'SwitchPlayer3', mockSocket, kSecondaryPort, false, undefined, true);

      let switchedToPort = 0;
      player.switchServer = async (port: number) => {
        switchedToPort = port;
      };

      executeCommand(player, 'switch');

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(switchedToPort).toBe(kPrimaryPort);
    });
  });
});
