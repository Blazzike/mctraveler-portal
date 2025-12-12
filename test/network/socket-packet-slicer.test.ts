import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { SocketReadyState } from 'node:net';
import { string, unsignedShort, varInt } from '@/encoding/data-buffer';
import { definePacket, writePacket } from '@/network/defined-packet';
import { createSocketPacketSlicer } from '@/network/socket-packet-slicer';

class MockSocket extends EventEmitter {
  written: Buffer[] = [];
  readyState: SocketReadyState = 'open';

  write(data: Buffer): boolean {
    this.written.push(data);

    return true;
  }
}

const handshakePacketBuffer = writePacket(
  definePacket({
    id: 0x00,
    fields: {
      protocolVersion: varInt,
      serverAddress: string,
      serverPort: unsignedShort,
      state: varInt,
    },
  }),
  {
    protocolVersion: 0,
    serverAddress: 'hello world',
    serverPort: 25565,
    state: 0,
  }
);

const emptyPacketBuffer = writePacket(
  definePacket({
    id: 0x01,
    fields: {},
  }),
  {}
);

const withoutPacketLength = (buffer: Buffer) => {
  const packetLength = varInt.readWithBytesCount(buffer);
  const packetId = varInt.readWithBytesCount(buffer.subarray(packetLength.bytesRead));
  return buffer.subarray(packetLength.bytesRead + packetId.bytesRead);
};

test('createSocketPacketSlicer', async () => {
  const mockSocket = new MockSocket();
  const slicedPackets: Buffer[] = [];

  createSocketPacketSlicer(mockSocket, (_packetId, packetData) => {
    slicedPackets.push(packetData);
  });

  mockSocket.emit('data', handshakePacketBuffer);
  mockSocket.emit('data', emptyPacketBuffer);
  mockSocket.emit('data', Buffer.concat([handshakePacketBuffer, emptyPacketBuffer]));

  mockSocket.emit('data', handshakePacketBuffer.subarray(0, 5));
  mockSocket.emit('data', handshakePacketBuffer.subarray(5));

  mockSocket.emit('data', varInt(10));

  expect(slicedPackets).toEqual([
    withoutPacketLength(handshakePacketBuffer),
    withoutPacketLength(emptyPacketBuffer),
    withoutPacketLength(handshakePacketBuffer),
    withoutPacketLength(emptyPacketBuffer),
    withoutPacketLength(handshakePacketBuffer),
  ]);
});
