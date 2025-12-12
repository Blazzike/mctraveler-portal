import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { registerCommand, syntax } from '@/feature-api/command';
import { checkIncompleteCommand } from '@/feature-api/command-usage';
import { reset } from '@/feature-api/manager';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';

const { clearOnlinePlayersForTesting, trackPlayerLogin: _trackPlayerLogin } = OnlinePlayersModule.api;

function trackPlayerLogin(uuid: string, username: string, socket?: any) {
  return _trackPlayerLogin(uuid, username, socket, 25566, true, undefined, true);
}

describe('command-usage', () => {
  beforeAll(() => {
    reset();

    registerCommand(syntax`testcmd ${syntax.string.rest('message')}`, () => {});
    registerCommand(syntax`gamemode ${syntax.oneOf('mode', ['creative', 'survival', 'adventure'] as const)}`, () => {});
    registerCommand(syntax`tp ${syntax.onlinePlayer('target')}`, () => {});
    registerCommand(syntax`give ${syntax.onlinePlayer('target')} ${syntax.integer('amount')}`, () => {});
  });

  afterEach(() => {
    clearOnlinePlayersForTesting();
  });

  afterAll(() => {
    reset();
  });

  describe('checkIncompleteCommand', () => {
    test('returns null for complete matching command', () => {
      const player = trackPlayerLogin('uuid-usage-1', 'UsagePlayer1');
      const result = checkIncompleteCommand('testcmd hello world', player);
      expect(result).toBeNull();
    });

    test('returns usage message for incomplete command', () => {
      const player = trackPlayerLogin('uuid-usage-2', 'UsagePlayer2');
      const result = checkIncompleteCommand('testcmd', player);
      expect(result).not.toBeNull();
      expect(result?.toLegacyString()).toContain('Usage:');
    });

    test('returns null for unknown command', () => {
      const player = trackPlayerLogin('uuid-usage-3', 'UsagePlayer3');
      const result = checkIncompleteCommand('unknowncommand', player);
      expect(result).toBeNull();
    });

    test('returns null for empty command', () => {
      const player = trackPlayerLogin('uuid-usage-4', 'UsagePlayer4');
      const result = checkIncompleteCommand('', player);
      expect(result).toBeNull();
    });

    test('shows usage for oneOf command without valid option', () => {
      const player = trackPlayerLogin('uuid-usage-5', 'UsagePlayer5');
      const result = checkIncompleteCommand('gamemode', player);
      expect(result).not.toBeNull();
    });

    test('returns null for valid oneOf option', () => {
      const player = trackPlayerLogin('uuid-usage-6', 'UsagePlayer6');
      const result = checkIncompleteCommand('gamemode creative', player);
      expect(result).toBeNull();
    });

    test('shows error for invalid player argument', () => {
      const player = trackPlayerLogin('uuid-usage-7', 'UsagePlayer7');
      const result = checkIncompleteCommand('tp nonexistentplayer', player);
      expect(result).not.toBeNull();
    });

    test('shows usage for multi-argument command missing args', () => {
      const player = trackPlayerLogin('uuid-usage-8', 'UsagePlayer8');
      trackPlayerLogin('target-uuid', 'TargetPlayer');

      const result = checkIncompleteCommand('give TargetPlayer', player);
      expect(result).not.toBeNull();
    });
  });
});
