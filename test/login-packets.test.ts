import { describe, expect, test } from 'bun:test';
import p from '@/feature-api/paint';
import { createEncryptionRequest, createLoginDisconnect } from '../network/login-packets';

describe('createEncryptionRequest', () => {
  test('creates valid packet', () => {
    const publicKey = Buffer.from('test-public-key');
    const verifyToken = Buffer.from('1234');

    const packet = createEncryptionRequest(publicKey, verifyToken);

    expect(packet).toBeInstanceOf(Buffer);
    expect(packet.length).toBeGreaterThan(0);
  });

  test('includes packet ID 0x01', () => {
    const publicKey = Buffer.from('key');
    const verifyToken = Buffer.from('tok');

    const packet = createEncryptionRequest(publicKey, verifyToken);

    // Skip length prefix and check packet ID
    let offset = 0;
    let position = 0;
    let currentByte: number;

    do {
      currentByte = packet.readUInt8(offset);
      offset++;
      position++;
    } while ((currentByte & 0x80) !== 0);

    // Skip packet length, read packet ID
    let packetId = 0;
    position = 0;

    do {
      currentByte = packet.readUInt8(offset);
      packetId |= (currentByte & 0x7f) << (7 * position);
      offset++;
      position++;
    } while ((currentByte & 0x80) !== 0);

    expect(packetId).toBe(0x01);
  });

  test('handles different key sizes', () => {
    const smallKey = Buffer.from('small');
    const largeKey = Buffer.alloc(128).fill(0xab);
    const token = Buffer.from('test');

    const packet1 = createEncryptionRequest(smallKey, token);
    const packet2 = createEncryptionRequest(largeKey, token);

    expect(packet1.length).toBeLessThan(packet2.length);
  });
});

describe('createLoginDisconnect', () => {
  test('creates packet from string', () => {
    const packet = createLoginDisconnect('Disconnected');

    expect(packet).toBeInstanceOf(Buffer);
    expect(packet.length).toBeGreaterThan(0);
  });

  test('creates packet from Paint', () => {
    const message = p.error`Connection failed`;
    const packet = createLoginDisconnect(message);

    expect(packet).toBeInstanceOf(Buffer);
    expect(packet.length).toBeGreaterThan(0);
  });

  test('includes packet ID 0x00', () => {
    const packet = createLoginDisconnect('test');

    // Skip length prefix and check packet ID
    let offset = 0;
    let position = 0;
    let currentByte: number;

    do {
      currentByte = packet.readUInt8(offset);
      offset++;
      position++;
    } while ((currentByte & 0x80) !== 0);

    // Skip packet length, read packet ID
    let packetId = 0;
    position = 0;

    do {
      currentByte = packet.readUInt8(offset);
      packetId |= (currentByte & 0x7f) << (7 * position);
      offset++;
      position++;
    } while ((currentByte & 0x80) !== 0);

    expect(packetId).toBe(0x00);
  });

  test('handles empty message', () => {
    const packet = createLoginDisconnect('');

    expect(packet).toBeInstanceOf(Buffer);
    expect(packet.length).toBeGreaterThan(0);
  });

  test('handles long message', () => {
    const longMessage = 'A'.repeat(1000);
    const packet = createLoginDisconnect(longMessage);

    expect(packet).toBeInstanceOf(Buffer);
    expect(packet.length).toBeGreaterThan(100);
  });
});
