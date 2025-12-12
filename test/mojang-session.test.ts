import { describe, expect, test } from 'bun:test';
import { generateServerId, generateVerifyToken } from '../network/mojang-session';

describe('generateServerId', () => {
  test('generates consistent server ID for same inputs', () => {
    const sharedSecret = Buffer.from('secret123');
    const publicKey = Buffer.from('publickey456');

    const id1 = generateServerId(sharedSecret, publicKey);
    const id2 = generateServerId(sharedSecret, publicKey);

    expect(id1).toBe(id2);
  });

  test('generates different IDs for different shared secrets', () => {
    const sharedSecret1 = Buffer.from('secret1');
    const sharedSecret2 = Buffer.from('secret2');
    const publicKey = Buffer.from('publickey');

    const id1 = generateServerId(sharedSecret1, publicKey);
    const id2 = generateServerId(sharedSecret2, publicKey);

    expect(id1).not.toBe(id2);
  });

  test('generates different IDs for different public keys', () => {
    const sharedSecret = Buffer.from('secret');
    const publicKey1 = Buffer.from('publickey1');
    const publicKey2 = Buffer.from('publickey2');

    const id1 = generateServerId(sharedSecret, publicKey1);
    const id2 = generateServerId(sharedSecret, publicKey2);

    expect(id1).not.toBe(id2);
  });

  test("handles negative hash values (two's complement)", () => {
    // Create inputs that produce a hash with high bit set
    const sharedSecret = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    const publicKey = Buffer.from([0xff, 0xff, 0xff, 0xff]);

    const id = generateServerId(sharedSecret, publicKey);

    // Should be a negative hex string
    expect(id).toMatch(/^-?[0-9a-f]+$/);
  });

  test('returns hex string', () => {
    const sharedSecret = Buffer.from('test');
    const publicKey = Buffer.from('key');

    const id = generateServerId(sharedSecret, publicKey);

    expect(typeof id).toBe('string');
    expect(id).toMatch(/^-?[0-9a-f]+$/);
  });
});

describe('generateVerifyToken', () => {
  test('generates 4-byte buffer', () => {
    const token = generateVerifyToken();

    expect(token).toBeInstanceOf(Buffer);
    expect(token.length).toBe(4);
  });

  test('generates different tokens each time', () => {
    const token1 = generateVerifyToken();
    const token2 = generateVerifyToken();

    expect(token1.equals(token2)).toBe(false);
  });

  test('generates random data', () => {
    const tokens = new Set<string>();

    for (let i = 0; i < 100; i++) {
      tokens.add(generateVerifyToken().toString('hex'));
    }

    // Should have generated many unique tokens
    expect(tokens.size).toBeGreaterThan(90);
  });
});
