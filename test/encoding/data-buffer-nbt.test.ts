import { expect, test } from 'bun:test';
import { anonymousNbt, nbt } from '@/encoding/data-buffer';

test('nbt > simple text component', () => {
  const input = { text: 'Hello, World!' };

  const encoded = nbt(input);
  const decoded = nbt.read(encoded);

  expect(decoded).toEqual(input);
});

test('nbt > text component with color', () => {
  const input = { text: 'Hello', color: 'red' };

  const encoded = nbt(input);
  const decoded = nbt.read(encoded);

  expect(decoded).toEqual(input);
});

test('nbt > text component with formatting', () => {
  const input = {
    text: 'Formatted Text',
    color: 'blue',
    bold: true,
    italic: true,
  };

  const encoded = nbt(input);
  const decoded = nbt.read(encoded);

  expect(decoded.text).toBe('Formatted Text');
  expect(decoded.color).toBe('blue');
  expect(decoded.bold).toBe(1);
  expect(decoded.italic).toBe(1);
});

test('nbt > text component with extra array', () => {
  const input = {
    text: '',
    extra: [
      { text: 'Hello ', color: 'red' },
      { text: 'World', color: 'blue' },
    ],
  };

  const encoded = nbt(input);
  const decoded = nbt.read(encoded);

  expect(decoded.text).toBe('');
  expect(Array.isArray(decoded.extra)).toBe(true);
  expect(decoded.extra[0].text).toBe('Hello ');
  expect(decoded.extra[0].color).toBe('red');
  expect(decoded.extra[1].text).toBe('World');
  expect(decoded.extra[1].color).toBe('blue');
});

test('nbt > empty text component', () => {
  const input = { text: '' };

  const encoded = nbt(input);
  const decoded = nbt.read(encoded);

  expect(decoded).toEqual(input);
});

test('nbt > nested compound', () => {
  const input = {
    text: 'Test',
    hoverEvent: {
      action: 'show_text',
      value: 'Hover text',
    },
  };

  const encoded = nbt(input);
  const decoded = nbt.read(encoded);

  expect(decoded.text).toBe('Test');
  expect(decoded.hoverEvent.action).toBe('show_text');
  expect(decoded.hoverEvent.value).toBe('Hover text');
});

test('nbt > numeric values', () => {
  const input = {
    integer: 42,
    float: 3.14,
    negative: -10,
  };

  const encoded = nbt(input);
  const decoded = nbt.read(encoded);

  expect(decoded.integer).toBe(42);
  expect(decoded.float).toBeCloseTo(3.14, 2);
  expect(decoded.negative).toBe(-10);
});

test('nbt > boolean values', () => {
  const input = {
    enabled: true,
    disabled: false,
  };

  const encoded = nbt(input);
  const decoded = nbt.read(encoded);

  expect(decoded.enabled).toBe(1);
  expect(decoded.disabled).toBe(0);
});

test('nbt > bytesRead tracking', () => {
  const input = { text: 'Test' };
  const encoded = nbt(input);

  const result = nbt.readWithBytesCount(encoded);

  expect(result.value).toEqual(input);
  expect(result.bytesRead).toBe(encoded.length);
});

test('nbt > roundtrip with complex structure', () => {
  const input = {
    text: '',
    extra: [
      { text: 'Player ', color: 'gray' },
      { text: 'john_doe', color: 'white', bold: true },
      { text: ' has joined the game', color: 'yellow' },
    ],
  };

  const encoded = nbt(input);
  const decoded = nbt.read(encoded);

  expect(decoded.text).toBe('');
  expect(decoded.extra.length).toBe(3);
  expect(decoded.extra[1].text).toBe('john_doe');
  expect(decoded.extra[1].bold).toBe(1);
});

test('nbt > minecraft text component format', () => {
  const input = {
    text: 'Welcome to the server!',
    color: 'gold',
    bold: true,
  };

  const encoded = nbt(input);

  expect(encoded[0]).toBe(0x0a);

  const decoded = nbt.read(encoded);
  expect(decoded.text).toBe('Welcome to the server!');
  expect(decoded.color).toBe('gold');
  expect(decoded.bold).toBe(1);
});

test('anonymousNbt > simple text component', () => {
  const input = { text: 'Hello, World!' };

  const encoded = anonymousNbt(input);
  const decoded = anonymousNbt.read(encoded);

  expect(decoded.text).toBe('Hello, World!');
});

test('anonymousNbt > starts with 0x0a but no name field', () => {
  const input = { text: 'Test' };

  const encoded = anonymousNbt(input);

  expect(encoded[0]).toBe(0x0a);
  expect(encoded[1]).not.toBe(0x00);
});

test('anonymousNbt > text component with color and formatting', () => {
  const input = {
    text: 'Formatted',
    color: 'red',
    bold: true,
  };

  const encoded = anonymousNbt(input);
  const decoded = anonymousNbt.read(encoded);

  expect(decoded.text).toBe('Formatted');
  expect(decoded.color).toBe('red');
  expect(decoded.bold).toBeTruthy();
});

test('anonymousNbt > roundtrip with extra array', () => {
  const input = {
    text: '',
    extra: [
      { text: 'Hello ', color: 'red' },
      { text: 'World', color: 'blue' },
    ],
  };

  const encoded = anonymousNbt(input);
  const decoded = anonymousNbt.read(encoded);

  expect(decoded.text).toBe('');
  expect(Array.isArray(decoded.extra)).toBe(true);
  expect(decoded.extra[0].text).toBe('Hello ');
  expect(decoded.extra[1].color).toBe('blue');
});

test('anonymousNbt > bytesRead tracking', () => {
  const input = { text: 'Test' };
  const encoded = anonymousNbt(input);

  const result = anonymousNbt.readWithBytesCount(encoded);

  expect(result.value.text).toBe('Test');
  expect(result.bytesRead).toBe(encoded.length);
});
