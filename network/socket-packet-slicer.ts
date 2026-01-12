import zlib from 'node:zlib';
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
    const compressionEnabled = (socket as any)._compressionEnabled;

    while (socket.readyState === 'open' || socket.readyState === 'opening') {
      try {
        const packetLength = varInt.readWithBytesCount(buffer);
        const totalLength = packetLength.bytesRead + packetLength.value;

        if (buffer.length < totalLength) {
          break;
        }

        if (compressionEnabled) {
          // Compressed packet format: [Packet Length][Data Length][Data]
          const dataLengthResult = varInt.readWithBytesCount(buffer.subarray(packetLength.bytesRead));
          const dataLength = dataLengthResult.value;
          const dataStart = packetLength.bytesRead + dataLengthResult.bytesRead;
          const compressedData = buffer.subarray(dataStart, totalLength);

          let uncompressedData: Buffer;
          if (dataLength === 0) {
            // Not compressed
            uncompressedData = compressedData;
          } else {
            // Decompress
            uncompressedData = zlib.inflateSync(compressedData);
          }

          const packetId = varInt.readWithBytesCount(uncompressedData);
          callback(packetId.value, uncompressedData.subarray(packetId.bytesRead));
        } else {
          // Uncompressed packet format: [Packet Length][Packet ID][Data]
          const packetId = varInt.readWithBytesCount(buffer.subarray(packetLength.bytesRead));
          callback(packetId.value, buffer.subarray(packetLength.bytesRead + packetId.bytesRead, totalLength));
        }

        buffer = buffer.subarray(totalLength);
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
