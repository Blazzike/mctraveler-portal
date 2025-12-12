import { describe, expect, test } from 'bun:test';
import crypto from 'node:crypto';
import { createCipher, createDecipher, generateServerKeyPair, rsaDecrypt } from '../network/encryption';

describe('generateServerKeyPair', () => {
  test('generates RSA-1024 key pair', () => {
    const keyPair = generateServerKeyPair();

    expect(keyPair.publicKey).toBeInstanceOf(Buffer);
    expect(keyPair.publicKey.length).toBeGreaterThan(0);
    expect(keyPair.privateKey).toBeDefined();
  });

  test('generates different keys each time', () => {
    const keyPair1 = generateServerKeyPair();
    const keyPair2 = generateServerKeyPair();

    expect(keyPair1.publicKey.equals(keyPair2.publicKey)).toBe(false);
  });
});

describe('rsaDecrypt', () => {
  test('decrypts data encrypted by client', () => {
    const keyPair = generateServerKeyPair();
    const testData = Buffer.from('test secret', 'utf8');

    // Import the public key and encrypt test data
    const publicKey = crypto.createPublicKey({
      key: keyPair.publicKey,
      format: 'der',
      type: 'spki',
    });

    const encrypted = crypto.publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      testData
    );

    const decrypted = rsaDecrypt(keyPair.privateKey, encrypted);
    expect(decrypted.toString('utf8')).toBe('test secret');
  });
});

describe('CFB8 cipher', () => {
  test('encrypts and decrypts single byte', () => {
    const sharedSecret = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) sharedSecret[i] = i;

    const cipher = createCipher(sharedSecret);
    const decipher = createDecipher(sharedSecret);

    const plaintext = Buffer.from([0x42]);
    const ciphertext = cipher.update(plaintext);
    const decrypted = decipher.update(ciphertext);

    expect(decrypted[0]).toBe(0x42);
  });

  test('encrypts and decrypts multiple bytes', () => {
    const sharedSecret = Buffer.from('0123456789abcdef');

    const cipher = createCipher(sharedSecret);
    const decipher = createDecipher(sharedSecret);

    const plaintext = Buffer.from('Hello, World!');
    const ciphertext = cipher.update(plaintext);
    const decrypted = decipher.update(ciphertext);

    expect(decrypted.toString()).toBe('Hello, World!');
  });

  test('produces different ciphertext for same plaintext with different keys', () => {
    const key1 = Buffer.from('key1key1key1key1');
    const key2 = Buffer.from('key2key2key2key2');

    const cipher1 = createCipher(key1);
    const cipher2 = createCipher(key2);

    const plaintext = Buffer.from('test');
    const ciphertext1 = cipher1.update(plaintext);
    const ciphertext2 = cipher2.update(plaintext);

    expect(ciphertext1.equals(ciphertext2)).toBe(false);
  });

  test('maintains state across multiple updates', () => {
    const sharedSecret = Buffer.from('0123456789abcdef');

    const cipher = createCipher(sharedSecret);
    const decipher = createDecipher(sharedSecret);

    const part1 = Buffer.from('Hello');
    const part2 = Buffer.from(', ');
    const part3 = Buffer.from('World!');

    const encrypted1 = cipher.update(part1);
    const encrypted2 = cipher.update(part2);
    const encrypted3 = cipher.update(part3);

    const decrypted1 = decipher.update(encrypted1);
    const decrypted2 = decipher.update(encrypted2);
    const decrypted3 = decipher.update(encrypted3);

    const result = Buffer.concat([decrypted1, decrypted2, decrypted3]);
    expect(result.toString()).toBe('Hello, World!');
  });

  test('handles empty buffer', () => {
    const sharedSecret = Buffer.from('0123456789abcdef');

    const cipher = createCipher(sharedSecret);
    const decipher = createDecipher(sharedSecret);

    const plaintext = Buffer.alloc(0);
    const ciphertext = cipher.update(plaintext);
    const decrypted = decipher.update(ciphertext);

    expect(decrypted.length).toBe(0);
  });
});
