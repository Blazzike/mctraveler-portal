import { describe, expect, test } from 'bun:test';
import { boolean, composeDataBuffer, readDataBuffer, string, unsignedShort, varInt } from '@/encoding/data-buffer';

describe('write', () => {
  describe('boolean', () => {
    test('true', () => {
      const buffer = boolean(true);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer).toEqual(Buffer.from([0x01]));
    });

    test('false', () => {
      const buffer = boolean(false);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer).toEqual(Buffer.from([0x00]));
    });
  });

  describe('varInt', () => {
    const kTestValues: Map<number, number[]> = new Map([
      [0, [0x00]],
      [1, [0x01]],
      [2, [0x02]],
      [127, [0x7f]],
      [128, [0x80, 0x01]],
      [255, [0xff, 0x01]],
      [25565, [0xdd, 0xc7, 0x01]],
      [2097151, [0xff, 0xff, 0x7f]],
      [2147483647, [0xff, 0xff, 0xff, 0xff, 0x07]],
      [-1, [0xff, 0xff, 0xff, 0xff, 0x0f]],
      [-2147483648, [0x80, 0x80, 0x80, 0x80, 0x08]],
    ]);

    for (const [value, expected] of kTestValues) {
      test(value.toString(), () => {
        const buffer = varInt(value);

        expect(buffer).toBeInstanceOf(Buffer);
        expect(buffer).toEqual(Buffer.from(expected));
      });
    }
  });

  describe('string', () => {
    test('empty', () => {
      const buffer = string('');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer).toEqual(Buffer.from([0x00]));
    });

    const kTestString = 'Hello world';
    test('Hello world', () => {
      const buffer = string(kTestString);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer).toEqual(Buffer.concat([varInt(kTestString.length), Buffer.from(kTestString)]));
    });

    test('emoji characters', () => {
      const emojiStr = 'Hello \uD83D\uDE00';
      const buffer = string(emojiStr);
      const utf8Bytes = Buffer.from(emojiStr, 'utf8');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer).toEqual(Buffer.concat([varInt(utf8Bytes.length), utf8Bytes]));
    });

    test('multi-byte unicode', () => {
      const unicodeStr = '\u00e9\u00e8\u00ea \u4e16\u754c';
      const buffer = string(unicodeStr);
      const utf8Bytes = Buffer.from(unicodeStr, 'utf8');

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer).toEqual(Buffer.concat([varInt(utf8Bytes.length), utf8Bytes]));
    });
  });

  describe('unsignedShort', () => {
    test('0', () => {
      const buffer = unsignedShort(0);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer).toEqual(Buffer.from([0x00, 0x00]));
    });

    test('1', () => {
      const buffer = unsignedShort(1);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer).toEqual(Buffer.from([0x00, 0x01]));
    });
  });

  describe('composeDataBuffer', () => {
    test('empty', () => {
      const buffer = composeDataBuffer();

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer).toEqual(Buffer.from([]));
    });

    test('varInt + string', () => {
      const buffer = composeDataBuffer(varInt(1), string('Hello world'));

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer).toEqual(Buffer.concat([varInt(1), string('Hello world')]));
    });
  });
});

describe('read', () => {
  describe('boolean', () => {
    test('true', () => {
      expect(boolean.read(boolean(true)).valueOf()).toEqual(true);
    });

    test('false', () => {
      expect(boolean.read(boolean(false)).valueOf()).toEqual(false);
    });
  });

  describe('varInt', () => {
    const kTestValues = [0, 1, 2, 127, 128, 255, 25565, 2097151, 2147483647, -1, -2147483648];

    for (const value of kTestValues) {
      test(value.toString(), () => {
        expect(varInt.read(varInt(value)).valueOf()).toEqual(value);
      });
    }
  });

  describe('string', () => {
    test('empty', () => {
      expect(string.read(string('')).valueOf()).toEqual('');
    });

    const kTestString = 'Hello world';
    test(kTestString, () => {
      expect(string.read(string(kTestString)).valueOf()).toEqual(kTestString);
    });

    test('emoji roundtrip', () => {
      const emojiStr = 'Hello \uD83D\uDE00\uD83C\uDF89\uD83D\uDD25';
      expect(string.read(string(emojiStr)).valueOf()).toEqual(emojiStr);
    });

    test('multi-byte unicode roundtrip', () => {
      const unicodeStr = '\u00e9\u00e8\u00ea \u4e16\u754c';
      expect(string.read(string(unicodeStr)).valueOf()).toEqual(unicodeStr);
    });

    test('mixed ASCII and supplementary characters', () => {
      const mixed = 'abc \uD83D\uDC4D xyz';
      expect(string.read(string(mixed)).valueOf()).toEqual(mixed);
    });
  });

  describe('unsignedShort', () => {
    test('0', () => {
      expect(unsignedShort.read(unsignedShort(0)).valueOf()).toEqual(0);
    });

    test('1', () => {
      expect(unsignedShort.read(unsignedShort(1)).valueOf()).toEqual(1);
    });
  });

  describe('readDataBuffer', () => {
    test('varInt + string', () => {
      const buffer = composeDataBuffer(varInt(1), string('Hello world'));

      const deseralized = readDataBuffer(buffer, [varInt, string] as const);

      expect(deseralized[0].valueOf()).toEqual(1);
      expect(deseralized[1].valueOf()).toEqual('Hello world');
    });
  });
});
