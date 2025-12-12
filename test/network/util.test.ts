import { expect, test } from 'bun:test';
import { varInt } from '@/encoding/data-buffer';
import { createCompleter, forwardPacket } from '@/network/util';

test('forwardPacket', () => {
  const writtenBuffers: Buffer[] = [];
  const mockSocket = {
    write: (data: Buffer) => {
      writtenBuffers.push(data);
      return true;
    },
    readyState: 'open' as const,
  };

  const testPacket = {
    packetId: 0x42,
    packetData: Buffer.from([1, 2, 3, 4]),
  };

  forwardPacket(mockSocket as any, testPacket);

  expect(writtenBuffers.length).toBe(1);

  const written = writtenBuffers[0]!;
  const packetLength = varInt.readWithBytesCount(written);
  const packetId = varInt.readWithBytesCount(written.subarray(packetLength.bytesRead));

  expect(packetId.value).toBe(0x42);
  expect(written.subarray(packetLength.bytesRead + packetId.bytesRead)).toEqual(Buffer.from([1, 2, 3, 4]));
});

test('createCompleter', async () => {
  const completer = createCompleter<number>();

  let resolved = false;
  let resolvedValue: number | undefined;

  completer.then((value) => {
    resolved = true;
    resolvedValue = value;
  });

  expect(resolved).toBe(false);

  completer.complete(42);

  await completer;

  expect(resolved).toBe(true);
  expect(resolvedValue).toBe(42);
});
