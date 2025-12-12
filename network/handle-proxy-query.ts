import type net from 'node:net';
import { kProtocolVersion } from '@/config';
import { pingRequestPacket, pingResponsePacket, statusRequestPacket, statusResponsePacket } from '@/defined-packets.gen';
import { writePacket } from '@/network/defined-packet';
import type { PacketQueue } from '@/network/packet-queue';
import type { StatusResponse } from '@/network/types';

export async function handleProxyQuery(minecraftClientSocket: net.Socket, { expect }: PacketQueue, onStatusRequest: () => StatusResponse) {
  await expect(statusRequestPacket);

  minecraftClientSocket.write(
    writePacket(statusResponsePacket, {
      response: JSON.stringify({
        version: {
          protocol: kProtocolVersion,
          name: 'MCTraveler Proxy',
        },
        ...onStatusRequest(),
      }),
    })
  );

  const ping = await expect(pingRequestPacket);

  minecraftClientSocket.write(
    writePacket(pingResponsePacket, {
      time: ping.time,
    })
  );
}
