import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { reset } from '@/feature-api/manager';
import CommandsInjectionModule from '@/modules/CommandsInjectionModule';

const { buildCommandTrees } = CommandsInjectionModule.api;

describe('commands-injection', () => {
  beforeAll(() => {
    reset();
  });

  afterAll(() => {
    reset();
  });

  describe('buildCommandTrees', () => {
    test('builds tree for simple command', () => {
      const trees = buildCommandTrees('help');
      expect(trees.length).toBe(1);
      expect(trees[0]!.length).toBe(1);
      expect(trees[0]![0]!.name).toBe('help');
      expect(trees[0]![0]!.flags & 0x01).toBe(0x01);
    });

    test('builds tree for command with string argument', () => {
      const trees = buildCommandTrees('say <message:string>');
      expect(trees.length).toBe(1);
      expect(trees[0]!.length).toBe(2);
      expect(trees[0]![0]!.name).toBe('say');
      expect(trees[0]![1]!.name).toBe('message');
    });

    test('builds tree for command with integer argument', () => {
      const trees = buildCommandTrees('give <amount:integer>');
      expect(trees.length).toBe(1);
      expect(trees[0]!.length).toBe(2);
      expect(trees[0]![1]!.parserID).toBe(3);
    });

    test('builds tree for command with player argument', () => {
      const trees = buildCommandTrees('tp <target:player>');
      expect(trees.length).toBe(1);
      expect(trees[0]!.length).toBe(2);
      expect(trees[0]![1]!.name).toBe('target');
      expect(trees[0]![1]!.suggestionsType).toBe('minecraft:ask_server');
    });

    test('builds multiple trees for oneOf pattern', () => {
      const trees = buildCommandTrees('<cmd:a|b|c>');
      expect(trees.length).toBe(3);
      expect(trees[0]![0]!.name).toBe('a');
      expect(trees[1]![0]!.name).toBe('b');
      expect(trees[2]![0]!.name).toBe('c');
    });

    test('builds tree for greedy string argument', () => {
      const trees = buildCommandTrees('announce <message:string...>');
      expect(trees.length).toBe(1);
      expect(trees[0]!.length).toBe(2);
    });

    test('builds tree with literal subcommand', () => {
      const trees = buildCommandTrees('region rename <name:string>');
      expect(trees.length).toBe(1);
      expect(trees[0]!.length).toBe(3);
      expect(trees[0]![0]!.name).toBe('region');
      expect(trees[0]![1]!.name).toBe('rename');
      expect(trees[0]![2]!.name).toBe('name');
    });

    test('returns empty array for empty pattern', () => {
      const trees = buildCommandTrees('');
      expect(trees).toEqual([]);
    });

    test('marks last node as executable', () => {
      const trees = buildCommandTrees('test <arg:string>');
      const lastNode = trees[0]![trees[0]!.length - 1]!;
      expect(lastNode.flags & 0x04).toBe(0x04);
    });

    test('sets up child relationships correctly', () => {
      const trees = buildCommandTrees('cmd <arg1:string> <arg2:string>');
      expect(trees[0]![0]!.children).toContain(1);
      expect(trees[0]![1]!.children).toContain(2);
    });
  });
});
