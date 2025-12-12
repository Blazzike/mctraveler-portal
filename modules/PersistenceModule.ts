import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import * as nbt from 'prismarine-nbt';
import { defineModule } from '@/module-api/module';

const PLAYERS_DIR = 'players';
const UUID_CACHE_FILE = join(process.cwd(), 'uuid-cache.json');

if (!existsSync(PLAYERS_DIR)) {
  mkdirSync(PLAYERS_DIR);
}

const uuidToUsername = new Map<string, string>();

interface PlayerTimestamps {
  login?: number;
  logout?: number;
  firstSeen?: number;
}

interface PlayerData {
  timestamps?: PlayerTimestamps;
  ipAddress?: string;
  lastServer?: 'primary' | 'secondary';
  balance?: number;
  geoLocation?: string;
  balanceBeheadingLoss?: number;
  notepad?: string[];
  isAdmin?: boolean;
}

function loadUuidCache(): void {
  if (existsSync(UUID_CACHE_FILE)) {
    try {
      const data = JSON.parse(readFileSync(UUID_CACHE_FILE, 'utf-8')) as Record<string, string>;
      for (const [uuid, username] of Object.entries(data)) {
        uuidToUsername.set(uuid, username);
      }
      console.log(`[Persistence] Loaded ${uuidToUsername.size} UUID mappings`);
    } catch (e) {
      console.error('Failed to load UUID cache', e);
    }
  }
}

function saveUuidCache(): void {
  try {
    const data: Record<string, string> = {};
    for (const [uuid, username] of uuidToUsername) {
      data[uuid] = username;
    }
    writeFileSync(UUID_CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save UUID cache', e);
  }
}

function getPlayerFilePath(uuid: string): string {
  return join(PLAYERS_DIR, `${uuid}.json`);
}

function readPlayerData(uuid: string): PlayerData {
  const file = getPlayerFilePath(uuid);
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, 'utf-8')) as PlayerData;
    } catch (e) {
      console.error(`Failed to read player data for ${uuid}`, e);
    }
  }
  return {};
}

function writePlayerData(uuid: string, data: PlayerData): void {
  const file = getPlayerFilePath(uuid);
  try {
    writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Failed to write player data for ${uuid}`, e);
  }
}

function generateOfflineUUID(username: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${username}`).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x30;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const PLAYERDATA_DIRS = ['minecraft-server/primary/world/playerdata'];

loadUuidCache();

export default defineModule({
  name: 'Persistence',
  api: {
    cachePlayerUuid(uuid: string, username: string): void {
      if (!uuidToUsername.has(uuid) || uuidToUsername.get(uuid) !== username) {
        uuidToUsername.set(uuid, username);
        saveUuidCache();
      }
    },

    getUsernameFromUuid(uuid: string): string | null {
      return uuidToUsername.get(uuid) ?? null;
    },

    async convertPlayerDataToOfflineUuid(onlineUuid: string, username: string): Promise<void> {
      const offlineUuid = generateOfflineUUID(username);
      if (onlineUuid === offlineUuid) return;

      for (const dir of PLAYERDATA_DIRS) {
        const onlinePath = join(dir, `${onlineUuid}.dat`);
        const offlinePath = join(dir, `${offlineUuid}.dat`);

        if (existsSync(onlinePath) && !existsSync(offlinePath)) {
          try {
            renameSync(onlinePath, offlinePath);
            console.log(`[Persistence] Converted playerdata: ${onlineUuid} -> ${offlineUuid} (${username})`);

            const buffer = readFileSync(offlinePath);
            const { parsed } = await nbt.parse(buffer);
            const compound = parsed.value as any;

            compound.Pos = {
              type: 'list',
              value: { type: 'double', value: [16.5, 71.0, -14.5] },
            };

            const outputNbt = { type: 'compound', name: '', value: compound };
            const uncompressed = nbt.writeUncompressed(outputNbt as any, 'big');
            const compressed = gzipSync(uncompressed);
            writeFileSync(offlinePath, compressed);
            console.log(`[Persistence] Set spawn location for ${username}`);
          } catch (e) {
            console.error(`[Persistence] Failed to convert playerdata for ${username}:`, e);
          }
        }
      }
    },

    getPlayerLastServerName(uuid: string): 'primary' | 'secondary' | undefined {
      return readPlayerData(uuid).lastServer;
    },

    setPlayerLastServerName(uuid: string, server: 'primary' | 'secondary'): void {
      const data = readPlayerData(uuid);
      data.lastServer = server;
      writePlayerData(uuid, data);
    },

    trackPlayerLoginData(uuid: string, username: string, ipAddress?: string, skipPlayerdataConversion?: boolean): void {
      const data = readPlayerData(uuid);
      const now = Date.now();

      if (!data.timestamps) data.timestamps = {};
      data.timestamps.login = now;
      if (!data.timestamps.firstSeen) data.timestamps.firstSeen = now;
      if (ipAddress) data.ipAddress = ipAddress;

      this.cachePlayerUuid(uuid, username);

      if (!skipPlayerdataConversion) {
        this.convertPlayerDataToOfflineUuid(uuid, username).catch((e) => {
          console.error('[Persistence] Error in playerdata conversion:', e);
        });
      }

      writePlayerData(uuid, data);
    },

    trackPlayerLogoutData(uuid: string): void {
      const data = readPlayerData(uuid);
      if (!data.timestamps) data.timestamps = {};
      data.timestamps.logout = Date.now();
      writePlayerData(uuid, data);
    },

    readNotepadData(uuid: string): string[] {
      return readPlayerData(uuid).notepad || [];
    },

    writeNotepadData(uuid: string, pages: string[]): void {
      const data = readPlayerData(uuid);
      data.notepad = pages;
      writePlayerData(uuid, data);
    },

    isPlayerAdmin(uuid: string): boolean {
      return readPlayerData(uuid).isAdmin === true;
    },

    setPlayerAdmin(uuid: string, isAdmin: boolean): void {
      const data = readPlayerData(uuid);
      data.isAdmin = isAdmin;
      writePlayerData(uuid, data);
    },
  },
  onEnable: () => {},
});
