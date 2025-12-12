import { type ConditionalHandler, composeDataBuffer, type TypeHandler, varInt } from '../encoding/data-buffer';

export type DefinedPacketFields<T> = Record<string, TypeHandler<T>>;

type ExtractHandlerType<T> = T extends TypeHandler<infer U> ? U : never;

export type PacketFieldValues<T extends Record<string, TypeHandler<any>>> = {
  [K in keyof T]: ExtractHandlerType<T[K]>;
};

export type DefinedPacket = {
  id: number;
  fields: DefinedPacketFields<any>;
};

export function definePacket(params: DefinedPacket): DefinedPacket {
  return params;
}

function isConditionalHandler(handler: any): handler is ConditionalHandler<any> {
  return handler && handler.isConditional === true;
}

function shouldIncludeField(handler: any, data: Record<string, any>): boolean {
  if (!isConditionalHandler(handler)) return true;
  const dependencyValue = data[handler.dependsOn];
  return handler.allowedValues.includes(dependencyValue);
}

export function writePacket<T extends PacketFieldValues<any>>(packet: DefinedPacket, data: T): Buffer {
  const fieldBuffers = [varInt(packet.id)];

  for (const [fieldName, handler] of Object.entries(packet.fields)) {
    if (!shouldIncludeField(handler, data)) continue;

    const fieldValue = data[fieldName];
    if (fieldValue === undefined && !isConditionalHandler(handler)) {
      throw new Error(`Missing required field: ${fieldName}`);
    }

    if (isConditionalHandler(handler)) {
      if (fieldValue !== undefined) {
        fieldBuffers.push(handler.innerHandler(fieldValue));
      }
    } else {
      fieldBuffers.push(handler(fieldValue));
    }
  }

  const content = composeDataBuffer(...fieldBuffers);

  return composeDataBuffer(varInt(content.length), content);
}

export function readPacketFields<T extends Record<string, TypeHandler<any>>>(packetFields: T, buffer: Buffer): PacketFieldValues<T> {
  const result = {} as Record<string, any>;
  let offset = 0;

  for (const [fieldName, handler] of Object.entries(packetFields)) {
    if (!shouldIncludeField(handler, result)) continue;

    const fieldBuffer = buffer.subarray(offset);

    if (isConditionalHandler(handler)) {
      const fieldResult = handler.innerHandler.readWithBytesCount(fieldBuffer);
      result[fieldName] = fieldResult.value;
      offset += fieldResult.bytesRead;
    } else {
      const fieldResult = (handler as TypeHandler<any>).readWithBytesCount(fieldBuffer);
      result[fieldName] = fieldResult.value;
      offset += fieldResult.bytesRead;
    }
  }

  return result as PacketFieldValues<T>;
}
