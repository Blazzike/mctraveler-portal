import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as nbt from 'prismarine-nbt';
import { defineModule } from '@/module-api/module';

const SERVERS_BASE = 'minecraft-server';

function getServerDir(port: number): string {
  if (port === 25566) return join(SERVERS_BASE, 'primary');
  if (port === 25567) return join(SERVERS_BASE, 'secondary');
  throw new Error(`Unknown server port: ${port}`);
}

function getPlayerDataPath(port: number, uuid: string): string {
  return join(getServerDir(port), 'world', 'playerdata', `${uuid}.dat`);
}

const SYNC_TAGS = [
  'Inventory',
  'EnderItems',
  'equipment',
  'XpLevel',
  'XpP',
  'XpTotal',
  'foodLevel',
  'foodExhaustionLevel',
  'foodSaturationLevel',
  'foodTickTimer',
  'Health',
  'Score',
  'AbsorptionAmount',
  'Attributes',
];

export default defineModule({
  name: 'Sync',
  api: {
    async syncPlayerData(uuid: string, fromPort: number, toPort: number): Promise<void> {
      console.log(`[Sync] Syncing data for ${uuid} from ${fromPort} to ${toPort}`);

      const sourcePath = getPlayerDataPath(fromPort, uuid);
      const targetPath = getPlayerDataPath(toPort, uuid);

      if (!existsSync(sourcePath)) {
        console.warn(`[Sync] Source data not found at ${sourcePath}`);
        return;
      }

      try {
        const sourceBuffer = readFileSync(sourcePath);
        const { parsed: sourceData } = await nbt.parse(sourceBuffer);
        const sourceCompound = sourceData.value;

        let targetCompound: any = {};

        if (existsSync(targetPath)) {
          const targetBuffer = readFileSync(targetPath);
          const { parsed: targetData } = await nbt.parse(targetBuffer);
          targetCompound = targetData.value;
        } else {
          targetCompound = JSON.parse(JSON.stringify(sourceCompound));
          delete targetCompound.Pos;
          delete targetCompound.Rotation;
          delete targetCompound.Dimension;
          delete targetCompound.WorldUUID;
        }

        for (const tag of SYNC_TAGS) {
          if (sourceCompound[tag]) {
            targetCompound[tag] = sourceCompound[tag];
          }
        }

        const outputNbt = {
          type: 'compound',
          name: '',
          value: targetCompound,
        };

        const uncompressed = nbt.writeUncompressed(outputNbt as any, 'big');
        const compressed = gzipSync(uncompressed);

        writeFileSync(targetPath, compressed);
        console.log(`[Sync] Synced ${uuid} to ${targetPath}`);
      } catch (error) {
        console.error(`[Sync] Failed to sync player data:`, error);
      }
    },
  },
  onEnable: () => {},
});
