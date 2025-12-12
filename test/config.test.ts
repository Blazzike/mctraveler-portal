import { describe, expect, test } from 'bun:test';
import { kIsOnlineMode, kPort, kPrimaryPort, kProtocolVersion, kProtocolVersionString, kSecondaryPort } from '@/config';

describe('config', () => {
  test('kPort is the proxy port', () => {
    expect(kPort).toBe(25565);
  });

  test('kPrimaryPort is the primary backend port', () => {
    expect(kPrimaryPort).toBe(25566);
  });

  test('kSecondaryPort is the secondary backend port', () => {
    expect(kSecondaryPort).toBe(25567);
  });

  test('kProtocolVersion is defined', () => {
    expect(typeof kProtocolVersion).toBe('number');
    expect(kProtocolVersion).toBeGreaterThan(0);
  });

  test('kProtocolVersionString matches expected format', () => {
    expect(kProtocolVersionString).toMatch(/^\d+\.\d+(\.\d+)?$/);
  });

  test('kIsOnlineMode is a boolean', () => {
    expect(typeof kIsOnlineMode).toBe('boolean');
  });

  test('primary and secondary ports are different', () => {
    expect(kPrimaryPort).not.toBe(kSecondaryPort);
  });

  test('proxy port is different from backend ports', () => {
    expect(kPort).not.toBe(kPrimaryPort);
    expect(kPort).not.toBe(kSecondaryPort);
  });
});
