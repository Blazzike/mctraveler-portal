import { expect, test } from 'bun:test';
import paint, { colorMapping, decorationMapping, NamedTextColor, TextDecoration } from '@/feature-api/paint';

test('paint > simple text', () => {
  const result = paint`Hello World`;
  expect(result.toLegacyString()).toBe('Hello World');
  expect(result.toUnformatted()).toBe('Hello World');
});

test('paint > colored text', () => {
  const result = paint.green`Green text`;
  expect(result.toLegacyString()).toBe('§aGreen text');
  expect(result.toUnformatted()).toBe('Green text');
});

test('paint > multiple colors', () => {
  const result = paint.red`Red text`;
  expect(result.toLegacyString()).toBe('§cRed text');

  const blue = paint.blue`Blue text`;
  expect(blue.toLegacyString()).toBe('§9Blue text');
});

test('paint > bold text', () => {
  const result = paint.bold`Bold text`;
  expect(result.toLegacyString()).toBe('§lBold text');
  expect(result.toUnformatted()).toBe('Bold text');
});

test('paint > italic text', () => {
  const result = paint.italic`Italic text`;
  expect(result.toLegacyString()).toBe('§oItalic text');
});

test('paint > underline text', () => {
  const result = paint.underline`Underlined`;
  expect(result.toLegacyString()).toBe('§nUnderlined');
});

test('paint > colored and bold', () => {
  const result = paint.red.bold`Red and bold`;
  expect(result.toLegacyString()).toBe('§c§lRed and bold');
  expect(result.toUnformatted()).toBe('Red and bold');
});

test('paint > nested paint objects', () => {
  const inner = paint.green`green`;
  const outer = paint.red`This is ${inner} text`;
  expect(outer.toLegacyString()).toBe('§cThis is §agreen§r§c text');
  expect(outer.toUnformatted()).toBe('This is green text');
});

test('paint > template literal with values', () => {
  const value = 'World';
  const result = paint.yellow`Hello ${value}!`;
  expect(result.toLegacyString()).toBe('§eHello World!');
  expect(result.toUnformatted()).toBe('Hello World!');
});

test('paint > error helper', () => {
  const result = paint.error`Something went wrong`;
  expect(result.toLegacyString()).toContain('ERROR');
  expect(result.toLegacyString()).toContain('§c');
  expect(result.toLegacyString()).toContain('§l');
  expect(result.toLegacyString()).toContain('Something went wrong');
  expect(result.toUnformatted()).toBe('ERROR Something went wrong');
});

test('paint > usage helper', () => {
  const result = paint.usage`/command <arg>`;
  expect(result.toLegacyString()).toContain('USAGE');
  expect(result.toLegacyString()).toContain('/command <arg>');
  expect(result.toUnformatted()).toContain('USAGE');
});

test('paint > toTerminal converts color codes', () => {
  const result = paint.red`Red text`;
  const terminal = result.toTerminal();
  expect(terminal).toContain('\x1b[31m');
});

test('paint > reset color', () => {
  const result = paint.reset`Reset`;
  expect(result.toLegacyString()).toBe('§rReset');
});

test('paint > white color', () => {
  const result = paint.white`White`;
  expect(result.toLegacyString()).toBe('§fWhite');
});

test('paint > gray color', () => {
  const result = paint.gray`Gray`;
  expect(result.toLegacyString()).toBe('§7Gray');
});

test('paint > blue with bold', () => {
  const result = paint.blue.bold`Test`;
  expect(result.toLegacyString()).toBe('§9§lTest');
  expect(result.toUnformatted()).toBe('Test');
});

test('colorMapping > has all named colors', () => {
  expect(colorMapping[NamedTextColor.green]).toBe('§a');
  expect(colorMapping[NamedTextColor.gray]).toBe('§7');
  expect(colorMapping[NamedTextColor.white]).toBe('§f');
  expect(colorMapping[NamedTextColor.yellow]).toBe('§e');
  expect(colorMapping[NamedTextColor.red]).toBe('§c');
  expect(colorMapping[NamedTextColor.blue]).toBe('§9');
  expect(colorMapping[NamedTextColor.reset]).toBe('§r');
});

test('decorationMapping > has all decorations', () => {
  expect(decorationMapping[TextDecoration.bold]).toBe('§l');
  expect(decorationMapping[TextDecoration.italic]).toBe('§o');
  expect(decorationMapping[TextDecoration.underline]).toBe('§n');
});
