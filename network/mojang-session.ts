import crypto from 'node:crypto';

export interface MojangProfile {
  id: string;
  name: string;
  properties: Array<{
    name: string;
    value: string;
    signature?: string;
  }>;
}

/** Generate Minecraft server ID hash (SHA-1 with two's complement hex). */
export function generateServerId(sharedSecret: Buffer, publicKey: Buffer): string {
  const hash = crypto.createHash('sha1');
  hash.update('');
  hash.update(sharedSecret);
  hash.update(publicKey);

  const digest = hash.digest();
  let result = BigInt(`0x${digest.toString('hex')}`);
  const firstByte = digest[0];
  if (firstByte !== undefined && firstByte & 0x80) {
    result = -((~result & ((BigInt(1) << BigInt(160)) - BigInt(1))) + BigInt(1));
  }

  return result.toString(16);
}

/** Verify player session with Mojang. Returns profile if valid, null otherwise. */
export async function verifyMojangSession(username: string, serverId: string, playerIp?: string): Promise<MojangProfile | null> {
  try {
    const url = new URL('https://sessionserver.mojang.com/session/minecraft/hasJoined');
    url.searchParams.set('username', username);
    url.searchParams.set('serverId', serverId);

    if (playerIp) {
      url.searchParams.set('ip', playerIp);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 204 || response.status === 403) {
        return null;
      }
      console.error(`[Mojang Auth] HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    return (await response.json()) as MojangProfile;
  } catch (error) {
    console.error('[Mojang Auth] Failed to verify session:', error);
    return null;
  }
}

/** Generate 4-byte random verification token. */
export function generateVerifyToken(): Buffer {
  return crypto.randomBytes(4);
}
