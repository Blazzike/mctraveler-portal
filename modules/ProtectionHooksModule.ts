import { kSecondaryPort } from '@/config';
import {
  acknowledgePlayerDiggingPacket,
  closeWindowClientPacket,
  openWindowPacket,
  playerBlockDigPacket,
  playerBlockPlacePacket,
  playerUseItemPacket,
  updateSignPacket,
  useEntityPacket,
  windowClickPacket,
} from '@/defined-packets.gen';
import { varInt } from '@/encoding/data-buffer';
import { executeHook, FeatureHook } from '@/feature-api/manager';
import { defineModule } from '@/module-api/module';
import HeldItemModule from '@/modules/HeldItemModule';
import OnlinePlayersModule, { type OnlinePlayer } from '@/modules/OnlinePlayersModule';
import { writePacket } from '@/network/defined-packet';
import { onClientToServerPacket, onServerToClientPacket } from '@/network/packet-handlers';
import type { LazilyParsedPacket } from '@/network/types';

export interface ProtectionCheckData {
  player: OnlinePlayer;
  position?: { x: number; y: number; z: number };
  world: string;
  isHoldingItem: boolean;
}

export interface ContainerClickData {
  player: OnlinePlayer;
  windowId: number;
}

export interface EntityInteractData {
  player: OnlinePlayer;
  entityId: number;
  action: 'interact' | 'attack' | 'interact_at';
  isHoldingItem: boolean;
  world: string;
}

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

function getWorldForPlayer(player: OnlinePlayer): string {
  const base = player.currentServerPort === kSecondaryPort ? 'last' : 'world';
  const dim = player.currentDimension;
  if (dim === 'nether' || dim === 'minecraft:the_nether' || dim.endsWith(':the_nether')) {
    return `${base}_nether`;
  }
  if (dim === 'end' || dim === 'minecraft:the_end' || dim.endsWith(':the_end')) {
    return `${base}_the_end`;
  }
  return base;
}

function trackContainerOpen(player: OnlinePlayer): void {
  executeHook(FeatureHook.ContainerOpen, { player });
}

function trackContainerClose(player: OnlinePlayer): void {
  executeHook(FeatureHook.ContainerClose, { player });
}

function checkProtection(packet: LazilyParsedPacket, player: OnlinePlayer, clientSocket: any): boolean {
  const world = getWorldForPlayer(player);
  const holding = HeldItemModule.api.isHoldingItem(player);

  if (packet.packetId === playerBlockDigPacket.id) {
    try {
      const data = packet.packetData;
      const status = varInt.readWithBytesCount(data);

      if (status.value === 0 || status.value === 2) {
        const pos = decodeBlockPosition(data, status.bytesRead);

        const results = executeHook(FeatureHook.CheckBlockDigProtection, {
          player,
          position: pos,
          world,
          isHoldingItem: holding,
        } as ProtectionCheckData);

        if (results.some((r) => r === true)) {
          const faceOffset = status.bytesRead + 8;
          const face = varInt.readWithBytesCount(data.subarray(faceOffset));
          const sequence = varInt.readWithBytesCount(data.subarray(faceOffset + face.bytesRead));

          const ackPacket = writePacket(acknowledgePlayerDiggingPacket, {
            sequenceId: sequence.value,
          });
          clientSocket.write(ackPacket);

          return true;
        }
      }
    } catch (e) {
      console.error('[Protection] Failed to parse block dig packet:', e);
    }
  }

  if (packet.packetId === playerBlockPlacePacket.id) {
    try {
      const data = packet.packetData;
      const hand = varInt.readWithBytesCount(data);
      const pos = decodeBlockPosition(data, hand.bytesRead);

      const results = executeHook(FeatureHook.CheckBlockPlaceProtection, {
        player,
        position: pos,
        world,
        isHoldingItem: holding,
      } as ProtectionCheckData);

      if (results.some((r) => r === true)) {
        return true;
      }
    } catch (e) {
      console.error('[Protection] Failed to parse block place packet:', e);
    }
  }

  if (packet.packetId === windowClickPacket.id) {
    try {
      const data = packet.packetData;
      const windowId = varInt.read(data);

      if (windowId !== 0) {
        const results = executeHook(FeatureHook.CheckContainerClickProtection, {
          player,
          windowId,
        } as ContainerClickData);

        if (results.some((r) => r === true)) {
          return true;
        }
      }
    } catch (e) {
      console.error('[Protection] Failed to parse window click packet:', e);
    }
  }

  if (packet.packetId === updateSignPacket.id) {
    try {
      const data = packet.packetData;
      const pos = decodeBlockPosition(data, 0);

      const results = executeHook(FeatureHook.CheckSignEditProtection, {
        player,
        position: pos,
        world,
        isHoldingItem: holding,
      } as ProtectionCheckData);

      if (results.some((r) => r === true)) {
        return true;
      }
    } catch (e) {
      console.error('[Protection] Failed to parse update sign packet:', e);
    }
  }

  if (packet.packetId === playerUseItemPacket.id) {
    try {
      if (holding) {
        const results = executeHook(FeatureHook.CheckItemUseProtection, {
          player,
          world,
          isHoldingItem: holding,
        } as ProtectionCheckData);

        if (results.some((r) => r === true)) {
          return true;
        }
      }
    } catch (e) {
      console.error('[Protection] Failed to parse use item packet:', e);
    }
  }

  if (packet.packetId === useEntityPacket.id) {
    try {
      const data = packet.packetData;
      const target = varInt.readWithBytesCount(data);
      const mouse = varInt.read(data.subarray(target.bytesRead));

      const action = mouse === 1 ? 'attack' : mouse === 2 ? 'interact_at' : 'interact';

      const results = executeHook(FeatureHook.CheckEntityInteractProtection, {
        player,
        entityId: target.value,
        action,
        isHoldingItem: holding,
        world,
      } as EntityInteractData);

      if (results.some((r) => r === true)) {
        return true;
      }
    } catch (e) {
      console.error('[Protection] Failed to parse use entity packet:', e);
    }
  }

  return false;
}

export default defineModule({
  name: 'ProtectionHooks',
  api: {
    checkProtection,
    trackContainerOpen,
    trackContainerClose,
  },
  onEnable: () => {
    onServerToClientPacket((proxyPlayer, packetId, _packetData) => {
      const onlinePlayer = OnlinePlayersModule.api.getOnlinePlayer(proxyPlayer.uuid);
      if (!onlinePlayer) return false;

      if (packetId === openWindowPacket.id) {
        trackContainerOpen(onlinePlayer);
      }
      if (packetId === closeWindowClientPacket.id) {
        trackContainerClose(onlinePlayer);
      }
      return false;
    });

    onClientToServerPacket((proxyPlayer, packetId, packetData) => {
      const onlinePlayer = OnlinePlayersModule.api.getOnlinePlayer(proxyPlayer.uuid);
      if (!onlinePlayer) return false;

      if (packetId === 0x12) {
        trackContainerClose(onlinePlayer);
      }
      const packet: LazilyParsedPacket = { packetId, packetData };
      return checkProtection(packet, onlinePlayer, proxyPlayer.clientSocket);
    });
  },
});
