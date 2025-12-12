import { expect, test } from 'bun:test';
import { composeDataBuffer, string, unsignedShort, varInt } from '@/encoding/data-buffer';
import { type DefinedPacket, definePacket, readPacketFields, writePacket } from '@/network/defined-packet';

let definedPacket: DefinedPacket;
test('define', () => {
  const packetParams = {
    id: 0x00,
    fields: {
      protocolVersion: varInt,
      serverAddress: string,
      serverPort: unsignedShort,
      state: varInt,
    },
  };

  definedPacket = definePacket(packetParams);

  expect(definedPacket).toEqual(packetParams);
});

test('write', () => {
  const buffer = writePacket(definedPacket, {
    protocolVersion: 0,
    serverAddress: '',
    serverPort: 0,
    state: 0,
  });

  const expectedContent = composeDataBuffer(varInt(definedPacket.id), varInt(0), string(''), unsignedShort(0), varInt(0));

  expect(buffer).toEqual(composeDataBuffer(varInt(expectedContent.length), expectedContent));
});

test('write throw', () => {
  expect(() => writePacket(definedPacket, {})).toThrow();
});

test('read', () => {
  const buffer = writePacket(definedPacket, {
    protocolVersion: 0,
    serverAddress: '',
    serverPort: 0,
    state: 0,
  });

  const packetLength = varInt.readWithBytesCount(buffer);
  const packetId = varInt.readWithBytesCount(buffer.subarray(packetLength.bytesRead));
  const fieldsBuffer = buffer.subarray(packetLength.bytesRead + packetId.bytesRead);

  expect(readPacketFields(definedPacket.fields, fieldsBuffer)).toEqual({
    protocolVersion: 0,
    serverAddress: '',
    serverPort: 0,
    state: 0,
  });
});
