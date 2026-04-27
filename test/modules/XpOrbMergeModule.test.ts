import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import net from 'node:net';
import { spawnEntityPacket } from '@/defined-packets.gen';
import { enableModule, resetModules } from '@/module-api/module';
import XpOrbMergeModule from '@/modules/XpOrbMergeModule';
import { writePacket } from '@/network/defined-packet';
import { handleServerToClientPacket, type ProxyPlayer, resetHandlers } from '@/network/packet-handlers';

const EXPERIENCE_ORB_TYPE = 47;
const MERGE_DELAY_MS = 50;
const TEST_UUID = '01234567-89ab-cdef-0123-456789abcdef';

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

function createMockPlayer(clientSocket: net.Socket): ProxyPlayer {
  return {
    uuid: 'test-uuid',
    username: 'TestPlayer',
    clientSocket,
    serverSocket: new net.Socket(),
    serverPort: 25566,
    isPremium: true,
    offlineUuid: 'test-offline-uuid',
  };
}

function createXpOrbPacketData(entityId: number, xp: number, x = 0, y = 64, z = 0): Buffer {
  const packet = writePacket(spawnEntityPacket, {
    entityId,
    objectUUID: TEST_UUID,
    type: EXPERIENCE_ORB_TYPE,
    x,
    y,
    z,
    pitch: 0,
    yaw: 0,
    headPitch: 0,
    objectData: xp,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
  });

  const buf = packet;
  let offset = 0;
  // Skip two VarInts (packet length + packet id) to get raw packet data
  for (let i = 0; i < 2; i++) {
    while ((buf.readUInt8(offset++) & 0x80) !== 0) {}
  }

  return buf.subarray(offset);
}

function createNonXpEntityPacketData(entityId: number, entityType: number): Buffer {
  const packet = writePacket(spawnEntityPacket, {
    entityId,
    objectUUID: TEST_UUID,
    type: entityType,
    x: 0,
    y: 64,
    z: 0,
    pitch: 0,
    yaw: 0,
    headPitch: 0,
    objectData: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
  });

  const buf = packet;
  let offset = 0;
  // Skip two VarInts (packet length + packet id) to get raw packet data
  for (let i = 0; i < 2; i++) {
    while ((buf.readUInt8(offset++) & 0x80) !== 0) {}
  }

  return buf.subarray(offset);
}

describe('XpOrbMergeModule', () => {
  beforeAll(() => {
    resetHandlers();
    resetModules();
    enableModule(XpOrbMergeModule);
  });

  afterAll(() => {
    resetHandlers();
    resetModules();
  });

  test('ignores non-spawn-entity packets', () => {
    const socket = createMockSocket();
    const player = createMockPlayer(socket);

    const result = handleServerToClientPacket(player, 0xff, Buffer.alloc(10));
    expect(result).toBe(false);
  });

  test('ignores non-XP-orb entity spawns', () => {
    const socket = createMockSocket();
    const player = createMockPlayer(socket);

    const packetData = createNonXpEntityPacketData(100, 1);
    const result = handleServerToClientPacket(player, spawnEntityPacket.id, packetData);
    expect(result).toBe(false);
  });

  test('intercepts XP orb spawn packets', () => {
    const socket = createMockSocket();
    const player = createMockPlayer(socket);

    const packetData = createXpOrbPacketData(1, 10);
    const result = handleServerToClientPacket(player, spawnEntityPacket.id, packetData);
    expect(result).toBe(true);
  });

  test('merges multiple XP orbs within delay window', async () => {
    const socket = createMockSocket();
    const player = createMockPlayer(socket);

    const orb1Data = createXpOrbPacketData(1, 5, 100, 64, 200);
    const orb2Data = createXpOrbPacketData(2, 10, 100, 64, 200);
    const orb3Data = createXpOrbPacketData(3, 15, 100, 64, 200);

    handleServerToClientPacket(player, spawnEntityPacket.id, orb1Data);
    handleServerToClientPacket(player, spawnEntityPacket.id, orb2Data);
    handleServerToClientPacket(player, spawnEntityPacket.id, orb3Data);

    expect(socket.writtenData.length).toBe(0);

    await new Promise((r) => setTimeout(r, MERGE_DELAY_MS + 20));

    expect(socket.writtenData.length).toBe(1);
  });

  test('single XP orb is flushed after delay', async () => {
    const socket = createMockSocket();
    const player = createMockPlayer(socket);

    const orbData = createXpOrbPacketData(10, 42);
    handleServerToClientPacket(player, spawnEntityPacket.id, orbData);

    expect(socket.writtenData.length).toBe(0);

    await new Promise((r) => setTimeout(r, MERGE_DELAY_MS + 20));

    expect(socket.writtenData.length).toBe(1);
  });

  test('separate sockets get independent merging', async () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    const player1 = createMockPlayer(socket1);
    const player2 = createMockPlayer(socket2);

    handleServerToClientPacket(player1, spawnEntityPacket.id, createXpOrbPacketData(1, 5));
    handleServerToClientPacket(player2, spawnEntityPacket.id, createXpOrbPacketData(2, 10));

    await new Promise((r) => setTimeout(r, MERGE_DELAY_MS + 20));

    expect(socket1.writtenData.length).toBe(1);
    expect(socket2.writtenData.length).toBe(1);
  });
});
