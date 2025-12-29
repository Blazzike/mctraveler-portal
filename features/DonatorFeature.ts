import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerCommand, syntax } from '@/feature-api/command';
import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';
import p from '@/feature-api/paint';
import PersistenceModule from '@/modules/PersistenceModule';

const { isPlayerAdmin, getUsernameFromUuid } = PersistenceModule.api;

const DONATORS_FILE = join(process.cwd(), 'data', 'donators.json');
const NICKNAMES_FILE = join(process.cwd(), 'data', 'nicknames.json');

type DonatorsData = {
  donators: string[];
};

type NicknamesData = Record<string, string>;

let donatorsCache: DonatorsData = { donators: [] };
let nicknamesCache: NicknamesData = {};

function loadDonators(): void {
  try {
    if (existsSync(DONATORS_FILE)) {
      donatorsCache = JSON.parse(readFileSync(DONATORS_FILE, 'utf8'));
      console.log(`[Donator] Loaded ${donatorsCache.donators.length} donators`);
    }
  } catch (e) {
    console.error('[Donator] Failed to load donators:', e);
  }
}

function saveDonators(): void {
  try {
    const dir = DONATORS_FILE.substring(0, DONATORS_FILE.lastIndexOf('/'));
    if (!existsSync(dir)) {
      require('node:fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(DONATORS_FILE, JSON.stringify(donatorsCache, null, 2));
  } catch (e) {
    console.error('[Donator] Failed to save donators:', e);
  }
}

function loadNicknames(): void {
  try {
    if (existsSync(NICKNAMES_FILE)) {
      nicknamesCache = JSON.parse(readFileSync(NICKNAMES_FILE, 'utf8'));
      console.log(`[Donator] Loaded ${Object.keys(nicknamesCache).length} nicknames`);
    }
  } catch (e) {
    console.error('[Donator] Failed to load nicknames:', e);
  }
}

function saveNicknames(): void {
  try {
    const dir = NICKNAMES_FILE.substring(0, NICKNAMES_FILE.lastIndexOf('/'));
    if (!existsSync(dir)) {
      require('node:fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(NICKNAMES_FILE, JSON.stringify(nicknamesCache, null, 2));
  } catch (e) {
    console.error('[Donator] Failed to save nicknames:', e);
  }
}

function isDonator(uuid: string): boolean {
  return donatorsCache.donators.includes(uuid);
}

function addDonator(uuid: string): boolean {
  if (isDonator(uuid)) return false;
  donatorsCache.donators.push(uuid);
  saveDonators();
  return true;
}

function removeDonator(uuid: string): boolean {
  const index = donatorsCache.donators.indexOf(uuid);
  if (index === -1) return false;
  donatorsCache.donators.splice(index, 1);
  saveDonators();
  return true;
}

function getNickname(uuid: string): string | null {
  return nicknamesCache[uuid] || null;
}

function setNickname(uuid: string, nickname: string): void {
  nicknamesCache[uuid] = nickname;
  saveNicknames();
}

function clearNickname(uuid: string): void {
  delete nicknamesCache[uuid];
  saveNicknames();
}

function getDisplayName(uuid: string, username: string): string {
  const nickname = getNickname(uuid);
  return nickname || username;
}

function formatDonatorName(name: string): string {
  return `§6${name}§r`;
}

export default defineFeature({
  name: 'Donator',
  onEnable: () => {
    loadDonators();
    loadNicknames();

    registerHook(FeatureHook.PlayerJoinedMessage, ({ username }) => {
      const player = require('@/modules/OnlinePlayersModule').default.api.getOnlinePlayerByUsername(username);
      if (player && isDonator(player.uuid)) {
        const displayName = getDisplayName(player.uuid, username);
        return p`${p.yellow(displayName)} joined the game`;
      }
      return null;
    });

    registerHook(FeatureHook.PlayerLeftMessage, ({ username }) => {
      const player = require('@/modules/OnlinePlayersModule').default.api.getOnlinePlayerByUsername(username);
      if (player && isDonator(player.uuid)) {
        const displayName = getDisplayName(player.uuid, username);
        return p`${p.yellow(displayName)} left the game`;
      }
      return null;
    });

    registerCommand(syntax`donator add ${syntax.onlinePlayer('target')}`, ({ sender, args }) => {
      if (!isPlayerAdmin(sender.uuid)) {
        return p.error`Only admins can manage donators.`;
      }

      const target = args.target;
      if (addDonator(target.uuid)) {
        return p.success`${p.green(target.username)} is now a donator!`;
      }
      return p.error`${p.red(target.username)} is already a donator.`;
    });

    registerCommand(syntax`donator remove ${syntax.onlinePlayer('target')}`, ({ sender, args }) => {
      if (!isPlayerAdmin(sender.uuid)) {
        return p.error`Only admins can manage donators.`;
      }

      const target = args.target;
      if (removeDonator(target.uuid)) {
        clearNickname(target.uuid);
        return p.success`${p.green(target.username)} is no longer a donator.`;
      }
      return p.error`${p.red(target.username)} is not a donator.`;
    });

    registerCommand(syntax`donator list`, ({ sender }) => {
      if (!isPlayerAdmin(sender.uuid)) {
        return p.error`Only admins can view the donator list.`;
      }

      if (donatorsCache.donators.length === 0) {
        return p.gray`No donators registered.`;
      }

      const lines = donatorsCache.donators.map((uuid) => {
        const username = getUsernameFromUuid(uuid) || 'Unknown';
        const nickname = getNickname(uuid);
        const display = nickname ? `${username} (${nickname})` : username;
        return p`  ${p.yellow(display)}`;
      });

      return p`${p.yellow('Donators:')}\n${lines.map((l) => l.toLegacyString()).join('\n')}`;
    });

    registerCommand(syntax`nick ${syntax.string.rest('nickname')}`, ({ sender, args }) => {
      if (!isDonator(sender.uuid) && !isPlayerAdmin(sender.uuid)) {
        return p.error`Only donators can change their nickname.`;
      }

      const nickname = args.nickname;
      if (!nickname.match(/^[a-zA-Z0-9_]{3,16}$/)) {
        return p.error`Invalid nickname. Use 3-16 alphanumeric characters.`;
      }

      setNickname(sender.uuid, nickname);
      return p.success`Your nickname is now ${p.yellow(nickname)}`;
    });

    registerCommand(syntax`nick`, ({ sender }) => {
      if (!isDonator(sender.uuid) && !isPlayerAdmin(sender.uuid)) {
        return p.error`Only donators can use nicknames.`;
      }

      const nickname = getNickname(sender.uuid);
      if (nickname) {
        return p`Your current nickname: ${p.yellow(nickname)}`;
      }
      return p.gray`You don't have a nickname set. Use /nick <name> to set one.`;
    });

    registerCommand(syntax`unnick`, ({ sender }) => {
      if (!isDonator(sender.uuid) && !isPlayerAdmin(sender.uuid)) {
        return p.error`Only donators can use nicknames.`;
      }

      const nickname = getNickname(sender.uuid);
      if (!nickname) {
        return p.error`You don't have a nickname set.`;
      }

      clearNickname(sender.uuid);
      return p.success`Your nickname has been removed.`;
    });

    registerCommand(syntax`donator`, ({ sender }) => {
      if (isPlayerAdmin(sender.uuid)) {
        return p`${p.yellow('Donator Commands:')}
  ${p.green('/donator add <player>')} - Add a donator
  ${p.green('/donator remove <player>')} - Remove a donator
  ${p.green('/donator list')} - List all donators`;
      }

      if (isDonator(sender.uuid)) {
        return p`${p.yellow('Donator Perks:')}
  ${p.green('/nick <name>')} - Set your nickname
  ${p.green('/unnick')} - Remove your nickname
  ${p.gray('Golden name in chat and tab list')}`;
      }

      return p.gray`Donator perks are available to supporters. Contact an admin for more info.`;
    });
  },
});

export { isDonator, getDisplayName, formatDonatorName, getNickname };
