import { playerPositionLookPacket, playerPositionPacket } from '@/defined-packets.gen';
import { double } from '@/encoding/data-buffer';
import { defineModule } from '@/module-api/module';
import type { OnlinePlayer } from '@/modules/OnlinePlayersModule';

export type Position = { x: number; y: number; z: number };

const playerPositions = new WeakMap<OnlinePlayer, Position>();
const positionCallbacks: ((player: OnlinePlayer, from: Position, to: Position) => void)[] = [];

export default defineModule({
  name: 'PlayerPosition',
  api: {
    getPlayerPosition(player: OnlinePlayer): Position | undefined {
      return playerPositions.get(player);
    },

    onPlayerMove(callback: (player: OnlinePlayer, from: Position, to: Position) => void): void {
      positionCallbacks.push(callback);
    },

    parsePlayerMovementPacket(player: OnlinePlayer, packetId: number, packetData: Buffer): void {
      if (packetId !== playerPositionPacket.id && packetId !== playerPositionLookPacket.id) {
        return;
      }

      const x = double.read(packetData);
      const y = double.read(packetData.subarray(8));
      const z = double.read(packetData.subarray(16));

      const newPos: Position = { x, y, z };
      const oldPos = playerPositions.get(player);

      if (oldPos && (oldPos.x !== x || oldPos.y !== y || oldPos.z !== z)) {
        for (const callback of positionCallbacks) {
          callback(player, oldPos, newPos);
        }
      }

      playerPositions.set(player, newPos);
    },
  },
  onEnable: () => {},
  onPlayerLeave: (player) => {
    playerPositions.delete(player);
  },
});
