import { byte, restBuffer } from '@/encoding/data-buffer';
import { definePacket } from '@/network/defined-packet';

export const playerInfoUpdatePacket = definePacket({
  id: 0x44,
  fields: {
    actions: byte,
    data: restBuffer,
  },
});

export const spawnEntityPacket = definePacket({
  id: 0x01,
  fields: {
    data: restBuffer,
  },
});
