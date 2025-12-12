import { expect, test } from 'bun:test';
import { getParserPropertySize } from '@/network/packet-parser-properties';

test('getParserPropertySize > parser 0 (no properties)', () => {
  const buffer = Buffer.from([]);
  expect(getParserPropertySize(0, buffer, 0)).toBe(0);
});

test('getParserPropertySize > parser 5 (string with varInt)', () => {
  const buffer = Buffer.from([0x05]);
  expect(getParserPropertySize(5, buffer, 0)).toBe(1);
});

test('getParserPropertySize > parser 6 (entity with flags)', () => {
  const buffer = Buffer.from([0x01]);
  expect(getParserPropertySize(6, buffer, 0)).toBe(1);
});

test('getParserPropertySize > parser 1 (float with min)', () => {
  const buffer = Buffer.from([0x01, 0, 0, 0, 0]);
  expect(getParserPropertySize(1, buffer, 0)).toBe(5);
});

test('getParserPropertySize > parser 1 (float with min and max)', () => {
  const buffer = Buffer.from([0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
  expect(getParserPropertySize(1, buffer, 0)).toBe(9);
});

test('getParserPropertySize > parser 43 (time)', () => {
  const buffer = Buffer.from([0, 0, 0, 0]);
  expect(getParserPropertySize(43, buffer, 0)).toBe(4);
});

test('getParserPropertySize > parser 44 (string with length)', () => {
  const buffer = Buffer.from([0x05, 72, 101, 108, 108, 111]);
  expect(getParserPropertySize(44, buffer, 0)).toBe(6);
});
