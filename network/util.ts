import { varInt } from '../encoding/data-buffer';
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
  const packetIdBuf = varInt(packet.packetId);
  const contentLength = packetIdBuf.length + packet.packetData.length;
  const lengthBuf = varInt(contentLength);
  const out = Buffer.allocUnsafe(lengthBuf.length + contentLength);
  lengthBuf.copy(out, 0);
  packetIdBuf.copy(out, lengthBuf.length);
  packet.packetData.copy(out, lengthBuf.length + packetIdBuf.length);
  return safeWrite(socket, out);
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
