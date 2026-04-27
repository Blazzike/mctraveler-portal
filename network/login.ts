import { kPrimaryPort, kSecondaryPort } from '@/config';
import { string, varInt } from '@/encoding/data-buffer';

export function parseLoginStart(packetData: Buffer): { username: string; uuid: string | null } {
  const username = string.read(packetData);
  let uuid: string | null = null;
  try {
    const usernameLength = varInt.readWithBytesCount(packetData);
    const offset = usernameLength.bytesRead + usernameLength.value;
    const hasUuid = packetData[offset] === 1;
    if (hasUuid) {
      const uuidBytes = packetData.subarray(offset + 1, offset + 17);
      uuid = [
        uuidBytes.subarray(0, 4).toString('hex'),
        uuidBytes.subarray(4, 6).toString('hex'),
        uuidBytes.subarray(6, 8).toString('hex'),
        uuidBytes.subarray(8, 10).toString('hex'),
        uuidBytes.subarray(10, 16).toString('hex'),
      ].join('-');
    }
  } catch {
    // UUID field is optional in Login Start (pre-1.20.2), ignore parse errors
  }
  return { username, uuid };
}

export function parseLoginSuccess(packetData: Buffer): { uuid: string; username: string } {
  const uuidBytes = packetData.subarray(0, 16);
  const uuid = [
    uuidBytes.subarray(0, 4).toString('hex'),
    uuidBytes.subarray(4, 6).toString('hex'),
    uuidBytes.subarray(6, 8).toString('hex'),
    uuidBytes.subarray(8, 10).toString('hex'),
    uuidBytes.subarray(10, 16).toString('hex'),
  ].join('-');
  const username = string.read(packetData.subarray(16));
  return { uuid, username };
}

export function resolvePort(name?: 'primary' | 'secondary'): number {
  return name === 'secondary' ? kSecondaryPort : kPrimaryPort;
}

export function formatUuidWithDashes(uuid: string): string {
  const hex = uuid.replace(/-/g, '');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
