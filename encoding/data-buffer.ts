import * as nbtLib from 'prismarine-nbt';

type WriteHandler<T> = (value: T) => Buffer;
type ReadHandler<T> = (buffer: Buffer) => T;

type BytesRead = number;
type ReadWithBytesReadHandler<T> = (buffer: Buffer) => {
  value: T;
  bytesRead: BytesRead;
};

export type TypeHandler<T> = WriteHandler<T> & {
  readWithBytesCount: ReadWithBytesReadHandler<T>;
  read: ReadHandler<T>;
};

function createTypeHandler<T>({ write, read }: { write: WriteHandler<T>; read: ReadWithBytesReadHandler<T> }): TypeHandler<T> {
  return Object.assign(write, {
    readWithBytesCount: read,
    read: (buffer: Buffer) => read(buffer).value,
  });
}

export const boolean = createTypeHandler<boolean>({
  write: (value) => {
    return Buffer.from([value ? 0x01 : 0x00]);
  },
  read: (buffer) => ({
    value: buffer.readUInt8(0) === 0x01,
    bytesRead: 1,
  }),
});

export const varInt = createTypeHandler<number>({
  write: (value) => {
    const bytes: number[] = [];

    let unsignedValue = value >>> 0;

    while (unsignedValue >= 0x80) {
      bytes.push((unsignedValue & 0x7f) | 0x80);
      unsignedValue >>>= 7;
    }
    bytes.push(unsignedValue & 0x7f);

    return Buffer.from(bytes);
  },
  read: (buffer) => {
    let value = 0;
    let position = 0;
    let currentByte: number;

    do {
      currentByte = buffer.readUInt8(position);
      value |= (currentByte & 0x7f) << (7 * position);
      position++;
    } while ((currentByte & 0x80) !== 0);

    return {
      value: value | 0,
      bytesRead: position,
    };
  },
});

export const string = createTypeHandler<string>({
  write: (value) => {
    const stringBuffer = Buffer.from(value, 'utf8');
    const lengthBuffer = varInt(stringBuffer.length);
    return Buffer.concat([lengthBuffer, stringBuffer]);
  },
  read: (buffer) => {
    const lengthInfo = varInt.readWithBytesCount(buffer);
    const stringBuffer = buffer.subarray(lengthInfo.bytesRead, lengthInfo.bytesRead + lengthInfo.value);

    return {
      value: stringBuffer.toString('utf8'),
      bytesRead: lengthInfo.bytesRead + lengthInfo.value,
    };
  },
});

export const unsignedShort = createTypeHandler<number>({
  write: (value) => {
    const buffer = Buffer.allocUnsafe(2);
    buffer.writeUInt16BE(value, 0);
    return buffer;
  },
  read: (buffer) => {
    return {
      value: buffer.readUInt16BE(0),
      bytesRead: 2,
    };
  },
});

export const long = createTypeHandler<bigint>({
  write: (value) => {
    const buffer = Buffer.allocUnsafe(8);
    buffer.writeBigInt64BE(BigInt(value));
    return buffer;
  },
  read: (buffer) => {
    return {
      value: buffer.readBigInt64BE(0),
      bytesRead: 8,
    };
  },
});

export const uuid = createTypeHandler<string>({
  write: (value) => {
    const hex = value.replace(/-/g, '');
    return Buffer.from(hex, 'hex');
  },
  read: (buffer) => {
    const hex = buffer.subarray(0, 16).toString('hex');
    const uuid = [hex.substring(0, 8), hex.substring(8, 12), hex.substring(12, 16), hex.substring(16, 20), hex.substring(20, 32)].join('-');

    return {
      value: uuid,
      bytesRead: 16,
    };
  },
});

export const double = createTypeHandler<number>({
  write: (value) => {
    const buffer = Buffer.allocUnsafe(8);
    buffer.writeDoubleBE(value, 0);
    return buffer;
  },
  read: (buffer) => {
    return {
      value: buffer.readDoubleBE(0),
      bytesRead: 8,
    };
  },
});

export const float = createTypeHandler<number>({
  write: (value) => {
    const buffer = Buffer.allocUnsafe(4);
    buffer.writeFloatBE(value, 0);
    return buffer;
  },
  read: (buffer) => {
    return {
      value: buffer.readFloatBE(0),
      bytesRead: 4,
    };
  },
});

export const byte = createTypeHandler<number>({
  write: (value) => {
    return Buffer.from([value & 0xff]);
  },
  read: (buffer) => {
    return {
      value: buffer.readInt8(0),
      bytesRead: 1,
    };
  },
});

export const int = createTypeHandler<number>({
  write: (value) => {
    const buffer = Buffer.allocUnsafe(4);
    buffer.writeInt32BE(value, 0);
    return buffer;
  },
  read: (buffer) => {
    return {
      value: buffer.readInt32BE(0),
      bytesRead: 4,
    };
  },
});

export const short = createTypeHandler<number>({
  write: (value) => {
    const buffer = Buffer.allocUnsafe(2);
    buffer.writeInt16BE(value, 0);
    return buffer;
  },
  read: (buffer) => {
    return {
      value: buffer.readInt16BE(0),
      bytesRead: 2,
    };
  },
});

export const raw = createTypeHandler<Buffer>({
  write: (value) => {
    return value;
  },
  read: () => {
    throw new Error('raw type handler should not be used for reading');
  },
});

export const restBuffer = createTypeHandler<Buffer>({
  write: (value) => value,
  read: (buf) => ({
    value: buf,
    bytesRead: buf.length,
  }),
});

export const position = createTypeHandler<{ x: number; y: number; z: number }>({
  write: (value) => {
    const buf = Buffer.alloc(8);
    // Convert to unsigned representation for packing (26 bits for x/z, 12 bits for y)
    const x = value.x < 0 ? value.x + 0x4000000 : value.x;
    const z = value.z < 0 ? value.z + 0x4000000 : value.z;
    const y = value.y < 0 ? value.y + 0x1000 : value.y;
    const val = (BigInt(x) << 38n) | (BigInt(z) << 12n) | BigInt(y);
    buf.writeBigUInt64BE(val);
    return buf;
  },
  read: (buf) => {
    const val = buf.readBigUInt64BE(0);
    let x = Number(val >> 38n);
    let z = Number((val >> 12n) & 0x3ffffffn);
    let y = Number(val & 0xfffn);
    if (x >= 0x2000000) x -= 0x4000000;
    if (z >= 0x2000000) z -= 0x4000000;
    if (y >= 0x800) y -= 0x1000;
    return { value: { x, y, z }, bytesRead: 8 };
  },
});

export const vec2f = createTypeHandler<{ x: number; y: number }>({
  write: (value) => {
    const buf = Buffer.alloc(8);
    buf.writeFloatBE(value.x, 0);
    buf.writeFloatBE(value.y, 4);
    return buf;
  },
  read: (buf) => ({
    value: { x: buf.readFloatBE(0), y: buf.readFloatBE(4) },
    bytesRead: 8,
  }),
});

export const vec3f = createTypeHandler<{ x: number; y: number; z: number }>({
  write: (value) => {
    const buf = Buffer.alloc(12);
    buf.writeFloatBE(value.x, 0);
    buf.writeFloatBE(value.y, 4);
    buf.writeFloatBE(value.z, 8);
    return buf;
  },
  read: (buf) => ({
    value: { x: buf.readFloatBE(0), y: buf.readFloatBE(4), z: buf.readFloatBE(8) },
    bytesRead: 12,
  }),
});

export const vec3f64 = createTypeHandler<{ x: number; y: number; z: number }>({
  write: (value) => {
    const buf = Buffer.alloc(24);
    buf.writeDoubleBE(value.x, 0);
    buf.writeDoubleBE(value.y, 8);
    buf.writeDoubleBE(value.z, 16);
    return buf;
  },
  read: (buf) => ({
    value: { x: buf.readDoubleBE(0), y: buf.readDoubleBE(8), z: buf.readDoubleBE(16) },
    bytesRead: 24,
  }),
});

export const slot = createTypeHandler<{ itemCount: number; itemId?: number; components?: Buffer }>({
  write: (value) => {
    const parts: Buffer[] = [varInt(value.itemCount)];
    if (value.itemCount > 0) {
      parts.push(varInt(value.itemId || 0));
      parts.push(varInt(0)); // component count added
      parts.push(varInt(0)); // component count removed
    }
    return Buffer.concat(parts);
  },
  read: (buf) => {
    const countInfo = varInt.readWithBytesCount(buf);
    if (countInfo.value <= 0) {
      return { value: { itemCount: 0 }, bytesRead: countInfo.bytesRead };
    }
    const itemIdInfo = varInt.readWithBytesCount(buf.subarray(countInfo.bytesRead));
    const addedInfo = varInt.readWithBytesCount(buf.subarray(countInfo.bytesRead + itemIdInfo.bytesRead));
    const removedInfo = varInt.readWithBytesCount(buf.subarray(countInfo.bytesRead + itemIdInfo.bytesRead + addedInfo.bytesRead));
    return {
      value: { itemCount: countInfo.value, itemId: itemIdInfo.value },
      bytesRead: countInfo.bytesRead + itemIdInfo.bytesRead + addedInfo.bytesRead + removedInfo.bytesRead,
    };
  },
});

export const spawnInfo = createTypeHandler<Buffer>({
  write: (value) => value,
  read: (buf) => ({ value: buf, bytesRead: buf.length }),
});

export const optionalNbt = createTypeHandler<any>({
  write: (value) => {
    if (value === null || value === undefined) {
      return Buffer.from([0x00]);
    }
    const nbtValue = convertToNBT(value);
    const nbtData = { name: '', type: 'compound', value: nbtValue.value || {} };
    const fullBuffer = nbtLib.writeUncompressed(nbtData as any, 'big');
    return Buffer.concat([fullBuffer.subarray(0, 1), fullBuffer.subarray(3)]);
  },
  read: (buf) => {
    if (buf.length === 0 || buf[0] === 0x00) {
      return { value: null, bytesRead: 1 };
    }
    const emptyName = Buffer.from([0x00, 0x00]);
    const fullBuffer = Buffer.concat([buf.subarray(0, 1), emptyName, buf.subarray(1)]);
    const result: any = nbtLib.parseUncompressed(fullBuffer);
    const { parsed, metadata } = result;
    const size = metadata?.size || nbtLib.writeUncompressed(parsed, 'big').length;
    return { value: nbtLib.simplify(parsed), bytesRead: size - 2 };
  },
});

export function createOptional<T>(innerHandler: TypeHandler<T>): TypeHandler<T | null> {
  return createTypeHandler<T | null>({
    write: (value) => {
      if (value === null || value === undefined) {
        return Buffer.from([0x00]);
      }
      return Buffer.concat([Buffer.from([0x01]), innerHandler(value)]);
    },
    read: (buf) => {
      const present = buf[0] === 0x01;
      if (!present) {
        return { value: null, bytesRead: 1 };
      }
      const inner = innerHandler.readWithBytesCount(buf.subarray(1));
      return { value: inner.value, bytesRead: 1 + inner.bytesRead };
    },
  });
}

export function createArray<T>(itemHandler: TypeHandler<T>): TypeHandler<T[]> {
  return createTypeHandler<T[]>({
    write: (values) => {
      const parts: Buffer[] = [varInt(values.length)];
      for (const value of values) {
        parts.push(itemHandler(value));
      }
      return Buffer.concat(parts);
    },
    read: (buf) => {
      const countInfo = varInt.readWithBytesCount(buf);
      const items: T[] = [];
      let offset = countInfo.bytesRead;
      for (let i = 0; i < countInfo.value; i++) {
        const item = itemHandler.readWithBytesCount(buf.subarray(offset));
        items.push(item.value);
        offset += item.bytesRead;
      }
      return { value: items, bytesRead: offset };
    },
  });
}

export function createContainer<T extends Record<string, TypeHandler<any>>>(fields: T): TypeHandler<{ [K in keyof T]: ReturnType<T[K]['read']> }> {
  return createTypeHandler({
    write: (value: any) => {
      const parts: Buffer[] = [];
      for (const [name, handler] of Object.entries(fields)) {
        parts.push((handler as TypeHandler<any>)(value[name]));
      }
      return Buffer.concat(parts);
    },
    read: (buf) => {
      const result: Record<string, any> = {};
      let offset = 0;
      for (const [name, handler] of Object.entries(fields)) {
        const fieldResult = (handler as TypeHandler<any>).readWithBytesCount(buf.subarray(offset));
        result[name] = fieldResult.value;
        offset += fieldResult.bytesRead;
      }
      return { value: result as any, bytesRead: offset };
    },
  });
}

export type ConditionalHandler<T> = TypeHandler<T | undefined> & {
  isConditional: true;
  dependsOn: string;
  allowedValues: any[];
  innerHandler: TypeHandler<T>;
};

export function when<T>(dependsOn: string, allowedValues: any[], innerHandler: TypeHandler<T>): ConditionalHandler<T> {
  const handler = createTypeHandler<T | undefined>({
    write: (value) => {
      if (value === undefined) return Buffer.alloc(0);
      return innerHandler(value);
    },
    read: (buf) => {
      const result = innerHandler.readWithBytesCount(buf);
      return { value: result.value, bytesRead: result.bytesRead };
    },
  }) as ConditionalHandler<T>;

  handler.isConditional = true;
  handler.dependsOn = dependsOn;
  handler.allowedValues = allowedValues;
  handler.innerHandler = innerHandler;

  return handler;
}

export const buffer = createTypeHandler<Buffer>({
  write: (value) => {
    return Buffer.concat([varInt(value.length), value]);
  },
  read: (buf) => {
    const lengthInfo = varInt.readWithBytesCount(buf);
    const data = buf.subarray(lengthInfo.bytesRead, lengthInfo.bytesRead + lengthInfo.value);
    return {
      value: data,
      bytesRead: lengthInfo.bytesRead + lengthInfo.value,
    };
  },
});

function convertToNBT(obj: any): any {
  if (obj === null || obj === undefined) {
    return null;
  }

  if (typeof obj === 'string') {
    return { type: 'string', value: obj };
  }

  if (typeof obj === 'number') {
    if (Number.isInteger(obj)) {
      return { type: 'int', value: obj };
    }
    return { type: 'double', value: obj };
  }

  if (typeof obj === 'boolean') {
    return { type: 'byte', value: obj ? 1 : 0 };
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return { type: 'list', value: { type: 'end', value: [] } };
    }
    const items = obj.map(convertToNBT);
    const listType = items[0]?.type || 'compound';
    const values = items.map((item) => item.value);
    return {
      type: 'list',
      value: {
        type: listType,
        value: values,
      },
    };
  }

  if (typeof obj === 'object') {
    const converted: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      converted[key] = convertToNBT(value);
    }
    return { type: 'compound', value: converted };
  }

  return null;
}

export const nbt = createTypeHandler<any>({
  write: (value) => {
    const nbtValue = convertToNBT(value);
    const nbtData = {
      name: '',
      type: 'compound',
      value: nbtValue.value || {},
    };
    return nbtLib.writeUncompressed(nbtData as any, 'big');
  },
  read: (buf) => {
    const parsed = nbtLib.parseUncompressed(buf, 'big');
    const simplified = nbtLib.simplify(parsed);
    const nbtBuffer = nbtLib.writeUncompressed(parsed, 'big');
    return {
      value: simplified,
      bytesRead: nbtBuffer.length,
    };
  },
});

export const anonymousNbt = createTypeHandler<any>({
  write: (value) => {
    const nbtValue = convertToNBT(value);
    const nbtData = {
      name: '',
      type: 'compound',
      value: nbtValue.value || {},
    };
    const fullBuffer = nbtLib.writeUncompressed(nbtData as any, 'big');
    return Buffer.concat([fullBuffer.subarray(0, 1), fullBuffer.subarray(3)]);
  },
  read: (buf) => {
    if (buf.length === 0 || buf[0] !== 0x0a) {
      throw new Error('Anonymous NBT must start with TAG_Compound (0x0a)');
    }
    const emptyName = Buffer.from([0x00, 0x00]);
    const fullBuffer = Buffer.concat([buf.subarray(0, 1), emptyName, buf.subarray(1)]);

    const result: any = nbtLib.parseUncompressed(fullBuffer);

    // Handle both old and new prismarine-nbt return formats
    const parsed = result.parsed || result;
    const metadata = result.metadata;

    let size = 0;
    if (metadata?.size) {
      size = metadata.size;
    } else {
      // Fallback: use the original parsed object (not simplified) to re-serialize
      try {
        const nbtBuffer = nbtLib.writeUncompressed(parsed, 'big');
        size = nbtBuffer.length;
      } catch {
        // If re-serialization fails, estimate based on buffer scan
        size = fullBuffer.length;
      }
    }

    const simplified = nbtLib.simplify(parsed);

    // fullBuffer had 2 extra bytes (name length), so bytesRead from buf = size - 2
    return {
      value: simplified,
      bytesRead: size - 2,
    };
  },
});

export function composeDataBuffer(...buffers: Buffer[]): Buffer {
  return Buffer.concat(buffers);
}

export function readDataBuffer<T extends TypeHandler<any>[]>(
  buffer: Buffer,
  handlers: T
): {
  [K in keyof T]: ReturnType<T[K]['read']>;
} {
  let offset = 0;
  const result = [];
  for (const handler of handlers) {
    const partResult = handler.readWithBytesCount(buffer.subarray(offset));
    result.push(partResult.value);
    offset += partResult.bytesRead;
  }

  return result as any;
}
