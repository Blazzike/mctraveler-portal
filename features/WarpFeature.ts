import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kSecondaryPort } from '@/config';
import { registerCommand, syntax } from '@/feature-api/command';
import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';
import PersistenceModule from '@/modules/PersistenceModule';

const { isPlayerAdmin } = PersistenceModule.api;

const WARPS_FILE = join(process.cwd(), 'data', 'warps.json');
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minute cooldown
const MAX_PLAYER_WARPS = 3;

type WarpLocation = {
  name: string;
  x: number;
  y: number;
  z: number;
  world: string;
  serverPort: number;
  ownerUuid: string;
  isPublic: boolean;
  createdAt: number;
};

type WarpsData = {
  warps: WarpLocation[];
};

type PlayerCooldowns = Record<string, number>;

let warpsCache: WarpsData = { warps: [] };
const playerCooldowns: PlayerCooldowns = {};
const playerPositions = new WeakMap<OnlinePlayer, { x: number; y: number; z: number }>();

function loadWarps(): void {
  try {
    if (existsSync(WARPS_FILE)) {
      warpsCache = JSON.parse(readFileSync(WARPS_FILE, 'utf8'));
      console.log(`[Warp] Loaded ${warpsCache.warps.length} warps`);
    }
  } catch (e) {
    console.error('[Warp] Failed to load warps:', e);
  }
}

function saveWarps(): void {
  try {
    const dir = WARPS_FILE.substring(0, WARPS_FILE.lastIndexOf('/'));
    if (!existsSync(dir)) {
      require('node:fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(WARPS_FILE, JSON.stringify(warpsCache, null, 2));
  } catch (e) {
    console.error('[Warp] Failed to save warps:', e);
  }
}

function getWorldForPlayer(player: OnlinePlayer): string {
  const base = player.currentServerPort === kSecondaryPort ? 'last' : 'world';
  if (player.currentDimension.includes('nether')) {
    return `${base}_nether`;
  }
  if (player.currentDimension.includes('end')) {
    return `${base}_the_end`;
  }
  return base;
}

function canTeleport(uuid: string): { allowed: boolean; cooldownRemaining?: number } {
  const lastUsed = playerCooldowns[uuid];
  if (!lastUsed) return { allowed: true };

  const elapsed = Date.now() - lastUsed;
  if (elapsed >= COOLDOWN_MS) return { allowed: true };

  return { allowed: false, cooldownRemaining: COOLDOWN_MS - elapsed };
}

function getPlayerWarpCount(uuid: string): number {
  return warpsCache.warps.filter((w) => w.ownerUuid === uuid && !w.isPublic).length;
}

function teleportToWarp(player: OnlinePlayer, warp: WarpLocation): void {
  if (player.currentServerPort !== warp.serverPort) {
    player.sendMessage(p.error`This warp is on a different server. Use /switch first.`);
    return;
  }

  player.chat(`/tp ${player.username} ${warp.x} ${warp.y} ${warp.z}`);
  playerCooldowns[player.uuid] = Date.now();
  player.sendMessage(p.success`Warped to ${p.green(warp.name)}`);
}

export default defineFeature({
  name: 'Warp',
  onEnable: () => {
    loadWarps();

    registerHook(FeatureHook.PlayerMove, ({ player, to }) => {
      playerPositions.set(player, { x: to.x, y: to.y, z: to.z });
    });

    registerCommand(syntax`warp list`, () => {
      const publicWarps = warpsCache.warps.filter((w) => w.isPublic);
      if (publicWarps.length === 0) {
        return p.gray`No public warps available.`;
      }

      const lines = publicWarps.map((w) => {
        const serverName = w.serverPort === kSecondaryPort ? 'Secondary' : 'Primary';
        return p`  ${p.green(w.name)} - ${p.gray(serverName)}`;
      });

      return p`${p.yellow('Public Warps:')}\n${lines.map((l) => l.toLegacyString()).join('\n')}`;
    });

    registerCommand(syntax`warp ${syntax.string.rest('name')}`, ({ sender, args }) => {
      const name = args.name.toLowerCase();
      const warp = warpsCache.warps.find(
        (w) => w.name.toLowerCase() === name && (w.isPublic || w.ownerUuid === sender.uuid)
      );

      if (!warp) {
        return p.error`Warp "${args.name}" not found. Use /warp list to see available warps.`;
      }

      const cooldownCheck = canTeleport(sender.uuid);
      if (!cooldownCheck.allowed && !isPlayerAdmin(sender.uuid)) {
        const minutes = Math.ceil(cooldownCheck.cooldownRemaining! / 60000);
        return p.error`Warp on cooldown. ${p.red(`${minutes}m`)} remaining.`;
      }

      teleportToWarp(sender, warp);
    });

    registerCommand(syntax`setwarp ${syntax.string.rest('name')}`, ({ sender, args }) => {
      const position = playerPositions.get(sender);
      if (!position) {
        return p.error`Position not available yet, please move first.`;
      }

      const name = args.name;
      if (!name.match(/^[a-zA-Z0-9_\-]{2,20}$/)) {
        return p.error`Invalid warp name. Use 2-20 alphanumeric characters.`;
      }

      const existing = warpsCache.warps.find((w) => w.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        return p.error`A warp with this name already exists.`;
      }

      const isAdmin = isPlayerAdmin(sender.uuid);
      const playerWarpCount = getPlayerWarpCount(sender.uuid);

      if (!isAdmin && playerWarpCount >= MAX_PLAYER_WARPS) {
        return p.error`You have reached the maximum of ${MAX_PLAYER_WARPS} personal warps.`;
      }

      const warp: WarpLocation = {
        name,
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
        world: getWorldForPlayer(sender),
        serverPort: sender.currentServerPort,
        ownerUuid: sender.uuid,
        isPublic: false,
        createdAt: Date.now(),
      };

      warpsCache.warps.push(warp);
      saveWarps();

      return p.success`Personal warp "${p.green(name)}" created at ${p.gray(`${warp.x}, ${warp.y}, ${warp.z}`)}`;
    });

    registerCommand(syntax`delwarp ${syntax.string.rest('name')}`, ({ sender, args }) => {
      const name = args.name.toLowerCase();
      const index = warpsCache.warps.findIndex(
        (w) => w.name.toLowerCase() === name && (w.ownerUuid === sender.uuid || isPlayerAdmin(sender.uuid))
      );

      if (index === -1) {
        return p.error`Warp "${args.name}" not found or you don't have permission to delete it.`;
      }

      const deleted = warpsCache.warps.splice(index, 1)[0];
      saveWarps();

      return p.success`Warp "${p.green(deleted!.name)}" deleted.`;
    });

    registerCommand(syntax`warp setpublic ${syntax.string.rest('name')}`, ({ sender, args }) => {
      if (!isPlayerAdmin(sender.uuid)) {
        return p.error`Only admins can make warps public.`;
      }

      const name = args.name.toLowerCase();
      const warp = warpsCache.warps.find((w) => w.name.toLowerCase() === name);

      if (!warp) {
        return p.error`Warp "${args.name}" not found.`;
      }

      warp.isPublic = !warp.isPublic;
      saveWarps();

      const status = warp.isPublic ? 'public' : 'private';
      return p.success`Warp "${p.green(warp.name)}" is now ${p.yellow(status)}.`;
    });

    registerCommand(syntax`mywarps`, ({ sender }) => {
      const myWarps = warpsCache.warps.filter((w) => w.ownerUuid === sender.uuid);
      if (myWarps.length === 0) {
        return p.gray`You have no personal warps. Use /setwarp <name> to create one.`;
      }

      const lines = myWarps.map((w) => {
        const status = w.isPublic ? p.green('public') : p.gray('private');
        return p`  ${p.green(w.name)} - ${status}`;
      });

      return p`${p.yellow('Your Warps:')}\n${lines.map((l) => l.toLegacyString()).join('\n')}`;
    });

    registerCommand(syntax`warp`, () => {
      return p`${p.yellow('Warp Commands:')}
  ${p.green('/warp <name>')} - Teleport to a warp
  ${p.green('/warp list')} - List public warps
  ${p.green('/setwarp <name>')} - Create a personal warp
  ${p.green('/delwarp <name>')} - Delete your warp
  ${p.green('/mywarps')} - List your warps`;
    });
  },
});
