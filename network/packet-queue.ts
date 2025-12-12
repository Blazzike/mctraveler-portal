import { type DefinedPacket, readPacketFields } from './defined-packet';
import { createSocketPacketSlicer } from './socket-packet-slicer';
import type { LazilyParsedPacket, SocketLike } from './types';
import { type Completer, createCompleter } from './util';

type PacketInfo = {
  packetId: number;
  packetData: Buffer;
};

export type PacketQueue = {
  expect: (definedPacket: DefinedPacket) => Promise<any>;
  next: () => Promise<PacketInfo>;
  onPacket: (callback: (packet: LazilyParsedPacket) => void | Promise<void>) => void;
};

export function createPacketQueue(socket: SocketLike): PacketQueue {
  const queue: PacketInfo[] = [];

  let nextCompleter: Completer<PacketInfo> | null = null;

  createSocketPacketSlicer(socket, (packetId, packetData) => {
    if (nextCompleter != null) {
      nextCompleter.complete({ packetId, packetData });
      nextCompleter = null;
    } else {
      queue.push({ packetId, packetData });
    }
  });

  const next: () => Promise<PacketInfo> = () => {
    if (nextCompleter != null) {
      throw new Error('Next completer already exists, this is a logical error');
    }

    if (queue.length > 0) {
      return Promise.resolve(queue.shift()!);
    }

    nextCompleter = createCompleter<PacketInfo>();

    return nextCompleter;
  };

  return {
    next,
    onPacket: (callback: (packet: LazilyParsedPacket) => void | Promise<void>) => {
      (async () => {
        while (socket.readyState === 'open' || socket.readyState === 'opening') {
          const { packetId, packetData } = await next();
          await callback({ packetId, packetData });
        }

        console.debug('Socket closed');
      })().catch((e) => {
        console.error('error in onPacket', e);
      });
    },
    expect: async (definedPacket: DefinedPacket) => {
      const nextPacket = await next();

      if (nextPacket.packetId !== definedPacket.id) {
        throw new Error(`Expected packet ID ${definedPacket.id}, got ${nextPacket.packetId}`);
      }

      return readPacketFields(definedPacket.fields, nextPacket.packetData);
    },
  };
}
