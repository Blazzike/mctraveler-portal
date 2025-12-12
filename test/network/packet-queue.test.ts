import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { SocketReadyState } from 'node:net';
import { string, varInt } from '@/encoding/data-buffer';
import { definePacket, writePacket } from '@/network/defined-packet';
import { createPacketQueue } from '@/network/packet-queue';

class MockSocket extends EventEmitter {
  readyState: SocketReadyState = 'open';

  write(_data: Buffer): boolean {
    return true;
  }
}

test('createPacketQueue > next', async () => {
  const mockSocket = new MockSocket();
  const queue = createPacketQueue(mockSocket as any);

  const testPacket = writePacket(
    definePacket({
      id: 0x05,
      fields: { text: string },
    }),
    { text: 'hello' }
  );

  mockSocket.emit('data', testPacket);

  const packet = await queue.next();
  expect(packet.packetId).toBe(0x05);
});

test('createPacketQueue > expect matching packet', async () => {
  const mockSocket = new MockSocket();
  const queue = createPacketQueue(mockSocket as any);

  const definedPacket = definePacket({
    id: 0x42,
    fields: { value: varInt },
  });

  const testPacket = writePacket(definedPacket, { value: 123 });

  mockSocket.emit('data', testPacket);

  const result = await queue.expect(definedPacket);
  expect(result.value).toBe(123);
});

test('createPacketQueue > expect wrong packet throws', async () => {
  const mockSocket = new MockSocket();
  const queue = createPacketQueue(mockSocket as any);

  const expectedPacket = definePacket({
    id: 0x42,
    fields: {},
  });

  const wrongPacket = writePacket(
    definePacket({
      id: 0x99,
      fields: {},
    }),
    {}
  );

  mockSocket.emit('data', wrongPacket);

  await expect(queue.expect(expectedPacket)).rejects.toThrow('Expected packet ID 66, got 153');
});

test('createPacketQueue > onPacket callback', async () => {
  const mockSocket = new MockSocket();
  const queue = createPacketQueue(mockSocket as any);

  const receivedPackets: number[] = [];

  queue.onPacket((packet) => {
    receivedPackets.push(packet.packetId);
  });

  mockSocket.emit(
    'data',
    writePacket(
      definePacket({
        id: 0x01,
        fields: {},
      }),
      {}
    )
  );

  mockSocket.emit(
    'data',
    writePacket(
      definePacket({
        id: 0x02,
        fields: {},
      }),
      {}
    )
  );

  await new Promise((resolve) => setTimeout(resolve, 10));

  expect(receivedPackets).toEqual([1, 2]);
});
