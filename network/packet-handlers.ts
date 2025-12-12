import type net from 'node:net';

export interface ProxyPlayer {
  uuid: string;
  username: string;
  clientSocket: net.Socket;
  serverSocket: net.Socket;
  serverPort: number;
  isPremium: boolean;
  offlineUuid: string;
}

export type PacketHandler = (player: ProxyPlayer, packetId: number, packetData: Buffer) => boolean | undefined;
export type PacketTransformer = (player: ProxyPlayer, packetId: number, packetData: Buffer) => Buffer | null | undefined;
export type PlayerEventHandler = (player: ProxyPlayer) => void;
export type LoginHandler = (uuid: string, username: string, socket: net.Socket, serverPort: number, isPremium: boolean, offlineUuid: string) => any;

const clientToServerHandlers: PacketHandler[] = [];
const serverToClientHandlers: PacketHandler[] = [];
const serverToClientTransformers: Map<number, PacketTransformer> = new Map();
const playerJoinHandlers: PlayerEventHandler[] = [];
const playerLeaveHandlers: PlayerEventHandler[] = [];
const playerReadyHandlers: PlayerEventHandler[] = [];
let loginHandler: LoginHandler | null = null;

export function onClientToServerPacket(handler: PacketHandler): void {
  clientToServerHandlers.push(handler);
}

export function onServerToClientPacket(handler: PacketHandler): void {
  serverToClientHandlers.push(handler);
}

export function onServerToClientTransform(packetId: number, transformer: PacketTransformer): void {
  serverToClientTransformers.set(packetId, transformer);
}

export function onPlayerJoin(handler: PlayerEventHandler): void {
  playerJoinHandlers.push(handler);
}

export function onPlayerLeave(handler: PlayerEventHandler): void {
  playerLeaveHandlers.push(handler);
}

export function onPlayerReady(handler: PlayerEventHandler): void {
  playerReadyHandlers.push(handler);
}

export function setLoginHandler(handler: LoginHandler): void {
  loginHandler = handler;
}

export function handleClientToServerPacket(player: ProxyPlayer, packetId: number, packetData: Buffer): boolean {
  for (const handler of clientToServerHandlers) {
    if (handler(player, packetId, packetData) === true) {
      return true;
    }
  }
  return false;
}

export function handleServerToClientPacket(player: ProxyPlayer, packetId: number, packetData: Buffer): boolean {
  for (const handler of serverToClientHandlers) {
    if (handler(player, packetId, packetData) === true) {
      return true;
    }
  }
  return false;
}

export function transformServerToClientPacket(player: ProxyPlayer, packetId: number, packetData: Buffer): Buffer | null {
  const transformer = serverToClientTransformers.get(packetId);
  if (transformer) {
    const result = transformer(player, packetId, packetData);
    if (result !== undefined) {
      return result;
    }
  }
  return packetData;
}

export function triggerPlayerJoin(player: ProxyPlayer): void {
  for (const handler of playerJoinHandlers) {
    handler(player);
  }
}

export function triggerPlayerLeave(player: ProxyPlayer): void {
  for (const handler of playerLeaveHandlers) {
    handler(player);
  }
}

export function triggerPlayerReady(player: ProxyPlayer): void {
  for (const handler of playerReadyHandlers) {
    handler(player);
  }
}

export function createPlayer(uuid: string, username: string, socket: net.Socket, serverPort: number, isPremium: boolean, offlineUuid: string): any {
  if (loginHandler) {
    return loginHandler(uuid, username, socket, serverPort, isPremium, offlineUuid);
  }
  return { uuid, username, serverPort, isPremium, offlineUuid };
}

export function resetHandlers(): void {
  clientToServerHandlers.length = 0;
  serverToClientHandlers.length = 0;
  serverToClientTransformers.clear();
  playerJoinHandlers.length = 0;
  playerLeaveHandlers.length = 0;
  playerReadyHandlers.length = 0;
  loginHandler = null;
}
