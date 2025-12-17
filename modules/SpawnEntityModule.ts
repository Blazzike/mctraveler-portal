import { uuid as uuidHandler, varInt as varIntHandler } from '@/encoding/data-buffer';
import { spawnEntityPacket } from '@/manual-packets';
import { defineModule } from '@/module-api/module';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import { onServerToClientTransform } from '@/network/packet-handlers';

const PLAYER_ENTITY_TYPE = 147;

function rewriteSpawnEntityUuid(packetData: Buffer): Buffer | null {
  try {
    let offset = 0;

    // Read entityId (varint)
    const entityIdResult = varIntHandler.readWithBytesCount(packetData.subarray(offset));
    offset += entityIdResult.bytesRead;

    // Read objectUUID (16 bytes)
    if (offset + 16 > packetData.length) return null;
    const offlineUUID = uuidHandler.read(packetData.subarray(offset));
    const uuidOffset = offset;
    offset += 16;

    // Read entity type (varint)
    const typeResult = varIntHandler.readWithBytesCount(packetData.subarray(offset));
    const entityType = typeResult.value;

    // Only rewrite UUID for player entities
    if (entityType !== PLAYER_ENTITY_TYPE) {
      return packetData;
    }

    // Look up online UUID from offline UUID
    const player = OnlinePlayersModule.api.getPlayerByOfflineUuid(offlineUUID);
    if (!player) {
      // No mapping found, keep original
      return packetData;
    }

    const onlineUUID = player.uuid;
    console.log(`[SpawnEntity] Rewriting player UUID: ${offlineUUID} -> ${onlineUUID}`);

    // Create new packet with rewritten UUID
    const newPacket = Buffer.concat([packetData.subarray(0, uuidOffset), uuidHandler(onlineUUID), packetData.subarray(uuidOffset + 16)]);

    return newPacket;
  } catch (error) {
    console.error('[SpawnEntity] Error rewriting UUID:', error);
    return null;
  }
}

export default defineModule({
  name: 'SpawnEntity',
  api: {
    rewriteSpawnEntityUuid,
  },
  onEnable: () => {
    onServerToClientTransform(spawnEntityPacket.id, (_player, _packetId, packetData) => {
      return rewriteSpawnEntityUuid(packetData);
    });
  },
});
