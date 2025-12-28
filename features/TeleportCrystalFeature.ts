import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerCommand, syntax } from '@/feature-api/command';
import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';

const HOMES_FILE = join(process.cwd(), 'data', 'player-homes.json');
const COOLDOWN_MS = 60 * 1000; // 1 minute cooldown

type TeleportLocation = {
  x: number;
  y: number;
  z: number;
  world: string;
  serverPort: number;
};

type PlayerTeleportData = {
  home?: TeleportLocation;
  lastUsed?: number;
};

type HomesData = Record<string, PlayerTeleportData>;

let homesCache: HomesData = {};

function loadHomes(): void {
  try {
    if (existsSync(HOMES_FILE)) {
      homesCache = JSON.parse(readFileSync(HOMES_FILE, 'utf8'));
      console.log(`[TeleportCrystal] Loaded ${Object.keys(homesCache).length} player homes`);
    }
  } catch (e) {
    console.error('[TeleportCrystal] Failed to load homes:', e);
  }
}

function saveHomes(): void {
  try {
    const dir = HOMES_FILE.substring(0, HOMES_FILE.lastIndexOf('/'));
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(HOMES_FILE, JSON.stringify(homesCache, null, 2));
  } catch (e) {
    console.error('[TeleportCrystal] Failed to save homes:', e);
  }
}

function getPlayerData(uuid: string): PlayerTeleportData {
  return homesCache[uuid] || {};
}

function setPlayerData(uuid: string, data: PlayerTeleportData): void {
  homesCache[uuid] = data;
  saveHomes();
}

const CRYSTAL_ITEM_ID = 'minecraft:end_crystal';
const playerPositions = new WeakMap<OnlinePlayer, { x: number; y: number; z: number }>();

function formatLocation(loc: TeleportLocation): string {
  return `${Math.floor(loc.x)}, ${Math.floor(loc.y)}, ${Math.floor(loc.z)}`;
}

function canUseCrystal(player: OnlinePlayer): { allowed: boolean; cooldownRemaining?: number } {
  const data = getPlayerData(player.uuid);
  if (!data.lastUsed) return { allowed: true };

  const elapsed = Date.now() - data.lastUsed;
  if (elapsed >= COOLDOWN_MS) return { allowed: true };

  return { allowed: false, cooldownRemaining: COOLDOWN_MS - elapsed };
}

function teleportPlayer(player: OnlinePlayer, location: TeleportLocation): void {
  if (player.currentServerPort !== location.serverPort) {
    player.sendMessage(p.error`Cannot teleport to a different server. Use /switch first.`);
    return;
  }

  player.chat(`/tp ${player.username} ${location.x} ${location.y} ${location.z}`);

  const data = getPlayerData(player.uuid);
  data.lastUsed = Date.now();
  setPlayerData(player.uuid, data);

  player.sendMessage(p.success`Teleported to ${p.green(formatLocation(location))}`);
}

export default defineFeature({
  name: 'TeleportCrystal',
  onEnable: () => {
    loadHomes();

    registerHook(FeatureHook.PlayerMove, ({ player, to }) => {
      playerPositions.set(player, { x: to.x, y: to.y, z: to.z });
    });

    registerHook(FeatureHook.PlayerUseItem, ({ player, itemId }) => {
      if (itemId !== CRYSTAL_ITEM_ID) return;

      const data = getPlayerData(player.uuid);
      if (!data.home) {
        player.sendMessage(p.error`You don't have a home set. Use /sethome first.`);
        return;
      }

      const cooldownCheck = canUseCrystal(player);
      if (!cooldownCheck.allowed) {
        const seconds = Math.ceil(cooldownCheck.cooldownRemaining! / 1000);
        player.sendMessage(p.error`Teleport crystal on cooldown. ${p.red(`${seconds}s`)} remaining.`);
        return;
      }

      teleportPlayer(player, data.home);
    });

    registerCommand(syntax`sethome`, ({ sender }) => {
      const position = playerPositions.get(sender);
      if (!position) {
        return p.error`Position not available yet, please move first`;
      }

      const data = getPlayerData(sender.uuid);
      data.home = {
        x: position.x,
        y: position.y,
        z: position.z,
        world: sender.currentDimension,
        serverPort: sender.currentServerPort,
      };
      setPlayerData(sender.uuid, data);

      return p.success`Home set at ${p.green(formatLocation(data.home))}`;
    });

    registerCommand(syntax`home`, ({ sender }) => {
      const data = getPlayerData(sender.uuid);
      if (!data.home) {
        return p.error`You don't have a home set. Use /sethome first.`;
      }

      const cooldownCheck = canUseCrystal(sender);
      if (!cooldownCheck.allowed) {
        const seconds = Math.ceil(cooldownCheck.cooldownRemaining! / 1000);
        return p.error`Home teleport on cooldown. ${p.red(`${seconds}s`)} remaining.`;
      }

      teleportPlayer(sender, data.home);
    });

    registerCommand(syntax`delhome`, ({ sender }) => {
      const data = getPlayerData(sender.uuid);
      if (!data.home) {
        return p.error`You don't have a home set.`;
      }

      delete data.home;
      setPlayerData(sender.uuid, data);

      return p.success`Home deleted.`;
    });
  },
});
