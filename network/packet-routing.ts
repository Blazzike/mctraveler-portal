import {
  chatCommandPacket,
  chatMessagePacket,
  playerBlockDigPacket,
  playerBlockPlacePacket,
  playerPositionLookPacket,
  playerPositionPacket,
  playerUseItemPacket,
  useEntityPacket,
} from '@/defined-packets.gen';
import { double, string, varInt } from '@/encoding/data-buffer';
import { executeCommand } from '@/feature-api/command';
import { executeHook, FeatureHook } from '@/feature-api/manager';
import { log } from '@/logging';
import { getOnlinePlayers, type OnlinePlayer } from '@/network/player-tracking';

const playerPositions = new WeakMap<OnlinePlayer, { x: number; y: number; z: number }>();

export function parsePlayerMovement(player: OnlinePlayer, packetId: number, packetData: Buffer): void {
  if (packetId === playerPositionPacket.id || packetId === playerPositionLookPacket.id) {
    const x = double.read(packetData);
    const y = double.read(packetData.subarray(8));
    const z = double.read(packetData.subarray(16));
    const oldPos = playerPositions.get(player);
    const newPos = { x, y, z };
    if (!oldPos || oldPos.x !== x || oldPos.y !== y || oldPos.z !== z) {
      executeHook(FeatureHook.PlayerMove, { player, from: oldPos ?? newPos, to: newPos });
    }
    playerPositions.set(player, newPos);
  }
}

export function parsePlayerInteraction(player: OnlinePlayer, packetId: number, packetData: Buffer): void {
  if (packetId === playerBlockDigPacket.id) {
    executeHook(FeatureHook.PlayerBlockBreak, { player, packetData });
  } else if (packetId === playerBlockPlacePacket.id) {
    executeHook(FeatureHook.PlayerBlockPlace, { player, packetData });
  } else if (packetId === playerUseItemPacket.id) {
    executeHook(FeatureHook.PlayerUseItem, { player, packetData });
  } else if (packetId === useEntityPacket.id) {
    executeHook(FeatureHook.PlayerInteract, { player, packetData });
  }
}

export function parsePlayerMessage(player: OnlinePlayer, packetId: number, packetData: Buffer): boolean {
  if (packetId === chatCommandPacket.id) {
    try {
      const command = string.read(packetData);
      executeHook(FeatureHook.PlayerCommand, { player, command });
      const result = executeCommand(player, command);
      if (result) {
        // Don't try to send Promises as messages (async commands handle their own messaging)
        if (result !== true && !(result instanceof Promise)) {
          player.sendMessage(result);
        }
        return true;
      }
    } catch (e) {
      log.for('PacketRouting').debug('Failed to parse chat command: %s', e);
    }
  }

  if (packetId === chatMessagePacket.id) {
    try {
      const message = string.read(packetData);
      const results = executeHook(FeatureHook.PlayerChat, { player, message });
      const formattedMessage = results.find((r) => r);
      if (formattedMessage) {
        for (const p of getOnlinePlayers()) {
          p.sendMessage(formattedMessage);
        }
      }
    } catch (e) {
      log.for('PacketRouting').debug('Failed to parse chat message: %s', e);
    }
    return true;
  }

  return false;
}

export function shouldFilterInteractAt(player: OnlinePlayer, packetId: number, packetData: Buffer): boolean {
  if (packetId !== useEntityPacket.id) return false;

  const data = packetData;
  const target = varInt.readWithBytesCount(data);
  const mouse = varInt.read(data.subarray(target.bytesRead));

  // Block ALL interact_at packets - they're not needed for pet interactions
  if (mouse === 2) {
    return true;
  }

  return false;
}
