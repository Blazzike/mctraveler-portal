import { varInt } from '../encoding/data-buffer';
import type { SocketLike } from './types';

export function createSocketPacketSlicer(socket: SocketLike, callback: (packetId: number, packetData: Buffer) => void) {
  let buffer = Buffer.alloc(0);

  const dataHandler = (data: Buffer) => {
    let processedData = data;
    if ((socket as any)._encryptionEnabled && (socket as any)._encryptionDecipher) {
      const decipher = (socket as any)._encryptionDecipher;
      processedData = decipher.update(data);
    }

    buffer = Buffer.concat([buffer, processedData]);
    while (socket.readyState === 'open' || socket.readyState === 'opening') {
      try {
        const packetLength = varInt.readWithBytesCount(buffer);
        if (buffer.length < packetLength.bytesRead + packetLength.value) {
          break;
        }

        const packetId = varInt.readWithBytesCount(buffer.subarray(packetLength.bytesRead));
        callback(packetId.value, buffer.subarray(packetLength.bytesRead + packetId.bytesRead, packetLength.bytesRead + packetLength.value));
        buffer = buffer.subarray(packetLength.bytesRead + packetLength.value);
      } catch (e) {
        if (e instanceof RangeError) {
          break;
        }

        throw e;
      }
    }
  };

  socket.on('data', dataHandler);

  return () => {
    socket.off('data', dataHandler);
  };
}
