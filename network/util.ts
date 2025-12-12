import { forwardRawPacket } from '../defined-packets.gen';
import { writePacket } from './defined-packet';
import type { LazilyParsedPacket, SocketLike } from './types';

export function isSocketWritable(socket: SocketLike): boolean {
  return socket.readyState === 'open' || socket.readyState === 'writeOnly';
}

export function safeWrite(socket: SocketLike, data: Buffer): boolean {
  if (!isSocketWritable(socket)) {
    return false;
  }
  try {
    socket.write(data);
    return true;
  } catch {
    return false;
  }
}

export function forwardPacket(socket: SocketLike, packet: LazilyParsedPacket): boolean {
  if (!isSocketWritable(socket)) {
    return false;
  }
  const packetWithId = { ...forwardRawPacket, id: packet.packetId };
  return safeWrite(socket, writePacket(packetWithId, { raw: packet.packetData }));
}

export type Completer<T> = Promise<T> & {
  complete: (value: T) => void;
};

export function createCompleter<T>(): Completer<T> {
  let complete: ((value: T) => void) | null = null;

  const promise = new Promise<T>((res) => {
    complete = res;
  });

  return Object.assign(promise, {
    complete: complete!,
  });
}
