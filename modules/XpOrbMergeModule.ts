import type net from 'node:net';
import { spawnEntityPacket } from '@/defined-packets.gen';
import { defineModule } from '@/module-api/module';
import { readPacketFields, writePacket } from '@/network/defined-packet';
import { onServerToClientPacket } from '@/network/packet-handlers';
import { safeWrite } from '@/network/util';

const EXPERIENCE_ORB_TYPE = 47;
const MERGE_DELAY_MS = 50;

type PendingOrbs = {
  totalXp: number;
  x: number;
  y: number;
  z: number;
  entityId: number;
  objectUUID: string;
  timer: ReturnType<typeof setTimeout>;
};

const pendingOrbs = new WeakMap<net.Socket, PendingOrbs>();

function flushOrbs(socket: net.Socket, pending: PendingOrbs): void {
  pendingOrbs.delete(socket);

  const packet = writePacket(spawnEntityPacket, {
    entityId: pending.entityId,
    objectUUID: pending.objectUUID,
    type: EXPERIENCE_ORB_TYPE,
    x: pending.x,
    y: pending.y,
    z: pending.z,
    pitch: 0,
    yaw: 0,
    headPitch: 0,
    objectData: pending.totalXp,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
  });

  safeWrite(socket, packet);
}

export default defineModule({
  name: 'XpOrbMerge',
  api: {},
  onEnable: () => {
    onServerToClientPacket((player, packetId, packetData) => {
      if (packetId !== spawnEntityPacket.id) return false;

      let parsed: ReturnType<typeof readPacketFields<typeof spawnEntityPacket.fields>>;
      try {
        parsed = readPacketFields(spawnEntityPacket.fields, packetData);
      } catch {
        return false;
      }

      if (parsed.type !== EXPERIENCE_ORB_TYPE) return false;

      const socket = player.clientSocket;
      const existing = pendingOrbs.get(socket);
      if (existing) {
        clearTimeout(existing.timer);
        existing.totalXp += parsed.objectData;
        existing.timer = setTimeout(() => flushOrbs(socket, existing), MERGE_DELAY_MS);
      } else {
        const pending: PendingOrbs = {
          totalXp: parsed.objectData,
          x: parsed.x,
          y: parsed.y,
          z: parsed.z,
          entityId: parsed.entityId,
          objectUUID: parsed.objectUUID,
          timer: setTimeout(() => {}, 0),
        };
        pending.timer = setTimeout(() => flushOrbs(socket, pending), MERGE_DELAY_MS);
        pendingOrbs.set(socket, pending);
      }

      return true;
    });
  },
});
