import { expect, test } from 'bun:test';
import { executeCommand, getRegisteredCommands, getUniqueCommandNames, registerCommand, syntax } from '@/feature-api/command';

const mockPlayer = {
  name: 'TestPlayer',
  username: 'TestPlayer',
} as any;

test('syntax > simple command pattern', () => {
  const pattern = syntax`hello`;
  expect(pattern.toString()).toBe('hello');
});

test('syntax > command with string argument', () => {
  const pattern = syntax`say ${syntax.string}`;
  expect(pattern.toString()).toContain('say');
  expect(pattern.toString()).toContain('<string:string>');
});

test('syntax > command with rest string', () => {
  const pattern = syntax`announce ${syntax.string.rest('message')}`;
  expect(pattern.toString()).toContain('announce');
  expect(pattern.toString()).toContain('<message:string...>');
});

test('syntax > command with oneOf', () => {
  const pattern = syntax`gamemode ${syntax.oneOf('mode', ['creative', 'survival', 'adventure'] as const)}`;
  expect(pattern.toString()).toContain('gamemode');
  expect(pattern.toString()).toContain('creative|survival|adventure');
});

test('syntax > command with onlinePlayer', () => {
  const pattern = syntax`tp ${syntax.onlinePlayer('target')}`;
  expect(pattern.toString()).toContain('tp');
  expect(pattern.toString()).toContain('<target:player>');
});

test('CommandPattern > match simple command', () => {
  const pattern = syntax`test`;
  const result = pattern.match('test');
  expect(result.matches).toBe(true);
});

test('CommandPattern > match fails for different command', () => {
  const pattern = syntax`test`;
  const result = pattern.match('other');
  expect(result.matches).toBe(false);
});

test('CommandPattern > match with string argument', () => {
  const pattern = syntax`say ${syntax.string.rest('message')}`;
  const result = pattern.match('say hello world');
  expect(result.matches).toBe(true);
  expect(result.args.message).toBe('hello world');
});

test('CommandPattern > match with oneOf success', () => {
  const pattern = syntax`mode ${syntax.oneOf('type', ['a', 'b', 'c'] as const)}`;
  const result = pattern.match('mode b');
  expect(result.matches).toBe(true);
  expect(result.args.type).toBe('b');
});

test('CommandPattern > match with oneOf failure', () => {
  const pattern = syntax`mode ${syntax.oneOf('type', ['a', 'b', 'c'] as const)}`;
  const result = pattern.match('mode d');
  expect(result.matches).toBe(false);
});

test('CommandPattern > match fails with extra arguments', () => {
  const pattern = syntax`test ${syntax.string}`;
  const result = pattern.match('test arg1 arg2');
  expect(result.matches).toBe(false);
});

test('CommandPattern > match succeeds with rest parser', () => {
  const pattern = syntax`test ${syntax.string.rest('args')}`;
  const result = pattern.match('test arg1 arg2 arg3');
  expect(result.matches).toBe(true);
  expect(result.args.args).toBe('arg1 arg2 arg3');
});

test('registerCommand > adds command to registry', () => {
  const initialCount = getRegisteredCommands().length;
  const pattern = syntax`testcmd`;
  registerCommand(pattern, () => {});
  expect(getRegisteredCommands().length).toBe(initialCount + 1);
});

test('executeCommand > executes matching command', () => {
  let executed = false;
  const pattern = syntax`exectest`;
  registerCommand(pattern, () => {
    executed = true;
    return true;
  });

  const result = executeCommand(mockPlayer, 'exectest');
  expect(executed).toBe(true);
  expect(result).toBe(true);
});

test('executeCommand > passes arguments to handler', () => {
  let receivedMessage: string | undefined;
  const pattern = syntax`echo ${syntax.string.rest('msg')}`;
  registerCommand(pattern, ({ args }) => {
    receivedMessage = args.msg;
    return true;
  });

  executeCommand(mockPlayer, 'echo test message');
  expect(receivedMessage).toBe('test message');
});

test('executeCommand > returns false for unknown command', () => {
  const result = executeCommand(mockPlayer, 'unknowncommand123456');
  expect(result).toBe(false);
});

test('getUniqueCommandNames > extracts command names', () => {
  registerCommand(syntax`unique1`, () => {});
  registerCommand(syntax`unique2`, () => {});

  const names = getUniqueCommandNames();
  expect(names).toContain('unique1');
  expect(names).toContain('unique2');
});

test('getUniqueCommandNames > handles oneOf patterns', () => {
  registerCommand(syntax`${syntax.oneOf('cmd', ['opt1', 'opt2'] as const)}`, () => {});

  const names = getUniqueCommandNames();
  expect(names).toContain('opt1');
  expect(names).toContain('opt2');
});

test('string parser > single word', () => {
  const parser = syntax.string;
  const result = parser.match('hello world', 0);
  expect(result?.value).toBe('hello');
  expect(result?.consumed).toBe(1);
});

test('string parser > rest mode', () => {
  const parser = syntax.string.rest('text');
  const result = parser.match('hello world foo', 0);
  expect(result?.value).toBe('hello world foo');
  expect(result?.consumed).toBe(3);
});

test('oneOf parser > case insensitive', () => {
  const parser = syntax.oneOf('mode', ['test'] as const);
  const result = parser.match('TEST', 0);
  expect(result?.value).toBe('test');
});
