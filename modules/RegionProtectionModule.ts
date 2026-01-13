import { blockChangePacket } from '@/defined-packets.gen';
import { executeHookFirst, FeatureHook } from '@/feature-api/manager';
import { defineModule } from '@/module-api/module';
import OnlinePlayersModule from '@/modules/OnlinePlayersModule';
import { onServerToClientPacket } from '@/network/packet-handlers';
import { getWorldForPlayer } from '@/util/world';

// Packet IDs (1.21.x)
const EXPLOSION_PACKET_ID = 0x24;
const BLOCK_CHANGE_PACKET_ID = blockChangePacket.id;

function decodeBlockPosition(buffer: Buffer, offset: number): { x: number; y: number; z: number } {
  const val = buffer.readBigInt64BE(offset);
  let x = Number(val >> 38n);
  let z = Number((val >> 12n) & 0x3ffffffn);
  let y = Number(val & 0xfffn);

  if (x >= 0x2000000) x -= 0x4000000;
  if (z >= 0x2000000) z -= 0x4000000;
  if (y >= 0x800) y -= 0x1000;

  return { x, y, z };
}

export default defineModule({
  name: 'RegionProtection',
  api: {},
  onEnable: () => {
    onServerToClientPacket((proxyPlayer, packetId, packetData) => {
      const onlinePlayer = OnlinePlayersModule.api.getOnlinePlayer(proxyPlayer.uuid);
      if (!onlinePlayer) return false;

      const world = getWorldForPlayer(onlinePlayer);

      // Handle explosion packets - block if in protected region without ENABLE_EXPLOSIONS
      if (packetId === EXPLOSION_PACKET_ID) {
        try {
          // Explosion packet: x (f64), y (f64), z (f64), ...
          const x = packetData.readDoubleBE(0);
          const y = packetData.readDoubleBE(8);
          const z = packetData.readDoubleBE(16);

          const shouldBlock = executeHookFirst<boolean>(FeatureHook.CheckExplosionProtection, {
            position: { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) },
            world,
          });

          if (shouldBlock) {
            return true; // Block the explosion packet
          }
        } catch (e) {
          console.error('[RegionProtection] Failed to parse explosion packet:', e);
        }
      }

      // Handle block change packets - block destruction in protected regions
      if (packetId === BLOCK_CHANGE_PACKET_ID) {
        try {
          // Block change: position (8 bytes), type (varint)
          const pos = decodeBlockPosition(packetData, 0);

          // Read block type (varint at offset 8)
          let blockType = 0;
          let shift = 0;
          let offset = 8;
          let byte: number;
          do {
            byte = packetData[offset++]!;
            blockType |= (byte & 0x7f) << shift;
            shift += 7;
          } while (byte & 0x80);

          // Block state 0 = air (block destruction)
          // Also check for fire blocks being placed (block states around 2312-2323 for fire)
          const isDestruction = blockType === 0;
          const isFire = blockType >= 2312 && blockType <= 2323;

          if (isDestruction) {
            const shouldBlock = executeHookFirst<boolean>(FeatureHook.CheckBlockDestructionProtection, {
              position: pos,
              world,
            });

            if (shouldBlock) {
              return true; // Block the block destruction
            }
          }

          if (isFire) {
            const shouldBlock = executeHookFirst<boolean>(FeatureHook.CheckFireSpreadProtection, {
              position: pos,
              world,
            });

            if (shouldBlock) {
              return true; // Block fire placement
            }
          }
        } catch (e) {
          console.error('[RegionProtection] Failed to parse block change packet:', e);
        }
      }

      return false;
    });
  },
});
