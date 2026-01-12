import zlib from 'node:zlib';
import { varInt } from '../encoding/data-buffer';

// Default compression threshold (256 bytes, same as vanilla)
export const DEFAULT_COMPRESSION_THRESHOLD = 256;

/**
 * Compress a packet for sending to client.
 * Format: [Packet Length][Data Length][Packet ID + Data]
 * - If uncompressed: Data Length = 0, data is raw
 * - If compressed: Data Length = uncompressed size, data is zlib compressed
 */
export function compressPacket(packetId: number, packetData: Buffer, threshold: number): Buffer {
  const packetIdBuf = varInt(packetId);
  const uncompressedData = Buffer.concat([packetIdBuf, packetData]);
  const uncompressedLength = uncompressedData.length;

  if (uncompressedLength < threshold) {
    // Don't compress - Data Length = 0
    const dataLength = varInt(0);
    const packetLength = varInt(dataLength.length + uncompressedData.length);
    return Buffer.concat([packetLength, dataLength, uncompressedData]);
  }

  // Compress the data
  const compressed = zlib.deflateSync(uncompressedData, { level: zlib.constants.Z_DEFAULT_COMPRESSION });
  const dataLength = varInt(uncompressedLength);
  const packetLength = varInt(dataLength.length + compressed.length);
  return Buffer.concat([packetLength, dataLength, compressed]);
}

/**
 * Decompress a packet received from client.
 * Returns { packetId, packetData } or null if packet incomplete.
 */
export function decompressPacket(
  buffer: Buffer,
  threshold: number
): { packetId: number; packetData: Buffer; bytesRead: number } | null {
  try {
    // Read packet length
    const packetLength = varInt.readWithBytesCount(buffer);
    const totalLength = packetLength.bytesRead + packetLength.value;

    if (buffer.length < totalLength) {
      return null; // Incomplete packet
    }

    // Read data length (0 = uncompressed, >0 = compressed size)
    const dataLengthResult = varInt.readWithBytesCount(buffer.subarray(packetLength.bytesRead));
    const dataLength = dataLengthResult.value;

    const dataStart = packetLength.bytesRead + dataLengthResult.bytesRead;
    const compressedData = buffer.subarray(dataStart, totalLength);

    let uncompressedData: Buffer;
    if (dataLength === 0) {
      // Not compressed
      uncompressedData = compressedData;
    } else {
      // Compressed - decompress
      uncompressedData = zlib.inflateSync(compressedData);
      if (uncompressedData.length !== dataLength) {
        throw new Error(`Decompressed size mismatch: expected ${dataLength}, got ${uncompressedData.length}`);
      }
    }

    // Parse packet ID from uncompressed data
    const packetIdResult = varInt.readWithBytesCount(uncompressedData);
    const packetId = packetIdResult.value;
    const packetData = uncompressedData.subarray(packetIdResult.bytesRead);

    return { packetId, packetData, bytesRead: totalLength };
  } catch (e) {
    if (e instanceof RangeError) {
      return null; // Incomplete packet
    }
    throw e;
  }
}

/**
 * Create Set Compression packet (0x03 in login state)
 */
export function createSetCompressionPacket(threshold: number): Buffer {
  const packetId = varInt(0x03);
  const thresholdBuf = varInt(threshold);
  const content = Buffer.concat([packetId, thresholdBuf]);
  return Buffer.concat([varInt(content.length), content]);
}

/**
 * Enable compression on a socket.
 * Wraps write() to compress outgoing packets and stores threshold for incoming decompression.
 */
export function enableCompression(socket: any, threshold: number): void {
  socket._compressionThreshold = threshold;
  socket._compressionEnabled = true;

  // Wrap write to compress outgoing packets
  const originalWrite = socket.write.bind(socket);
  socket._originalWrite = originalWrite;

  socket.write = (data: Buffer, ...args: any[]) => {
    // Data is already in packet format [length][id][data]
    // We need to re-wrap it with compression format
    try {
      const packetLength = varInt.readWithBytesCount(data);
      const packetIdResult = varInt.readWithBytesCount(data.subarray(packetLength.bytesRead));
      const packetId = packetIdResult.value;
      const packetData = data.subarray(packetLength.bytesRead + packetIdResult.bytesRead);

      const compressed = compressPacket(packetId, packetData, threshold);
      return originalWrite(compressed, ...args);
    } catch (e) {
      // If parsing fails, just send raw (shouldn't happen)
      console.error('[Compression] Failed to compress packet:', e);
      return originalWrite(data, ...args);
    }
  };
}
