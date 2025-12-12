import type { SocketReadyState } from 'node:net';

export interface SocketLike {
  on(event: 'data', listener: (data: Buffer) => void): this;
  off(event: 'data', listener: (data: Buffer) => void): this;
  write(data: Buffer): boolean;
  readyState: SocketReadyState;
}

export type LazilyParsedPacket = {
  packetId: number;
  packetData: Buffer;
};

export type StatusResponse = {
  players: {
    max: number;
    online: number;
    sample: {
      name: string;
      id: string;
    }[];
  };
  description: {
    text: string;
  };
  favicon: string;
  enforcesSecureChat: boolean;
};
