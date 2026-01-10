import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  gameStateChangePacket,
  resetScorePacket,
  scoreboardDisplayObjectivePacket,
  scoreboardObjectivePacket,
  scoreboardScorePacket,
} from '@/defined-packets.gen';
import { anonymousNbt, boolean as booleanType, byte, string, varInt } from '@/encoding/data-buffer';
import { registerCommand, syntax } from '@/feature-api/command';
import { defineFeature, FeatureHook, registerHook } from '@/feature-api/manager';
import p, { type Paint } from '@/feature-api/paint';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';
import PersistenceModule from '@/modules/PersistenceModule';
import { writePacket } from '@/network/defined-packet';
import { getOnlinePlayers, getPlayerSocket } from '@/network/proxy';
import { safeWrite } from '@/network/util';
import { getWorldForPlayer } from '@/util/world';

const { getUsernameFromUuid, isPlayerAdmin } = PersistenceModule.api;

type RegionPoint = {
  x: number;
  z: number;
  y?: number;
};

type LegacyRegionData = {
  title: string;
  'start-x': number;
  'start-z': number;
  'start-y'?: number;
  'end-x': number;
  'end-z': number;
  'end-y'?: number;
  world: string;
  members: string[];
  flags?: string[];
  'sub-regions'?: Record<string, LegacyRegionData>;
};

type LegacyRegionsFile = {
  regions: Record<string, LegacyRegionData>;
};

type Region = {
  title: string;
  start: RegionPoint;
  end: RegionPoint;
  world: string;
  members: Set<string>;
  flags: Set<string>;
  subRegions: Region[];
  parentRegion?: Region;
};

const regions: Region[] = [];
const playerCurrentRegion = new WeakMap<OnlinePlayer, Region>();
const playerScoreboardInitialized = new WeakSet<OnlinePlayer>();
const playerPositions = new WeakMap<OnlinePlayer, { x: number; y: number; z: number }>();
const regionStarts = new WeakMap<OnlinePlayer, { x: number; y: number; z: number; world: string; serverPort: number }>();
const playersInAdventureMode = new WeakSet<OnlinePlayer>();
const playerActualGameMode = new WeakMap<OnlinePlayer, number>(); // 0=Survival, 1=Creative, 2=Adventure, 3=Spectator
const kRegionsPath = join(process.cwd(), 'regions.json');
const kObjectiveName = 'region';

function loadRegions(): void {
  if (!existsSync(kRegionsPath)) {
    console.log('[Regions] No regions.json found');
    return;
  }

  try {
    const fileContent = JSON.parse(readFileSync(kRegionsPath, 'utf-8')) as LegacyRegionsFile;
    regions.length = 0;

    function parseRegion(data: LegacyRegionData, parent?: Region): Region {
      const region: Region = {
        title: data.title,
        start: {
          x: data['start-x'],
          z: data['start-z'],
          y: data['start-y'] ?? 320,
        },
        end: {
          x: data['end-x'],
          z: data['end-z'],
          y: data['end-y'] ?? -64,
        },
        world: data.world,
        members: new Set(data.members ?? []),
        flags: new Set(data.flags ?? []),
        subRegions: [],
        parentRegion: parent,
      };

      if (data['sub-regions']) {
        for (const subData of Object.values(data['sub-regions'])) {
          region.subRegions.push(parseRegion(subData, region));
        }
      }

      return region;
    }

    if (fileContent.regions) {
      for (const regionData of Object.values(fileContent.regions)) {
        regions.push(parseRegion(regionData));
      }
    }

    console.log(`[Regions] Loaded ${regions.length} regions`);
  } catch (error) {
    console.error('[Regions] Failed to load regions:', error);
  }
}

function saveRegions(): void {
  function serializeRegion(region: Region): LegacyRegionData {
    const data: LegacyRegionData = {
      title: region.title,
      'start-x': region.start.x,
      'start-z': region.start.z,
      'end-x': region.end.x,
      'end-z': region.end.z,
      world: region.world,
      members: Array.from(region.members),
    };

    if (region.start.y !== 320) data['start-y'] = region.start.y;
    if (region.end.y !== -64) data['end-y'] = region.end.y;
    if (region.flags.size > 0) data.flags = Array.from(region.flags);

    if (region.subRegions.length > 0) {
      data['sub-regions'] = {};
      region.subRegions.forEach((sub, idx) => {
        data['sub-regions']![idx.toString()] = serializeRegion(sub);
      });
    }

    return data;
  }

  const output: LegacyRegionsFile = { regions: {} };
  regions.forEach((region, idx) => {
    output.regions[idx.toString()] = serializeRegion(region);
  });

  writeFileSync(kRegionsPath, JSON.stringify(output, null, 2));
}

function regionContains(region: Region, x: number, y: number, z: number): boolean {
  const minX = Math.min(region.start.x, region.end.x);
  const maxX = Math.max(region.start.x, region.end.x);
  const minZ = Math.min(region.start.z, region.end.z);
  const maxZ = Math.max(region.start.z, region.end.z);
  const minY = Math.min(region.start.y!, region.end.y!);
  const maxY = Math.max(region.start.y!, region.end.y!);

  return x >= minX && x <= maxX && z >= minZ && z <= maxZ && y >= minY && y <= maxY;
}

function getRegionAt(x: number, y: number, z: number, world: string): Region | null {
  let currentRegions = regions.filter((r) => r.world === world);
  let foundRegion: Region | null = null;

  while (currentRegions.length > 0) {
    const region = currentRegions.find((r) => regionContains(r, x, y, z));
    if (region) {
      foundRegion = region;
      currentRegions = region.subRegions;
    } else {
      break;
    }
  }

  return foundRegion;
}

function truncate(str: string, maxLength: number): string {
  return str.length > maxLength ? str.substring(0, maxLength) : str;
}

function sendScoreboardObjective(socket: any, action: number, displayText?: any): void {
  if (!socket || socket.readyState !== 'open') return;

  const packetId = varInt(scoreboardObjectivePacket.id);
  const nameField = string(kObjectiveName);
  const actionField = byte(action);

  let content: Buffer;
  if (action === 0 || action === 2) {
    const displayNbt = anonymousNbt(displayText ?? { text: '' });
    const typeField = varInt(0); // INTEGER render type
    const hasNumberFormat = booleanType(false);
    content = Buffer.concat([packetId, nameField, actionField, displayNbt, typeField, hasNumberFormat]);
  } else {
    content = Buffer.concat([packetId, nameField, actionField]);
  }

  socket.write(Buffer.concat([varInt(content.length), content]));
}

function sendScoreboardDisplay(socket: any, visible: boolean): void {
  if (!socket || socket.readyState !== 'open') return;

  const packetId = varInt(scoreboardDisplayObjectivePacket.id);
  const position = varInt(1); // SIDEBAR
  const objectiveName = string(visible ? kObjectiveName : '');

  const content = Buffer.concat([packetId, position, objectiveName]);
  socket.write(Buffer.concat([varInt(content.length), content]));
}

function sendScore(socket: any, id: string, displayName: any, value: number): void {
  if (!socket || socket.readyState !== 'open') return;

  const packetId = varInt(scoreboardScorePacket.id);
  const itemName = string(id);
  const scoreName = string(kObjectiveName);
  const scoreValue = varInt(value);
  const hasDisplayName = booleanType(true);
  const displayNbt = anonymousNbt(displayName);
  const hasNumberFormat = booleanType(true);
  const numberFormat = varInt(0); // BLANK format

  const content = Buffer.concat([packetId, itemName, scoreName, scoreValue, hasDisplayName, displayNbt, hasNumberFormat, numberFormat]);
  socket.write(Buffer.concat([varInt(content.length), content]));
}

function deleteScore(socket: any, id: string): void {
  if (!socket || socket.readyState !== 'open') return;

  const packetId = varInt(resetScorePacket.id);
  const entityName = string(id);
  const hasObjective = booleanType(false);

  const content = Buffer.concat([packetId, entityName, hasObjective]);
  socket.write(Buffer.concat([varInt(content.length), content]));
}

function ensureScoreboardInitialized(player: OnlinePlayer): void {
  if (playerScoreboardInitialized.has(player)) return;

  const socket = getPlayerSocket(player);
  if (!socket) return;

  // First remove any existing objective (in case of server switch)
  sendScoreboardObjective(socket, 1); // action=1 is remove
  // Then create the new objective
  sendScoreboardObjective(socket, 0, { text: '' });
  playerScoreboardInitialized.add(player);
}

function setScoreboardTitle(player: OnlinePlayer, title: string): void {
  const socket = getPlayerSocket(player);
  if (!socket) return;

  const displayText = {
    text: truncate(title, 20),
    bold: true,
    color: 'green',
  };

  sendScoreboardObjective(socket, 2, displayText);
}

function setScoreboardVisible(player: OnlinePlayer, visible: boolean): void {
  const socket = getPlayerSocket(player);
  if (!socket) return;

  sendScoreboardDisplay(socket, visible);
}

function sendRegionScoreboard(player: OnlinePlayer, region: Region): void {
  const socket = getPlayerSocket(player);
  if (!socket) return;

  ensureScoreboardInitialized(player);
  setScoreboardTitle(player, region.title);

  const memberCount = region.members.size;

  sendScore(socket, '@residents', { text: 'Residents', bold: true }, memberCount);

  sendScore(
    socket,
    '@break',
    {
      text: '                              ', // 30 spaces
      strikethrough: true,
      color: 'dark_gray',
    },
    memberCount + 1
  );

  let index = 0;
  for (const uuid of region.members) {
    const username = getUsername(uuid);
    if (!username) continue;

    const isCurrentPlayer = uuid === player.uuid;
    sendScore(
      socket,
      uuid,
      {
        text: truncate(username, 20),
        color: isCurrentPlayer ? 'white' : 'gray',
      },
      index
    );
    index++;
  }

  if (!region.flags.has('NO_SCOREBOARD')) {
    setScoreboardVisible(player, true);
  }
}

function clearRegionScoreboard(player: OnlinePlayer, region: Region): void {
  const socket = getPlayerSocket(player);
  if (!socket) return;

  deleteScore(socket, '@residents');
  deleteScore(socket, '@break');

  for (const uuid of region.members) {
    deleteScore(socket, uuid);
  }
}

function setPlayerGameMode(player: OnlinePlayer, mode: number): void {
  const socket = getPlayerSocket(player);
  if (!socket) return;
  const packet = writePacket(gameStateChangePacket, { reason: 3, gameMode: mode });
  safeWrite(socket, packet);
}

function updatePlayerProtectionMode(player: OnlinePlayer, region: Region | null): void {
  const socket = getPlayerSocket(player);
  if (!socket) return;

  const actualGameMode = playerActualGameMode.get(player) ?? 0;
  const wasInAdventureMode = playersInAdventureMode.has(player);
  const shouldBeProtected = region !== null && !canModifyRegion(region, player);

  // Only apply adventure mode protection if player is in survival mode
  if (shouldBeProtected && !wasInAdventureMode && actualGameMode === 0) {
    playersInAdventureMode.add(player);
    setPlayerGameMode(player, 2); // Adventure mode
  } else if (!shouldBeProtected && wasInAdventureMode) {
    playersInAdventureMode.delete(player);
    setPlayerGameMode(player, 0); // Restore to Survival mode
  }
}

function trackPlayerGameMode(player: OnlinePlayer, gameMode: number): void {
  playerActualGameMode.set(player, gameMode);
  // Re-evaluate protection when gamemode changes
  const region = playerCurrentRegion.get(player);
  if (region) {
    updatePlayerProtectionMode(player, region);
  }
}

function clearPlayerProtectionState(player: OnlinePlayer): void {
  playersInAdventureMode.delete(player);
  playerActualGameMode.delete(player);
}

function setPlayerCurrentRegion(player: OnlinePlayer, region: Region | null): void {
  const currentRegion = playerCurrentRegion.get(player);

  if (currentRegion === region) return;

  if (region) {
    if (currentRegion) {
      for (const uuid of currentRegion.members) {
        if (!region.members.has(uuid)) {
          deleteScore(getPlayerSocket(player), uuid);
        }
      }
    }

    playerCurrentRegion.set(player, region);
    sendRegionScoreboard(player, region);
  } else {
    if (currentRegion) {
      clearRegionScoreboard(player, currentRegion);
    }
    playerCurrentRegion.delete(player);
    setScoreboardVisible(player, false);
  }

  // Update protection mode based on new region
  updatePlayerProtectionMode(player, region);
}

function getUsername(uuid: string): string | null {
  for (const player of getOnlinePlayers()) {
    if (player.uuid === uuid) {
      return player.username;
    }
  }
  return getUsernameFromUuid(uuid);
}

function isResident(region: Region, player: OnlinePlayer): boolean {
  return region.members.has(player.uuid);
}

function canModifyRegion(region: Region | null | undefined, player: OnlinePlayer): boolean {
  if (!region) return true;
  if (isResident(region, player)) return true;
  if (region.flags.has('PUBLIC')) return true;
  return false;
}

function sendProtectionMessage(player: OnlinePlayer, regionName: string): void {
  player.sendMessage(p.error`This area is protected by ${p.red(regionName)}`);
}

const playerOpenContainerRegion = new WeakMap<OnlinePlayer, Region | null>();

export default defineFeature({
  name: 'RegionProvider',
  onEnable: () => {
    loadRegions();

    registerHook(FeatureHook.PlayerGameModeChange, ({ player, gameMode }) => {
      trackPlayerGameMode(player, gameMode);
    });

    registerHook(FeatureHook.ClearPlayerProtection, ({ player }) => {
      clearPlayerProtectionState(player);
    });

    registerHook(FeatureHook.PlayerLeave, ({ player }) => {
      playerCurrentRegion.delete(player);
    });

    registerHook(FeatureHook.PlayerMove, ({ player, to }) => {
      playerPositions.set(player, { x: to.x, y: to.y, z: to.z });
      const world = getWorldForPlayer(player);
      const region = getRegionAt(Math.floor(to.x), Math.floor(to.y), Math.floor(to.z), world);
      setPlayerCurrentRegion(player, region);
    });

    registerHook(FeatureHook.ContainerOpen, ({ player }) => {
      const region = playerCurrentRegion.get(player);
      playerOpenContainerRegion.set(player, region ?? null);
    });

    registerHook(FeatureHook.ContainerClose, ({ player }) => {
      playerOpenContainerRegion.delete(player);
    });

    registerHook(FeatureHook.CheckBlockDigProtection, ({ player, position, world }) => {
      const region = getRegionAt(position.x, position.y, position.z, world);
      if (!canModifyRegion(region, player)) {
        sendProtectionMessage(player, region!.title);
        return true;
      }
      return false;
    });

    registerHook(FeatureHook.CheckBlockPlaceProtection, ({ player, position, world }) => {
      const region = getRegionAt(position.x, position.y, position.z, world);
      if (!canModifyRegion(region, player)) {
        sendProtectionMessage(player, region!.title);
        return true;
      }
      return false;
    });

    registerHook(FeatureHook.CheckSignEditProtection, ({ player, position, world }) => {
      const region = getRegionAt(position.x, position.y, position.z, world);
      if (!canModifyRegion(region, player)) {
        sendProtectionMessage(player, region!.title);
        return true;
      }
      return false;
    });

    registerHook(FeatureHook.CheckContainerClickProtection, ({ player }) => {
      const containerRegion = playerOpenContainerRegion.get(player);
      if (
        containerRegion &&
        !isResident(containerRegion, player) &&
        !containerRegion.flags.has('PUBLIC') &&
        !containerRegion.flags.has('ENABLE_PUBLIC_CONTAINERS')
      ) {
        sendProtectionMessage(player, containerRegion.title);
        return true;
      }
      return false;
    });

    registerHook(FeatureHook.CheckItemUseProtection, ({ player }) => {
      const region = playerCurrentRegion.get(player);
      if (region && !canModifyRegion(region, player)) {
        sendProtectionMessage(player, region.title);
        return true;
      }
      return false;
    });

    registerHook(FeatureHook.CheckEntityInteractProtection, ({ player, action, isHoldingItem }) => {
      const region = playerCurrentRegion.get(player);
      if (region && !canModifyRegion(region, player) && !region.flags.has('DISABLE_ANIMAL_PROTECTION')) {
        if (action === 'attack') {
          sendProtectionMessage(player, region.title);
          return true;
        }
        if ((action === 'interact' || action === 'interact_at') && isHoldingItem && !region.flags.has('ENABLE_PUBLIC_VILLAGER_TRADING')) {
          sendProtectionMessage(player, region.title);
          return true;
        }
      }
      return false;
    });

    // /region rename <name>
    registerCommand(syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)} rename ${syntax.string.rest('name')}`, ({ sender, args }) => {
      const currentRegion = playerCurrentRegion.get(sender);

      if (!currentRegion) {
        return p.error`You must stand in the region you want to rename`;
      }

      if (!isResident(currentRegion, sender) && !isPlayerAdmin(sender.uuid)) {
        return p.error`You are not a member of this region`;
      }

      const name = args.name;
      if (!name.match(/^[a-zA-Z0-9!_'?()#:,.+&@*\- ]{3,30}$/)) {
        return p.error`Invalid region name`;
      }

      const oldTitle = currentRegion.title;
      currentRegion.title = name;
      saveRegions();

      for (const player of getOnlinePlayers()) {
        if (playerCurrentRegion.get(player) === currentRegion) {
          setScoreboardTitle(player, name);
        }
      }

      return p.success`Renamed ${p.green(oldTitle)} to ${p.green(name)}`;
    });

    // /region add <player>
    registerCommand(syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)} add ${syntax.onlinePlayer('target')}`, ({ sender, args }) => {
      const currentRegion = playerCurrentRegion.get(sender);

      if (!currentRegion) {
        return p.error`You must stand in the region you want to add a resident to`;
      }

      if (currentRegion.members.size >= 99) {
        return p.error`Regions may only have 99 members`;
      }

      if (!isResident(currentRegion, sender) && !isPlayerAdmin(sender.uuid)) {
        if (!currentRegion.parentRegion || !isResident(currentRegion.parentRegion, sender)) {
          return p.error`You are not a member of this region`;
        }
      }

      const targetPlayer = args.target;
      const targetUsername = targetPlayer.username;
      const targetUuid = targetPlayer.uuid;

      if (currentRegion.members.has(targetUuid)) {
        return p.error`${p.red(targetUsername)} is already a member of ${p.red(currentRegion.title)}`;
      }

      currentRegion.members.add(targetUuid);
      saveRegions();

      for (const player of getOnlinePlayers()) {
        if (playerCurrentRegion.get(player) === currentRegion) {
          const socket = getPlayerSocket(player);
          sendScore(
            socket,
            targetUuid,
            {
              text: truncate(targetUsername, 20),
              color: player.uuid === targetUuid ? 'white' : 'gray',
            },
            0
          );

          sendScore(socket, '@residents', { text: 'Residents', bold: true }, currentRegion.members.size);
          sendScore(
            socket,
            '@break',
            { text: '                              ', strikethrough: true, color: 'dark_gray' },
            currentRegion.members.size + 1
          );

          // Update gamemode for the added player
          if (player.uuid === targetUuid) {
            updatePlayerProtectionMode(player, currentRegion);
          }
        }
      }

      return p.success`${p.green(targetUsername)} has been added to ${p.green(currentRegion.title)}`;
    });

    // /region remove <player>
    const regionMemberSuggestions = (partial: string, player: OnlinePlayer): string[] => {
      const region = playerCurrentRegion.get(player);
      if (!region) return [];
      const names: string[] = [];
      for (const uuid of region.members) {
        const username = getUsername(uuid);
        if (username?.toLowerCase().startsWith(partial)) {
          names.push(username);
        }
      }
      return names;
    };

    registerCommand(
      syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)} remove ${syntax.string.withSuggestions('player', regionMemberSuggestions)}`,
      ({ sender, args }) => {
        const currentRegion = playerCurrentRegion.get(sender);

        if (!currentRegion) {
          return p.error`You must stand in the region you want to remove a resident from`;
        }

        if (!isResident(currentRegion, sender) && !isPlayerAdmin(sender.uuid)) {
          return p.error`You are not a member of this region`;
        }

        const targetUsername = args.player;

        let targetUuid: string | null = null;
        for (const uuid of currentRegion.members) {
          const username = getUsername(uuid);
          if (username?.toLowerCase() === targetUsername.toLowerCase()) {
            targetUuid = uuid;
            break;
          }
        }

        if (!targetUuid) {
          return p.error`${p.red(targetUsername)} is not a member of ${p.red(currentRegion.title)}`;
        }

        if (currentRegion.members.size === 1) {
          return p.error`${p.red(targetUsername)} is the only member of ${p.red(currentRegion.title)}`;
        }

        currentRegion.members.delete(targetUuid);
        saveRegions();

        for (const player of getOnlinePlayers()) {
          if (playerCurrentRegion.get(player) === currentRegion) {
            deleteScore(getPlayerSocket(player), targetUuid);

            const socket = getPlayerSocket(player);
            sendScore(socket, '@residents', { text: 'Residents', bold: true }, currentRegion.members.size);
            sendScore(
              socket,
              '@break',
              { text: '                              ', strikethrough: true, color: 'dark_gray' },
              currentRegion.members.size + 1
            );

            // Update gamemode for the removed player
            if (player.uuid === targetUuid) {
              updatePlayerProtectionMode(player, currentRegion);
            }
          }
        }

        return p.success`${p.green(targetUsername)} has been removed from ${p.green(currentRegion.title)}`;
      }
    );

    // /region delete
    registerCommand(syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)} delete`, ({ sender }) => {
      const currentRegion = playerCurrentRegion.get(sender);

      if (!currentRegion) {
        return p.error`You must stand in the region you want to delete`;
      }

      if (!isResident(currentRegion, sender) && !isPlayerAdmin(sender.uuid)) {
        return p.error`You are not a member of this region`;
      }

      if (currentRegion.flags.has('EMBASSY')) {
        return p.error`You must use ${p.red('/embassy delete')} to delete an embassy`;
      }

      const title = currentRegion.title;

      for (const player of getOnlinePlayers()) {
        if (playerCurrentRegion.get(player) === currentRegion) {
          clearRegionScoreboard(player, currentRegion);
          playerCurrentRegion.delete(player);
          setScoreboardVisible(player, false);
        }
      }

      if (currentRegion.parentRegion) {
        const idx = currentRegion.parentRegion.subRegions.indexOf(currentRegion);
        if (idx >= 0) currentRegion.parentRegion.subRegions.splice(idx, 1);
      } else {
        const idx = regions.indexOf(currentRegion);
        if (idx >= 0) regions.splice(idx, 1);
      }
      saveRegions();

      return p.success`Deleted region ${p.green(title)}`;
    });

    // /region start
    registerCommand(syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)} start`, ({ sender }) => {
      const pos = playerPositions.get(sender);
      if (!pos) {
        return p.error`Position not available yet, please move first`;
      }

      const world = getWorldForPlayer(sender);
      regionStarts.set(sender, { ...pos, world, serverPort: sender.currentServerPort });

      return p.success`First point set!

Now move over to the next point and do:
${p.green('/rg end')}`;
    });

    // /region end
    registerCommand(syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)} end`, ({ sender }) => {
      const start = regionStarts.get(sender);
      if (!start) {
        return p.error`You must start first. Use /rg start`;
      }

      const end = playerPositions.get(sender);
      if (!end) {
        return p.error`Position not available yet, please move first`;
      }

      const currentWorld = getWorldForPlayer(sender);
      if (start.world !== currentWorld) {
        return p.error`Regions may only be created in the same world.`;
      }

      if (start.serverPort !== sender.currentServerPort) {
        return p.error`Regions may only be created on the same server. Use /rg start again.`;
      }

      // +1 because block coordinates are inclusive (e.g. 10 to 12 is 10, 11, 12 = 3 blocks)
      const dx = Math.abs(start.x - end.x) + 1;
      const dz = Math.abs(start.z - end.z) + 1;
      const area = dx * dz;

      if (area <= 9) {
        return p.error`Region too small`;
      }

      if (area > 5000 && !isPlayerAdmin(sender.uuid)) {
        return p.error`Region too large (${Math.floor(area)} blocks). Limit is 5000 blocks. Ask an admin to create it.`;
      }

      const world = currentWorld;
      const startRegion = getRegionAt(Math.floor(start.x), Math.floor(start.y), Math.floor(start.z), world);
      const endRegion = getRegionAt(Math.floor(end.x), Math.floor(end.y), Math.floor(end.z), world);

      const newMinX = Math.min(Math.floor(start.x), Math.floor(end.x));
      const newMaxX = Math.max(Math.floor(start.x), Math.floor(end.x));
      const newMinZ = Math.min(Math.floor(start.z), Math.floor(end.z));
      const newMaxZ = Math.max(Math.floor(start.z), Math.floor(end.z));

      function checkOverlapWithExisting(regionList: Region[]): Region | null {
        for (const region of regionList) {
          if (region.world !== world) continue;
          const rMinX = Math.min(region.start.x, region.end.x);
          const rMaxX = Math.max(region.start.x, region.end.x);
          const rMinZ = Math.min(region.start.z, region.end.z);
          const rMaxZ = Math.max(region.start.z, region.end.z);

          const corners = [
            { x: rMinX, z: rMinZ },
            { x: rMinX, z: rMaxZ },
            { x: rMaxX, z: rMinZ },
            { x: rMaxX, z: rMaxZ },
          ];
          for (const c of corners) {
            if (c.x >= newMinX && c.x <= newMaxX && c.z >= newMinZ && c.z <= newMaxZ) {
              return region;
            }
          }

          const result = checkOverlapWithExisting(region.subRegions);
          if (result) return result;
        }
        return null;
      }

      const overlappingRegion = checkOverlapWithExisting(regions);
      if (overlappingRegion) {
        return p.error`Overlapping region ${p.red(overlappingRegion.title)}!`;
      }

      let parentRegion: Region | undefined;
      if (startRegion && startRegion === endRegion) {
        if (startRegion.flags.has('EMBASSY')) {
          return p.error`You cannot create a region inside an embassy`;
        }
        if (startRegion.flags.has('ADMIN')) {
          return p.error`You cannot create a region inside a region with admin flag`;
        }
        if (!isResident(startRegion, sender)) {
          return p.error`You are not a member of the parent region`;
        }
        parentRegion = startRegion;
      } else if (startRegion || endRegion) {
        return p.error`Overlapping region ${p.red((startRegion || endRegion)!.title)}!`;
      }

      const title = `${sender.username}'s Place`;
      const newRegion: Region = {
        title,
        start: { x: Math.floor(start.x), z: Math.floor(start.z), y: 255 },
        end: { x: Math.floor(end.x), z: Math.floor(end.z), y: 15 },
        world,
        members: new Set([sender.uuid]),
        flags: new Set(),
        subRegions: [],
        parentRegion,
      };

      if (parentRegion) {
        parentRegion.subRegions.push(newRegion);
      } else {
        regions.push(newRegion);
      }
      saveRegions();

      regionStarts.delete(sender);
      setPlayerCurrentRegion(sender, newRegion);

      return p.success`Region ${p.green(title)} created!

You can now rename the region:
${p.green('/rg rename <name>')}`;
    });

    // /region flag [flag] (admin)
    registerCommand(syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)} flag ${syntax.string.rest('flag')}`, ({ sender, args }) => {
      if (!isPlayerAdmin(sender.uuid)) {
        return p.error`You must be an admin to use this command`;
      }

      const currentRegion = playerCurrentRegion.get(sender);

      if (!currentRegion) {
        return p.error`You must stand in the region you want to toggle a flag on`;
      }

      const flag = args.flag.toUpperCase();
      const validFlags = [
        'EMBASSY',
        'NO_SCOREBOARD',
        'ENABLE_EXPLOSIONS',
        'ADMIN',
        'ENABLE_PUBLIC_CONTAINERS',
        'DISABLE_GATES',
        'ENABLE_FIRE_DAMAGE',
        'DISABLE_PLAYER_FALL_DAMAGE',
        'ENABLE_PUBLIC_VILLAGER_TRADING',
        'DISABLE_PUBLIC_REDSTONE_TRIGGERS',
        'DISABLE_ANIMAL_PROTECTION',
        'PUBLIC',
      ];

      if (!validFlags.includes(flag)) {
        return p.error`Invalid flag. Valid flags: ${validFlags.join(', ')}`;
      }

      if (flag === 'EMBASSY') {
        return p.error`You cannot toggle the embassy flag`;
      }

      if (currentRegion.flags.has(flag)) {
        currentRegion.flags.delete(flag);
        saveRegions();
        return p.success`Flag ${p.green(flag)} removed`;
      } else {
        currentRegion.flags.add(flag);
        saveRegions();
        return p.success`Flag ${p.green(flag)} added`;
      }
    });

    // /region flag (list flags)
    registerCommand(syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)} flag`, ({ sender }) => {
      if (!isPlayerAdmin(sender.uuid)) {
        return p.error`You must be an admin to use this command`;
      }

      const currentRegion = playerCurrentRegion.get(sender);

      if (!currentRegion) {
        return p.error`You must stand in a region to view flags`;
      }

      const validFlags = [
        'EMBASSY',
        'NO_SCOREBOARD',
        'ENABLE_EXPLOSIONS',
        'ADMIN',
        'ENABLE_PUBLIC_CONTAINERS',
        'DISABLE_GATES',
        'ENABLE_FIRE_DAMAGE',
        'DISABLE_PLAYER_FALL_DAMAGE',
        'ENABLE_PUBLIC_VILLAGER_TRADING',
        'DISABLE_PUBLIC_REDSTONE_TRIGGERS',
        'DISABLE_ANIMAL_PROTECTION',
        'PUBLIC',
      ] as const;
      const enabledFlags = validFlags.filter((f) => currentRegion.flags.has(f));
      const disabledFlags = validFlags.filter((f) => !currentRegion.flags.has(f));
      const flagText = [...enabledFlags.map((f) => p.green`${f}`), ...disabledFlags.map((f) => p.red`${f}`)];
      return p.gray`Flags: ${flagText.map((f) => f.toLegacyString()).join('§7, ')}`;
    });

    // /region bounds <min-y> <max-y> (admin)
    registerCommand(
      syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)} bounds ${syntax.integer('minY')} ${syntax.integer('maxY')}`,
      ({ sender, args }) => {
        if (!isPlayerAdmin(sender.uuid)) {
          return p.error`You must be an admin to use this command`;
        }

        const currentRegion = playerCurrentRegion.get(sender);
        if (!currentRegion) {
          return p.error`You must stand in the region you want to set bounds for`;
        }

        const minY = Math.min(args.minY, args.maxY);
        const maxY = Math.max(args.minY, args.maxY);

        if (minY < -64 || maxY > 320) {
          return p.error`Y bounds must be between -64 and 320`;
        }

        if (maxY - minY < 16) {
          return p.error`Y bounds must be at least 16 blocks tall`;
        }

        currentRegion.start.y = maxY;
        currentRegion.end.y = minY;
        saveRegions();

        return p.success`Set Y bounds for ${p.green(currentRegion.title)} to ${p.white(minY)} - ${p.white(maxY)}`;
      }
    );

    // /region bounds (show current bounds)
    registerCommand(syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)} bounds`, ({ sender }) => {
      if (!isPlayerAdmin(sender.uuid)) {
        return p.error`You must be an admin to use this command`;
      }

      const currentRegion = playerCurrentRegion.get(sender);
      if (!currentRegion) {
        return p.error`You must stand in a region to view bounds`;
      }

      const minY = Math.min(currentRegion.start.y ?? 320, currentRegion.end.y ?? -64);
      const maxY = Math.max(currentRegion.start.y ?? 320, currentRegion.end.y ?? -64);

      return p`${p.green(currentRegion.title)} bounds: Y ${p.white(minY)} to ${p.white(maxY)}`;
    });

    // /region locate <name>
    registerCommand(syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)} locate ${syntax.string.rest('name')}`, ({ sender, args }) => {
      if (!isPlayerAdmin(sender.uuid)) {
        return p.error`You must be an admin to use this command`;
      }

      const searchName = args.name.toLowerCase();

      const foundRegions: Region[] = [];

      function searchRegions(regionList: Region[]) {
        for (const region of regionList) {
          let matches = region.title.toLowerCase().includes(searchName);
          if (!matches) {
            for (const uuid of region.members) {
              const username = getUsername(uuid);
              if (username?.toLowerCase().includes(searchName)) {
                matches = true;
                break;
              }
            }
          }
          if (matches) {
            foundRegions.push(region);
          }
          if (region.subRegions.length > 0) {
            searchRegions(region.subRegions);
          }
        }
      }
      searchRegions(regions);

      if (foundRegions.length === 0) {
        return p.error`No regions found matching "${args.name}"`;
      }

      function getWorldInfo(world: string): string {
        const isSecondary = world.startsWith('last');
        const server = isSecondary ? 'secondary' : 'primary';
        let dimension = 'overworld';
        if (world.includes('nether')) dimension = 'nether';
        else if (world.includes('end')) dimension = 'end';
        return `${server}/${dimension}`;
      }

      if (foundRegions.length === 1) {
        const region = foundRegions[0]!;
        const centerX = Math.floor((region.start.x + region.end.x) / 2);
        const centerZ = Math.floor((region.start.z + region.end.z) / 2);
        const worldInfo = getWorldInfo(region.world);
        return p`${p.yellow`${region.title}`} - ${p.white`${centerX}/~/${centerZ}`}/${p.green`${worldInfo}`}`;
      }

      const lines: Paint[] = [p`Located regions (${p.yellow`${foundRegions.length}`}):`];
      for (const region of foundRegions.slice(0, 10)) {
        const centerX = Math.floor((region.start.x + region.end.x) / 2);
        const centerZ = Math.floor((region.start.z + region.end.z) / 2);
        const worldInfo = getWorldInfo(region.world);
        lines.push(p` - ${p.yellow`${region.title}`} ${p.gray`${centerX}/${centerZ}/${worldInfo}`}`);
      }
      if (foundRegions.length > 10) {
        lines.push(p.gray` ...and ${foundRegions.length - 10} more`);
      }
      for (const line of lines) {
        sender.sendMessage(line);
      }
      return true;
    });

    // /region help
    registerCommand(syntax`${syntax.oneOf('rg', ['region', 'rg'] as const)}`, () => {
      return p`${p.darkGray`--[`} ${p.green.bold`Region Commands`} ${p.darkGray`]--`}
${p.gray` - `}${p.white`/rg rename <name>`}
${p.gray` - `}${p.white`/rg add <player>`}
${p.gray` - `}${p.white`/rg remove <player>`}
${p.gray` - `}${p.white`/rg delete`}
${p.gray` - `}${p.white`/rg start`} ${p.gray`+ `}${p.white`/rg end`}
${p.gray` - `}${p.white`/rg flag [flag]`}
${p.gray` - `}${p.white`/rg locate <name>`}`;
    });
  },
});

export { getRegionAt, isResident, playerCurrentRegion, regions };
export type { Region };
