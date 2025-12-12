import { encryptionRequestPacket, loginDisconnectPacket } from '@/defined-packets.gen';
import { anonymousNbt } from '@/encoding/data-buffer';
import type { Paint } from '@/feature-api/paint';
import { writePacket } from '@/network/defined-packet';

export { encryptionRequestPacket, encryptionResponsePacket, loginDisconnectPacket } from '@/defined-packets.gen';

/** Create Encryption Request packet. */
export function createEncryptionRequest(publicKey: Buffer, verifyToken: Buffer): Buffer {
  return writePacket(encryptionRequestPacket, {
    serverId: '',
    publicKey,
    verifyToken,
    shouldAuthenticate: true,
  });
}

/** Create Login Disconnect packet with formatted message. */
export function createLoginDisconnect(message: string | Paint): Buffer {
  const messageStr = typeof message === 'string' ? message : message.toString();
  const nbtMessage = anonymousNbt({ text: messageStr });

  return writePacket(loginDisconnectPacket, {
    reason: nbtMessage,
  });
}
