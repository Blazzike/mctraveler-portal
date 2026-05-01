import { playerRemovePacket, spawnEntityPacket } from '@/defined-packets.gen';
import { anonymousNbt, string as stringHandler, uuid as uuidHandler, varInt as varIntHandler } from '@/encoding/data-buffer';
import { log } from '@/logging';
import { playerInfoUpdatePacket } from '@/manual-packets';
import { defineModule } from '@/module-api/module';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import TabListModule from '@/modules/TabListModule';
import { onServerToClientTransform } from '@/network/packet-handlers';

const stringEncoder = stringHandler;
const varIntEncoder = varIntHandler;
const readVarIntAt = (buffer: Buffer, offset: number) => {
  const result = varIntHandler.readWithBytesCount(buffer.subarray(offset));
  return { value: result.value, offset: offset + result.bytesRead };
};

const FLAGS = {
  ADD_PLAYER: 0x01,
  INITIALIZE_CHAT: 0x02,
  UPDATE_GAME_MODE: 0x04,
  UPDATE_LISTED: 0x08,
  UPDATE_LATENCY: 0x10,
  UPDATE_DISPLAY_NAME: 0x20,
  UPDATE_HAT: 0x40,
  UPDATE_LIST_ORDER: 0x80,
};

import p, { type Paint } from '@/feature-api/paint';
import { safeWrite } from '@/network/util';

function sendDisplayNameUpdate(socket: any, uuidBuffer: Buffer, paint: Paint) {
  const FLAGS_DISPLAY_NAME = 0x20;
  const parts: Buffer[] = [];
  parts.push(Buffer.from([FLAGS_DISPLAY_NAME]));
  parts.push(varIntEncoder(1));
  parts.push(uuidBuffer);
  parts.push(Buffer.from([0x01])); // hasDisplayName
  parts.push(anonymousNbt(paint.toNbtObject()));

  const content = Buffer.concat(parts);
  const packetIdBuf = varIntEncoder(playerInfoUpdatePacket.id);
  const packetContent = Buffer.concat([packetIdBuf, content]);
  const fullPacket = Buffer.concat([varIntEncoder(packetContent.length), packetContent]);
  safeWrite(socket, fullPacket);
}

function rebuildPlayerInfoBitflags(packetData: Buffer, _player?: any): Buffer | null {
  try {
    let offset = 0;

    if (offset >= packetData.length) return null;
    const flags = packetData[offset];
    if (flags === undefined) return null;
    offset++;

    const numPlayersResult = varIntHandler.readWithBytesCount(packetData.subarray(offset));
    const numPlayers = numPlayersResult.value;
    offset += numPlayersResult.bytesRead;

    let modifiedFlags = flags;
    if (flags & FLAGS.INITIALIZE_CHAT) {
      const estimatedMinSize = numPlayers * 17;
      if (packetData.length < estimatedMinSize + 40) {
        modifiedFlags = flags & ~FLAGS.INITIALIZE_CHAT;
      }
    }

    const newPacketParts: Buffer[] = [];
    newPacketParts.push(Buffer.from([modifiedFlags]));
    newPacketParts.push(varIntEncoder(numPlayers));

    for (let i = 0; i < numPlayers; i++) {
      if (offset + 16 > packetData.length) return null;
      const offlineUUID = uuidHandler.read(packetData.subarray(offset));
      const player = OnlinePlayersModule.api.getPlayerByOfflineUuid(offlineUUID);
      const onlineUUID = player?.uuid;
      offset += 16;

      const finalUUID = onlineUUID || offlineUUID;
      newPacketParts.push(uuidHandler(finalUUID));

      if (flags & FLAGS.ADD_PLAYER) {
        const nameLenResult = readVarIntAt(packetData, offset);
        const nameLen = nameLenResult.value;
        offset = nameLenResult.offset;
        const nameBytes = packetData.subarray(offset, offset + nameLen);
        offset += nameLen;
        newPacketParts.push(varIntEncoder(nameLen));
        newPacketParts.push(nameBytes);

        const oldPropsResult = readVarIntAt(packetData, offset);
        const oldPropsCount = oldPropsResult.value;
        offset = oldPropsResult.offset;

        for (let p = 0; p < oldPropsCount; p++) {
          const propNameLenResult = readVarIntAt(packetData, offset);
          offset = propNameLenResult.offset + propNameLenResult.value;

          const propValueLenResult = readVarIntAt(packetData, offset);
          offset = propValueLenResult.offset + propValueLenResult.value;

          if (offset >= packetData.length) return null;
          const hasSig = packetData[offset];
          if (hasSig === undefined) return null;
          offset++;

          if (hasSig) {
            const sigLenResult = readVarIntAt(packetData, offset);
            offset = sigLenResult.offset + sigLenResult.value;
          }
        }

        const mojangProps = onlineUUID ? TabListModule.api.getProfileProperties(onlineUUID) : null;
        log.for('Skin').debug('offlineUUID=%s, onlineUUID=%s, props=%d', offlineUUID, onlineUUID, mojangProps?.length ?? 0);
        if (mojangProps && mojangProps.length > 0) {
          newPacketParts.push(varIntEncoder(mojangProps.length));

          for (const prop of mojangProps) {
            newPacketParts.push(stringEncoder(prop.name));
            newPacketParts.push(stringEncoder(prop.value));
            if (prop.signature) {
              newPacketParts.push(Buffer.from([0x01]));
              newPacketParts.push(stringEncoder(prop.signature));
            } else {
              newPacketParts.push(Buffer.from([0x00]));
            }
          }
        } else {
          newPacketParts.push(varIntEncoder(0));
        }
      }

      if (modifiedFlags & FLAGS.INITIALIZE_CHAT) {
        if (offset + 16 > packetData.length) return null;
        const sessionId = packetData.subarray(offset, offset + 16);
        offset += 16;
        newPacketParts.push(sessionId);

        if (offset + 8 > packetData.length) return null;
        const expiry = packetData.subarray(offset, offset + 8);
        offset += 8;
        newPacketParts.push(expiry);

        const keyLenResult = readVarIntAt(packetData, offset);
        const keyLen = keyLenResult.value;
        offset = keyLenResult.offset;
        newPacketParts.push(varIntEncoder(keyLen));

        if (offset + keyLen > packetData.length) return null;
        const keyBytes = packetData.subarray(offset, offset + keyLen);
        offset += keyLen;
        newPacketParts.push(keyBytes);

        const sigLenResult = readVarIntAt(packetData, offset);
        const sigLen = sigLenResult.value;
        offset = sigLenResult.offset;
        newPacketParts.push(varIntEncoder(sigLen));

        if (offset + sigLen > packetData.length) return null;
        const sigBytes = packetData.subarray(offset, offset + sigLen);
        offset += sigLen;
        newPacketParts.push(sigBytes);
      }

      if (flags & FLAGS.UPDATE_GAME_MODE) {
        const gamemodeResult = readVarIntAt(packetData, offset);
        newPacketParts.push(varIntEncoder(gamemodeResult.value));
        offset = gamemodeResult.offset;
      }

      if (flags & FLAGS.UPDATE_LISTED) {
        if (offset >= packetData.length) return null;
        const listed = packetData[offset];
        if (listed === undefined) return null;
        newPacketParts.push(Buffer.from([listed]));
        offset++;
      }

      if (flags & FLAGS.UPDATE_LATENCY) {
        const pingResult = readVarIntAt(packetData, offset);
        const pingValue = pingResult.value;
        newPacketParts.push(varIntEncoder(pingValue));
        offset = pingResult.offset;

        if (player && _player) {
          const namePaint = p`${p.green(player.username)} ${p.darkGray(`[${pingValue}ms]`)}`;
          sendDisplayNameUpdate(_player.clientSocket, uuidHandler(finalUUID), namePaint);
        }
      }

      if (flags & FLAGS.UPDATE_DISPLAY_NAME) {
        if (offset >= packetData.length) return null;
        const hasDisplayName = packetData[offset];
        if (hasDisplayName === undefined) return null;
        newPacketParts.push(Buffer.from([hasDisplayName]));
        offset++;

        if (hasDisplayName) {
          const nbtResult = anonymousNbt.readWithBytesCount(packetData.subarray(offset));
          const nbtBuffer = anonymousNbt(nbtResult.value);
          newPacketParts.push(nbtBuffer);
          offset += nbtResult.bytesRead;
        }
      }

      if (flags & FLAGS.UPDATE_HAT) {
        const hatResult = readVarIntAt(packetData, offset);
        newPacketParts.push(varIntEncoder(hatResult.value));
        offset = hatResult.offset;
      }

      if (flags & FLAGS.UPDATE_LIST_ORDER) {
        const orderResult = readVarIntAt(packetData, offset);
        newPacketParts.push(varIntEncoder(orderResult.value));
        offset = orderResult.offset;
      }
    }

    return Buffer.concat(newPacketParts);
  } catch (error) {
    log.for('PlayerInfo').error('Error rebuilding packet: %s', error);
    return null;
  }
}

function rebuildSpawnEntity(packetData: Buffer): Buffer | null {
  try {
    const idResult = varIntHandler.readWithBytesCount(packetData);
    const offset = idResult.bytesRead;
    if (offset + 16 <= packetData.length) {
      const originalUuid = uuidHandler.read(packetData.subarray(offset));
      const player = OnlinePlayersModule.api.getPlayerByOfflineUuid(originalUuid);
      if (player) {
        const onlineUuidBuffer = uuidHandler(player.uuid);
        return Buffer.concat([packetData.subarray(0, offset), onlineUuidBuffer, packetData.subarray(offset + 16)]);
      }
    }
  } catch (e) {
    log.for('PlayerInfo').error('Error rebuilding spawn entity packet: %s', e);
  }
  return packetData;
}

function rebuildPlayerRemovePacket(packetData: Buffer): Buffer | null {
  try {
    let offset = 0;
    const countResult = varIntHandler.readWithBytesCount(packetData);
    const count = countResult.value;
    offset += countResult.bytesRead;

    const newPacketParts: Buffer[] = [];
    newPacketParts.push(packetData.subarray(0, offset));

    let changed = false;
    for (let i = 0; i < count; i++) {
      if (offset + 16 > packetData.length) return packetData;
      const originalUuid = uuidHandler.read(packetData.subarray(offset));
      const player = OnlinePlayersModule.api.getPlayerByOfflineUuid(originalUuid);
      if (player) {
        newPacketParts.push(uuidHandler(player.uuid));
        changed = true;
      } else {
        newPacketParts.push(packetData.subarray(offset, offset + 16));
      }
      offset += 16;
    }
    if (changed) {
      return Buffer.concat(newPacketParts);
    }
  } catch (e) {
    log.for('PlayerInfo').error('Error rebuilding player remove packet: %s', e);
  }
  return packetData;
}

export default defineModule({
  name: 'PlayerInfoBitflags',
  api: {
    rebuildPlayerInfoBitflags,
  },
  onEnable: () => {
    onServerToClientTransform(playerInfoUpdatePacket.id, (_player, _packetId, packetData) => {
      return rebuildPlayerInfoBitflags(packetData, _player);
    });

    onServerToClientTransform(spawnEntityPacket.id, (_player, _packetId, packetData) => {
      return rebuildSpawnEntity(packetData);
    });

    onServerToClientTransform(playerRemovePacket.id, (_player, _packetId, packetData) => {
      return rebuildPlayerRemovePacket(packetData);
    });
  },
});
