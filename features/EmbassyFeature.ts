import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kSecondaryPort } from '@/config';
import { registerCommand, syntax } from '@/feature-api/command';
import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';
import PersistenceModule from '@/modules/PersistenceModule';

const { isPlayerAdmin } = PersistenceModule.api;

const EMBASSIES_FILE = join(process.cwd(), 'data', 'embassies.json');
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minute cooldown

type EmbassyLocation = {
  name: string;
  x: number;
  y: number;
  z: number;
  world: string;
  serverPort: number;
  createdBy: string;
  createdAt: number;
};

type EmbassiesData = {
  embassies: EmbassyLocation[];
};

type PlayerCooldowns = Record<string, number>;

let embassiesCache: EmbassiesData = { embassies: [] };
const playerCooldowns: PlayerCooldowns = {};
const playerPositions = new WeakMap<OnlinePlayer, { x: number; y: number; z: number }>();

function loadEmbassies(): void {
  try {
    if (existsSync(EMBASSIES_FILE)) {
      embassiesCache = JSON.parse(readFileSync(EMBASSIES_FILE, 'utf8'));
      console.log(`[Embassy] Loaded ${embassiesCache.embassies.length} embassies`);
    }
  } catch (e) {
    console.error('[Embassy] Failed to load embassies:', e);
  }
}

function saveEmbassies(): void {
  try {
    const dir = EMBASSIES_FILE.substring(0, EMBASSIES_FILE.lastIndexOf('/'));
    if (!existsSync(dir)) {
      require('node:fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(EMBASSIES_FILE, JSON.stringify(embassiesCache, null, 2));
  } catch (e) {
    console.error('[Embassy] Failed to save embassies:', e);
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

function teleportToEmbassy(player: OnlinePlayer, embassy: EmbassyLocation): void {
  if (player.currentServerPort !== embassy.serverPort) {
    player.sendMessage(p.error`This embassy is on a different server. Use /switch first.`);
    return;
  }

  player.chat(`/tp ${player.username} ${embassy.x} ${embassy.y} ${embassy.z}`);
  playerCooldowns[player.uuid] = Date.now();
  player.sendMessage(p.success`Teleported to embassy ${p.green(embassy.name)}`);
}

export default defineFeature({
  name: 'Embassy',
  onEnable: () => {
    loadEmbassies();

    registerHook(FeatureHook.PlayerMove, ({ player, to }) => {
      playerPositions.set(player, { x: to.x, y: to.y, z: to.z });
    });

    registerCommand(syntax`embassy list`, ({ sender }) => {
      if (embassiesCache.embassies.length === 0) {
        return p.gray`No embassies have been created yet.`;
      }

      const lines = embassiesCache.embassies.map((e) => {
        const serverName = e.serverPort === kSecondaryPort ? 'Secondary' : 'Primary';
        return p`  ${p.green(e.name)} - ${p.gray(serverName)}`;
      });

      return p`${p.yellow('Embassies:')}\n${lines.map((l) => l.toLegacyString()).join('\n')}`;
    });

    registerCommand(syntax`embassy tp ${syntax.string.rest('name')}`, ({ sender, args }) => {
      const name = args.name.toLowerCase();
      const embassy = embassiesCache.embassies.find((e) => e.name.toLowerCase() === name);

      if (!embassy) {
        return p.error`Embassy "${args.name}" not found. Use /embassy list to see available embassies.`;
      }

      const cooldownCheck = canTeleport(sender.uuid);
      if (!cooldownCheck.allowed && !isPlayerAdmin(sender.uuid)) {
        const minutes = Math.ceil(cooldownCheck.cooldownRemaining! / 60000);
        return p.error`Embassy teleport on cooldown. ${p.red(`${minutes}m`)} remaining.`;
      }

      teleportToEmbassy(sender, embassy);
    });

    registerCommand(syntax`embassy create ${syntax.string.rest('name')}`, ({ sender, args }) => {
      if (!isPlayerAdmin(sender.uuid)) {
        return p.error`Only admins can create embassies.`;
      }

      const position = playerPositions.get(sender);
      if (!position) {
        return p.error`Position not available yet, please move first.`;
      }

      const name = args.name;
      if (!name.match(/^[a-zA-Z0-9_\- ]{2,30}$/)) {
        return p.error`Invalid embassy name. Use 2-30 alphanumeric characters.`;
      }

      const existing = embassiesCache.embassies.find((e) => e.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        return p.error`An embassy with this name already exists.`;
      }

      const embassy: EmbassyLocation = {
        name,
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
        world: getWorldForPlayer(sender),
        serverPort: sender.currentServerPort,
        createdBy: sender.uuid,
        createdAt: Date.now(),
      };

      embassiesCache.embassies.push(embassy);
      saveEmbassies();

      return p.success`Embassy "${p.green(name)}" created at ${p.gray(`${embassy.x}, ${embassy.y}, ${embassy.z}`)}`;
    });

    registerCommand(syntax`embassy delete ${syntax.string.rest('name')}`, ({ sender, args }) => {
      if (!isPlayerAdmin(sender.uuid)) {
        return p.error`Only admins can delete embassies.`;
      }

      const name = args.name.toLowerCase();
      const index = embassiesCache.embassies.findIndex((e) => e.name.toLowerCase() === name);

      if (index === -1) {
        return p.error`Embassy "${args.name}" not found.`;
      }

      const deleted = embassiesCache.embassies.splice(index, 1)[0];
      saveEmbassies();

      return p.success`Embassy "${p.green(deleted!.name)}" deleted.`;
    });

    registerCommand(syntax`embassy`, ({ sender }) => {
      return p`${p.yellow('Embassy Commands:')}
  ${p.green('/embassy list')} - List all embassies
  ${p.green('/embassy tp <name>')} - Teleport to an embassy
  ${p.green('/embassy create <name>')} - Create an embassy (admin)
  ${p.green('/embassy delete <name>')} - Delete an embassy (admin)`;
    });
  },
});
